/**
 * dsh-code (serwer DSH na telefonie): lista komputerow z wtyczka dsh-remote-control i ich sesji
 * dla ekranu „Code”. Zapytania do komputerow ida z tego procesu (przez Tailscale na telefonie),
 * bo przegladarka nie moze pytac komputera bezposrednio (inne pochodzenie, SameSite=Strict).
 *
 * Trasy pod /api/dsh-code wymagaja tej samej sesji co interfejs DSH (ctx.connection.requestRejection),
 * wiec inne aplikacje na telefonie nie moga przez nie sterowac komputerem.
 * Dane: $DSH_HOME/dsh-code.json (urzadzenia + ostatnio widziane sesje, pokazywane jako Rozlaczone).
 *
 * Dwie drogi do komputera: (a) wbudowany wezel Tailscale (program dsh-tsnet-mobile, lib/tsnet.js) — zapytania
 * i WebView ida przez lokalny posrednik 127.0.0.1:<staly port urzadzenia>, bez apki Tailscale/VPN; (b) gdy wezel
 * nie dziala albo nie jest zalogowany — bezposrednio https://<pc> (wymaga apki Tailscale z VPN, jak dotychczas).
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { openUrl, startTsnet, tsnetBinaryPath } from './tsnet.js'
import { MAX_PARALLEL, acceptProbe, hostOf, nextDue, planProbes, recordFailure, runLimited } from './discover.js'
import { createDshClient, importSession } from './vendor/transfer.js'
import { applyWorkspaceZip, collectFiles, diffAgainstBase, readWorkspaceZip, safeRelSegments } from './vendor/workspace-files.js'
import { writeZip } from './vendor/zipwrite.js'
import { appendTail, guardTurnStart, readTail, reloadSession, SeqMap, sessionState } from './vendor/sync.js'
import { createRequire } from 'node:module'

export const name = 'dsh-code'
export const inject = ['webServer', 'connection']

const PREFIX = '/api/dsh-code'
const TIMEOUT_MS = 6000
const MAX_BODY = 64 * 1024
/** Przenoszenie sesji (dsh-remote-control >= 0.2.0 zgłasza capability "session-transfer" w /info). */
const TRANSFER_TIMEOUT_MS = 5 * 60 * 1000
const OUTBOX_POLL_MS = Number(process.env.DSH_CODE_OUTBOX_POLL_MS) || 15000   // zmienna tylko dla testów
const OUTBOX_RETRY_MS = 5 * 60 * 1000
/** Obieg synchronizacji, gdy są powiązania (tury PC → telefon); tury telefonu idą od razu po końcu tury (session/event). */
const SYNC_POLL_MS = Number(process.env.DSH_CODE_SYNC_POLL_MS) || Math.min(4000, OUTBOX_POLL_MS)
const SYNC_IDLE_MS = 15000            // bez powiązań: tak rzadko jak skrzynka
const MISSING_RETRY_MS = 10 * 60 * 1000
/**
 * Synchronizacja tylko na wersji DSH, na której przeszedł test przejęcia (dsh-remote-control 306b380): `reloadSession`
 * i bramka tury (`guardTurnStart`) opierają się na wnętrzu agenta DSH (`phase`). Historia: 2026-10-07 przejęcie bez
 * wyrównania licznika tur dało w logu drugi `turn/start` o tym samym numerze i sesja przestała się wczytywać.
 * DSH_CODE_SYNC=1/0 wymusza włączenie/wyłączenie (testy).
 */
const SYNC_TESTED_DSH = ['0.2.0-rc.2']
const DSH_VERSION = (() => { try { return createRequire(import.meta.url)('@deepseek-ai/dsh/package.json').version } catch { return null } })()
const SYNC_ENABLED = process.env.DSH_CODE_SYNC === '1' || (process.env.DSH_CODE_SYNC !== '0' && SYNC_TESTED_DSH.includes(DSH_VERSION))   // powiązanie do sesji, której nie ma na telefonie: ponów sprawdzenie po 10 min
const CAPS_TTL_MS = 10 * 60 * 1000

export function apply(ctx) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const file = join(home, 'dsh-code.json')
  let data = load()

  const bin = tsnetBinaryPath()
  const tsnet = bin ? startTsnet({ bin, dir: join(home, 'tsnet'), hostname: process.env.DSH_TSNET_HOSTNAME || 'dsh-mobile', log: (l) => console.log(`[dsh-code] ${l}`), onPeers: (peers) => { discover(peers).catch((e) => console.log(`[dsh-code] wykrywanie: ${e.message}`)) } }) : null

  // Wykrywanie komputerów: patrz lib/discover.js. `probed` = ostatni sondowany stan online per host (ponawiamy
  // tylko po zmianie); `inFlight` dla ekranu („Szukam komputerów…”).
  const probed = new Map()
  let inFlight = 0, peersSeen = false, retryTimer = null
  const clock = () => new Date().toTimeString().slice(0, 8)
  async function discover(peers) {
    peersSeen = true
    clearTimeout(retryTimer)
    const due = planProbes(peers, data.devices, data.ignored, probed)
    inFlight += due.length
    try {
      await runLimited(due, MAX_PARALLEL, async (host) => {
        const t0 = Date.now()
        let r
        try { r = await tsnet.probe(host) } catch (e) { r = { target: host, error: e.message } }
        const took = `${((Date.now() - t0) / 1000).toFixed(1)} s`
        const name = acceptProbe(r)
        const entry = name ? { online: true } : recordFailure(probed.get(host))
        probed.set(host, entry)
        const retry = entry.nextAt ? `, ponowię za ${Math.round((entry.nextAt - Date.now()) / 1000)} s` : name ? '' : ', koniec ponowień do zmiany stanu online'
        console.log(`[dsh-code] ${clock()} sonda ${host} (próba ${entry.failures ?? 1}, ${took}): ${r.error ? `błąd ${r.error}` : `HTTP ${r.status} ${JSON.stringify(r.body ?? null)}`}${name ? ` -> dodaję „${name}”` : retry}`)
        if (!name) return
        const url = `https://${host}/`
        if (data.devices.some((d) => hostOf(d.url) === host) || data.ignored.includes(host)) return
        data.devices.push({ id: randomUUID(), name, url, auto: true })
        save()
      })
    } finally { inFlight -= due.length }
    // Ponowienia po nieudanych sondach (30 s, 2 min, 10 min) na ostatniej znanej liście urządzeń.
    const at = nextDue(probed)
    if (at !== null) { retryTimer = setTimeout(() => discover(tsnet.peers()).catch((e) => console.log(`[dsh-code] wykrywanie: ${e.message}`)), Math.max(0, at - Date.now()) + 50); retryTimer.unref?.() }
  }
  ctx.effect(() => () => clearTimeout(retryTimer), 'dsh-code: discovery timer')
  /** Czy trwa szukanie (dla pustej listy): węzeł działa i albo jeszcze nie ma listy urządzeń, albo sondy w toku. */
  const discovering = () => !!tsnet && tsnet.running() && (!peersSeen || inFlight > 0)
  if (!bin) console.log('[dsh-code] brak programu dsh-tsnet-mobile — tylko droga przez apkę Tailscale (VPN)')
  ctx.effect(() => () => tsnet?.stop(), 'dsh-code: tsnet stop')

  /** Czy do komputera idziemy przez wbudowany węzeł (zalogowany) — inaczej bezpośrednio (VPN). */
  const viaTsnet = () => !!tsnet && tsnet.running()

  /** Lokalny pośrednik dla urządzenia (stały port zapisany w dsh-code.json); zwraca origin http://127.0.0.1:<port>. */
  async function proxyOrigin(d) {
    const r = await tsnet.ensureProxy(new URL(d.url).host, d.port ?? 0)
    if (r.port !== d.port) { d.port = r.port; try { save() } catch {} }
    return r.origin
  }

  /** Adres, pod którym WebView ma otworzyć sesję na komputerze. */
  async function sessionOpenUrl(d, sessionId) {
    if (viaTsnet()) return openUrl(await proxyOrigin(d), tsnet.secret, sessionId)
    return `${d.url}?dshOpen=${encodeURIComponent(sessionId)}`
  }

  function load() {
    try {
      const d = JSON.parse(readFileSync(file, 'utf8'))
      return { devices: Array.isArray(d.devices) ? d.devices : [], cache: d.cache && typeof d.cache === 'object' ? d.cache : {}, ignored: Array.isArray(d.ignored) ? d.ignored : [], imports: d.imports && typeof d.imports === 'object' ? d.imports : {}, bases: d.bases && typeof d.bases === 'object' ? d.bases : {}, pullPending: d.pullPending && typeof d.pullPending === 'object' ? d.pullPending : {} }
    } catch { return { devices: [], cache: {}, ignored: [], imports: {}, bases: {}, pullPending: {} } }
  }
  function save() {
    mkdirSync(home, { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2))
    renameSync(tmp, file)
  }

  /** Surowa odpowiedź bramy komputera (np. ZIP sesji); `remote` niżej czyta z niej JSON. */
  async function remoteFetch(device, path, init = {}) {
    let base = device.url, extra = {}
    if (viaTsnet() && device.id) { base = (await proxyOrigin(device)) + '/'; extra = tsnet.headers() }
    else if (viaTsnet()) { const r = await tsnet.ensureProxy(new URL(device.url).host, 0); base = r.origin + '/'; extra = tsnet.headers() }   // nowe urządzenie (bez id) — port tymczasowy
    return fetch(new URL(`__remote/api${path}`, base), { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS), headers: { 'content-type': 'application/json', ...extra, ...(init.headers ?? {}) } })
  }

  async function remote(device, path, init = {}) {
    const res = await remoteFetch(device, path, init)
    const text = await res.text()
    let body = {}
    try { body = JSON.parse(text) } catch {}
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}${text && !text.startsWith('<') ? `: ${text.trim().slice(0, 200)}` : ''}`)
    return body
  }

  async function state() {
    const results = await Promise.all(data.devices.map(async (d) => {
      try {
        const { sessions } = await remote(d, '/sessions')
        data.cache[d.id] = { at: Date.now(), sessions }
        return { device: { ...d, connected: true, error: null }, sessions }
      } catch (error) {
        return { device: { ...d, connected: false, error: describe(error) }, sessions: data.cache[d.id]?.sessions ?? [] }
      }
    }))
    try { save() } catch {}
    const sessions = []
    for (const { device, sessions: list } of results) {
      for (const s of list) {
        let open = null
        if (device.connected) { try { open = await sessionOpenUrl(device, s.sessionId) } catch {} }
        sessions.push({ ...s, deviceId: device.id, deviceName: device.name, deviceUrl: device.url, connected: device.connected, openUrl: open })
      }
    }
    sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    const ts = tsnet ? tsnet.state() : null
    return {
      devices: results.map((r) => r.device),
      discovering: discovering(),
      sessions,
      tailscale: ts ? { backendState: ts.BackendState ?? '', authURL: ts.AuthURL ?? null, error: ts.Error ?? null, ips: ts.TailscaleIPs ?? [], via: viaTsnet() ? 'tsnet' : 'vpn' } : { backendState: 'Unavailable', via: 'vpn' },
    }
  }

  async function addDevice(body) {
    const url = normalizeUrl(body.url)
    if (data.devices.some((d) => d.url === url)) throw Object.assign(new Error('To urządzenie jest już dodane.'), { status: 409 })
    let info
    // Dłuższy limit: pierwszy uścisk TLS z komputerem może czekać na certyfikat Let's Encrypt (do ~60 s).
    try { info = await remote({ url }, '/info', { timeoutMs: 75000 }) } catch (error) {
      throw Object.assign(new Error(`Nie mogę połączyć się z ${url}: ${describe(error)}`), { status: 502 })
    }
    data.ignored = data.ignored.filter((h) => h !== hostOf(url))   // dodane ręcznie z powrotem = znów wolno wykrywać
    data.devices.push({ id: randomUUID(), name: info.name || new URL(url).hostname.split('.')[0], url })
    save()
    return state()
  }

  function removeDevice(id) {
    const d = data.devices.find((x) => x.id === id)
    if (d && !data.ignored.includes(hostOf(d.url))) data.ignored.push(hostOf(d.url))   // usunięte ręcznie: nie dodawać automatycznie
    data.devices = data.devices.filter((x) => x.id !== id)
    delete data.cache[id]
    save()
    return state()
  }

  function device(id) {
    const d = data.devices.find((x) => x.id === id)
    if (!d) throw Object.assign(new Error('Nieznane urządzenie.'), { status: 404 })
    return d
  }

  // --- Przenoszenie sesji telefon ⇄ komputer (wspólny moduł importu z dsh-remote-control: lib/vendor/transfer.js) ---
  // Telefon → komputer: ikona przy sesji (client.js) → POST /api/dsh-code/export → lokalny natywny eksport DSH →
  // POST /sessions/import na komputerze. Komputer → telefon: ikona na PC odkłada sesję do skrzynki bramy; telefon nie
  // przyjmuje połączeń, więc co OUTBOX_POLL_MS sam odbiera skrzynkę, importuje i dopiero po sukcesie potwierdza (DELETE).
  const localDsh = createDshClient({ port: () => ctx.webServer.port, authenticatedUrl: () => ctx.connection.authenticatedUrl(`http://127.0.0.1:${String(ctx.webServer.port)}`) })
  const caps = new Map()        // device.id -> { at, transfer }
  const retryAt = new Map()     // transferId -> czas następnej próby po błędzie
  const imported = new Map()    // transferId -> sessionId: zaimportowane, czekają tylko na potwierdzenie (bez ponownego importu)
  const received = []           // ostatnie odebrane (dla logu / ekranu)
  let pulling = false
  const unreachable = new Map()  // `${trasa} ${device.id}` -> czas ostatniego wpisu w logu o błędzie połączenia
  /** Błąd połączenia z /outbox albo /links: wpis w logu raz na MISSING_RETRY_MS i jeden po powrocie (zamiast ciszy co obieg). */
  function reachability(device, path, error) {
    const key = `${path} ${device.id}`, last = unreachable.get(key)
    if (!error) { if (last) { unreachable.delete(key); console.log(`[dsh-code] ${path} na ${device.name} znowu odpowiada`) } return }
    if (last && Date.now() - last < MISSING_RETRY_MS) return
    unreachable.set(key, Date.now())
    console.log(`[dsh-code] ${path} na ${device.name} nie odpowiada: ${describe(error)} (ponawiam co obieg, następny wpis za ${MISSING_RETRY_MS / 60000} min)`)
  }

  /** Usuwa katalog sesji, której DSH nie przyjął przy kontrolnym odczycie po imporcie (jak brama PC). */
  async function removeSession(id) {
    const root = join(home, 'sessions')
    for (const project of existsSync(root) ? readdirSync(root, { withFileTypes: true }) : []) {
      const dir = join(root, project.name, id)
      if (project.isDirectory() && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    }
  }
  const transferLog = { warn: (m) => console.log(m) }

  // --- Postęp transferów (widok na telefonie): bajty pobrań względem content-length i bajty oddane z ciała wysyłki ---
  const active = new Map()   // id -> { sessionId, dir: 'in'|'out', bytes, total, title, device, at }
  let activeSeq = 0
  function track(info) { const id = ++activeSeq; const e = { ...info, bytes: 0, at: Date.now() }; active.set(id, e); return [id, e] }
  /** Treść odpowiedzi jako Buffer, z licznikiem odebranych bajtów (zamiast res.arrayBuffer()). */
  async function readTracked(res, info) {
    const [id, e] = track({ ...info, total: Number(res.headers.get('content-length')) || null })
    try {
      if (!res.body) return Buffer.from(await res.arrayBuffer())
      const chunks = [], reader = res.body.getReader()
      for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength)); e.bytes += value.byteLength }
      return Buffer.concat(chunks)
    } finally { active.delete(id) }
  }
  /** Ciało wysyłki porcjami po 64 KB z licznikiem bajtów pobranych przez fetch; `end()` po odpowiedzi. */
  function trackedUpload(buf, info) {
    const [id, e] = track({ ...info, total: buf.length })
    let off = 0
    const body = new ReadableStream({ pull(c) { if (off >= buf.length) { c.close(); return } const n = Math.min(65536, buf.length - off); c.enqueue(new Uint8Array(buf.buffer, buf.byteOffset + off, n)); off += n; e.bytes = off } })
    return { init: { body, duplex: 'half' }, end: () => active.delete(id) }
  }

  // --- Pliki projektu z sesją z komputera (faza 1, lib/vendor/workspace-files.js) ---
  // Katalog docelowy: $HOME/<origin.name> jako OSOBNY obszar roboczy (workspaceRegistry.create, idempotentne dla tej
  // samej ścieżki), a zaimportowana sesja dostaje go jako cwd — DSH przypina sesję do obszaru tylko przy równej ścieżce.
  async function projectTarget(manifest) {
    const segs = safeRelSegments(String(manifest?.origin?.name ?? ''), 'win32')   // ostrzejsze reguły niż android
    const name = segs && segs.length === 1 && !segs[0].startsWith('.') ? segs[0] : 'projekt'
    const dir = join(process.env.HOME || homedir(), name)
    mkdirSync(dir, { recursive: true })
    const ws = await ctx.get('workspaceRegistry').create(dir, name)
    return { id: ws.id, path: ws.path ?? dir }
  }
  // Sumy plików z ostatniego przeniesienia w którąkolwiek stronę (`bases[dir][ścieżka]`): applyWorkspaceZip({ base })
  // nadpisuje bez kopii plik niezmieniony od tego czasu; kopia *.przed-importem-* tylko dla zmian zrobionych na telefonie.
  function rememberBase(dir, manifest, report) {
    const landed = new Set([...report.created, ...report.written, ...report.conflicts.map((c) => c.path)])   // grupy rozłączne (c77193f)
    const base = { ...(data.bases?.[dir] ?? {}) }
    for (const f of manifest.files ?? []) if (landed.has(f.path)) base[f.path] = f.sha256
    data.bases = { ...(data.bases ?? {}), [dir]: base }
  }
  // Notka dla agenta zaimportowanej sesji: kontekst promptu (jak dsh-clock-context), pusty dla innych sesji.
  const importNote = (sessionId) => {
    const m = sessionId && data.imports?.[sessionId]
    if (!m) return ''
    const clean = (v) => String(v ?? '').replace(/[{}]/g, '')
    return `This session was moved here from the computer "${clean(m.from)}". Project files: ${m.originRoot ? `"${clean(m.originRoot)}" on the computer` : 'the computer project'} = "${clean(m.dir)}" on this phone ` +
      `(${m.created} created, ${m.written} updated, ${m.conflicts} conflicts kept as *.przed-importem-*, ${m.skipped} skipped). ` +
      (m.scope === 'project' ? 'The whole project directory came over except build outputs/dependencies (bin, obj, node_modules…), secrets, binaries and files over 5 MB.\n' : 'Only files the agent edited with tools came over; build outputs and shell-created files did not.\n') +
      'Earlier turns ran on Windows (pwsh, .exe, C:\\ paths): here pwsh and dotnet work, but .exe and Windows-only tools do not; install missing CLI tools with `dsh-install`.'
  }
  ctx.inject?.(['systemPrompt'], (scope) => { scope.systemPrompt.context({ name: 'dsh-code-import', order: 90, text: (c) => importNote(c?.agent?.session?.id) }) })
  const importOptions = { emit: (event, payload) => ctx.emit(event, payload), removeSession, log: transferLog }

  async function deviceCaps(device) {
    const c = caps.get(device.id)
    if (c && Date.now() - c.at < CAPS_TTL_MS) return c
    let list
    // Pamiętamy tylko udaną odpowiedź: nieudane /info (zimne połączenie tsnet trwa > 6 s) zapamiętane na 10 min
    // po cichu wyłączało odbiór sesji z komputera, mimo że ten je ogłaszał.
    try { const info = await remote(device, '/info', { timeoutMs: 15000 }); list = Array.isArray(info.capabilities) ? info.capabilities : []; reachability(device, '/info') } catch (error) {
      reachability(device, '/info', error)
      return c ?? { at: 0, transfer: false, sync: false, files: false }
    }
    const entry = { at: Date.now(), transfer: list.includes('session-transfer'), sync: list.includes('session-sync'), files: list.includes('workspace-files'), filesReturn: list.includes('workspace-files-return'), filesPull: list.includes('workspace-files-pull'), filesPullAck: list.includes('workspace-files-pull-ack'), filesProject: list.includes('workspace-files-project') }
    caps.set(device.id, entry)
    return entry
  }
  async function supportsTransfer(device) { return (await deviceCaps(device)).transfer }
  async function supportsSync(device) { return (await deviceCaps(device)).sync }

  /**
   * Faza 2 (powrót): pliki projektu zmienione na telefonie od ostatniego importu (`bases[dir]`, także utworzone powłoką)
   * jadą na PC przed oddaniem pisania: POST /links/:id/files (zdolność `workspace-files-return`). Bez tej zdolności
   * albo bez katalogu z importu nic nie robimy. Błąd przerywa oddanie pisania (ponowienie w kolejnym obiegu).
   */
  async function returnFiles(device, link, phoneId) {
    const imp = data.imports?.[phoneId]
    const base = imp?.dir && data.bases?.[imp.dir]
    if (!base || !(await deviceCaps(device)).filesReturn) return
    // kopie konfliktów (*.przed-importem-*) i pliki robocze wyklucza sam moduł (`transfer-copy`, e5d320e)
    const { paths, deleted, truncated } = diffAgainstBase(imp.dir, { files: Object.entries(base).map(([path, sha256]) => ({ path, sha256 })) })
    if (paths.length === 0 && deleted.length === 0) return
    const name = imp.dir.split('/').filter(Boolean).at(-1) ?? 'projekt'
    // deleted informacyjnie: PC niczego nie kasuje
    const { entries, manifest } = collectFiles({ root: imp.dir, scope: 'agent', paths, deleted, truncated, origin: { device: 'phone', root: imp.dir, name }, returnTo: { root: imp.originRoot ?? null } })
    const up = trackedUpload(writeZip(entries), { sessionId: phoneId, dir: 'out', title: link.title ?? null, device: device.name })
    let res, body
    try {
      res = await remoteFetch(device, `/links/${encodeURIComponent(link.linkId)}/files`, { method: 'POST', ...up.init, headers: { 'content-type': 'application/zip' }, timeoutMs: TRANSFER_TIMEOUT_MS })
      body = await res.json().catch(() => ({}))
    } finally { up.end() }
    if (!res.ok) throw new Error(`pliki projektu na ${device.name}: ${body.error ?? `HTTP ${res.status}`} — pisanie zostaje na telefonie`)
    const next = { ...base }
    for (const f of manifest.files) next[f.path] = f.sha256
    data.bases[imp.dir] = next
    save()
    const r = body.report ?? {}
    console.log(`[dsh-code] pliki projektu telefon → ${device.name}: ${manifest.files.length} wysłanych (${r.created?.length ?? '?'} nowych, ${r.written?.length ?? '?'} zaktualizowanych, ${r.conflicts?.length ?? 0} konfliktów na PC), ${manifest.skipped.length} pominiętych${deleted.length ? `, ${deleted.length} usuniętych na telefonie (PC ich nie kasuje)` : ''}`)
  }

  /**
   * Po przejęciu pisania przez telefon: pliki zmienione na PC od ostatniego przeniesienia (GET /links/:id/files,
   * zdolność `workspace-files-pull`) stosujemy z bazą sum, zanim agent na telefonie zacznie pracę. PC zapisuje bazę już
   * przy wysyłce, więc nieudane pobranie zostawia `pullPending` i jest ponawiane w każdym obiegu (inaczej zwrot starej
   * wersji z telefonu nadpisałby zmianę z PC bez kopii). Pliki usunięte na PC tylko logujemy.
   */
  async function pullFiles(device, linkId, phoneId) {
    // tylko sesje z katalogiem projektu (przyszły z plikami); bez niego nie ma czego aktualizować
    const caps = await deviceCaps(device)
    if (!data.imports?.[phoneId]?.dir || !caps.filesPull) { if (data.pullPending[phoneId]) { delete data.pullPending[phoneId]; save() } return '' }
    // ?ack=1 (workspace-files-pull-ack): PC przesuwa bazę dopiero po files-applied, więc pobranie bez zastosowania
    // (np. apka zabita po GET) przy ponowieniu zwraca te same pliki zamiast pustej listy.
    const ack = caps.filesPullAck
    const query = [ack ? 'ack=1' : '', caps.filesProject ? 'scope=project' : ''].filter(Boolean).join('&')
    const res = await remoteFetch(device, `/links/${encodeURIComponent(linkId)}/files${query ? `?${query}` : ''}`, { timeoutMs: TRANSFER_TIMEOUT_MS })
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error ?? `HTTP ${res.status}`) }
    const zip = await readTracked(res, { sessionId: phoneId, dir: 'in', title: null, device: device.name })
    const { manifest } = readWorkspaceZip(zip)
    let note = '', applied = []
    if (manifest.files?.length) {
      const dir = data.imports[phoneId].dir
      const { report } = applyWorkspaceZip({ root: dir, zip, platform: process.platform, base: data.bases?.[dir] ?? {} })
      rememberBase(dir, manifest, report)
      applied = [...report.created, ...report.written, ...report.conflicts.map((c) => c.path)]   // pominięte nie: przyjdą w następnym pobraniu
      const counts = { created: report.created.length, written: report.written.length, conflicts: report.conflicts.length, skipped: report.skipped.length }
      data.imports[phoneId] = { ...(data.imports[phoneId] ?? { from: device.name, originRoot: manifest.origin?.root ?? null }), dir, ...counts, at: Date.now() }
      note = `; pliki z ${device.name} -> ${dir}: ${counts.created} nowych, ${counts.written} zaktualizowanych, ${counts.conflicts} konfliktów, ${counts.skipped} pominiętych`
    }
    if (manifest.deleted?.length) note += `; usunięte na ${device.name} (tu zostają): ${manifest.deleted.slice(0, 5).join(', ')}`
    if (ack && manifest.pullId) {
      // Pliki są już na telefonie; nieudane potwierdzenie zostawia pullPending (ponowienie pobierze to samo i potwierdzi).
      try {
        const r = await remote(device, `/links/${encodeURIComponent(linkId)}/files-applied`, { method: 'POST', body: JSON.stringify({ pullId: manifest.pullId, applied }) })
        note += `; potwierdzone na ${device.name} (${r.merged ?? applied.length} sum)`
      } catch (error) {
        save()
        return `${note}; POTWIERDZENIE na ${device.name} nie doszło (${describe(error)}), ponowię`
      }
    }
    delete data.pullPending[phoneId]
    save()
    return note
  }

  /** Kopia tej sesji PC na telefonie z aktywnym powiązaniem (lista z komputera), o ile sesja na telefonie wciąż istnieje. */
  async function linkedCopy(device, pcSessionId) {
    if (!SYNC_ENABLED || !(await supportsSync(device))) return null
    let links
    try { ({ links } = await remote(device, '/links', { timeoutMs: 15000 })) } catch { return null }   // bez listy: jak dotąd nowa kopia
    const link = (Array.isArray(links) ? links : []).find((l) => l.pcSessionId === pcSessionId && l.phoneSessionId)
    if (!link) return null
    let observed
    try { observed = await ctx.get('sessionQuery').observeSession(link.phoneSessionId) } catch { return null }   // kopię usunięto
    try { return { phoneSessionId: link.phoneSessionId, linkId: link.linkId, cwd: observed?.header?.cwd ?? null } } finally { observed?.[Symbol.dispose]?.() }
  }
  /** ZIP plików projektu z wpisu skrzynki albo null (komputer bez workspace-files, brak plików, pusty manifest). */
  async function fetchFiles(device, transferId, title = null, sessionId = null) {
    const caps = await deviceCaps(device)
    if (!caps.files) return null
    // Cały katalog sesji PC (też pliki zrobione powłoką), gdy PC to umie; decyzja usera: zawsze cały projekt.
    const fr = await remoteFetch(device, `/outbox/${encodeURIComponent(transferId)}/files${caps.filesProject ? '?scope=project' : ''}`, { timeoutMs: TRANSFER_TIMEOUT_MS })
    if (fr.status === 404) return null
    if (!fr.ok) throw new Error(`HTTP ${fr.status} przy pobieraniu plików projektu`)
    const zip = await readTracked(fr, { sessionId, dir: 'in', title, device: device.name })
    const { manifest } = readWorkspaceZip(zip)
    return manifest.files?.length ? { zip, manifest } : null   // pusty manifest: bez nowego obszaru, jak dotąd
  }
  /** Zapisuje pliki projektu do `dir` dla sesji telefonu; błąd tylko logujemy (sesja już jest, ponowienie dałoby drugą). */
  function applyFiles(device, phoneSessionId, dir, files) {
    try {
      const { report } = applyWorkspaceZip({ root: dir, zip: files.zip, platform: process.platform, base: data.bases?.[dir] ?? {} })
      rememberBase(dir, files.manifest, report)
      const counts = { created: report.created.length, written: report.written.length, conflicts: report.conflicts.length, skipped: report.skipped.length }
      data.imports[phoneSessionId] = { from: device.name, originRoot: files.manifest.origin?.root ?? null, dir, scope: files.manifest.scope ?? 'agent', ...counts, at: Date.now() }
      save()
      return `; pliki -> ${dir}: ${counts.created} nowych, ${counts.written} zaktualizowanych, ${counts.conflicts} konfliktów, ${counts.skipped} pominiętych${report.skipped.length ? ` (${report.skipped.slice(0, 5).map((x) => `${x.path}: ${x.reason}`).join(', ')})` : ''}`
    } catch (error) { return `; PLIKI NIE ZAPISANE w ${dir}: ${describe(error)}` }
  }

  async function pullOutboxes() {
    if (pulling) return
    pulling = true
    try {
      for (const device of data.devices) {
        if (!(await supportsTransfer(device))) continue
        let items
        try { ({ items } = await remote(device, '/outbox', { timeoutMs: 15000 })); reachability(device, '/outbox') } catch (error) { reachability(device, '/outbox', error); continue }   // pierwsze połączenie przez tsnet potrafi trwać > 6 s   // komputer offline: spróbujemy przy następnym obiegu
        for (const item of Array.isArray(items) ? items : []) {
          if (item.state && item.state !== 'waiting') continue
          if ((retryAt.get(item.transferId) ?? 0) > Date.now()) continue
          const t0 = Date.now()
          if (imported.has(item.transferId)) { await acknowledge(device, item.transferId); continue }
          try {
            // Ta sama sesja PC jest już powiązana z kopią na telefonie: kopia dostaje nowe tury synchronizacją, więc zamiast
            // drugiej kopii aktualizujemy istniejącą (pliki projektu + natychmiastowy obieg synchronizacji).
            const existing = await linkedCopy(device, item.sessionId)
            const files = await fetchFiles(device, item.transferId, item.title ?? null, existing?.phoneSessionId ?? null)
            if (existing) {
              let filesNote = ''
              if (files) {
                const dir = existing.cwd && data.imports[existing.phoneSessionId]?.dir === existing.cwd ? existing.cwd : (await projectTarget(files.manifest)).path
                filesNote = applyFiles(device, existing.phoneSessionId, dir, files)
              }
              imported.set(item.transferId, existing.phoneSessionId)
              await acknowledge(device, item.transferId)
              retryAt.delete(item.transferId)
              received.unshift({ at: Date.now(), from: device.name, title: item.title ?? null, sessionId: existing.phoneSessionId, updated: true, files: data.imports[existing.phoneSessionId] ?? null })
              received.splice(10)
              console.log(`[dsh-code] sesja „${item.title ?? item.sessionId}” z ${device.name} jest już na telefonie (${existing.phoneSessionId}, powiązana): bez nowej kopii, synchronizuję${filesNote}`)
              syncLinks().catch((e) => console.log(`[dsh-code] synchronizacja: ${describe(e)}`))
              continue
            }
            const res = await remoteFetch(device, `/outbox/${encodeURIComponent(item.transferId)}`, { timeoutMs: TRANSFER_TIMEOUT_MS })
            if (res.status === 404) continue   // anulowane albo odebrane w międzyczasie
            if (!res.ok) throw new Error(`HTTP ${res.status} przy pobieraniu sesji`)
            const zip = await readTracked(res, { sessionId: null, dir: 'in', title: item.title ?? null, device: device.name })
            const target = files ? await projectTarget(files.manifest) : null
            const result = await importSession((service) => ctx.get(service), zip, target ? { ...importOptions, workspaceId: target.id } : importOptions)
            const filesNote = files ? applyFiles(device, result.sessionId, target.path, files) : ''
            imported.set(item.transferId, result.sessionId)
            await acknowledge(device, item.transferId)
            // Synchronizacja: właścicielem zostaje nadawca (PC), kopia na telefonie jest lustrem do czasu przejęcia.
            await registerLink(device, { pcSessionId: item.sessionId, phoneSessionId: result.sessionId, owner: 'pc', sharedCount: result.events, title: result.title ?? item.title ?? undefined })
            retryAt.delete(item.transferId)
            received.unshift({ at: Date.now(), from: device.name, title: result.title ?? item.title ?? null, sessionId: result.sessionId, files: data.imports[result.sessionId] ?? null })
            received.splice(10)
            console.log(`[dsh-code] odebrano sesję „${result.title ?? item.title ?? item.sessionId}” z ${device.name}: ${result.events} zdarzeń, ${result.attachments} załączników, ${zip.length} B, ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${result.sessionId}${result.modelChanged ? `; model ${result.modelChanged.from} niedostępny tutaj -> ${result.modelChanged.to}` : ''}${filesNote}`)
          } catch (error) {
            retryAt.set(item.transferId, Date.now() + OUTBOX_RETRY_MS)
            console.log(`[dsh-code] odbiór sesji „${item.title ?? item.sessionId}” z ${device.name} nie powiódł się (ponowię za ${OUTBOX_RETRY_MS / 60000} min): ${describe(error)}`)
          }
        }
      }
    } finally { pulling = false }
  }
  /**
   * Potwierdzenie odbioru (DELETE) po udanym imporcie. 200 albo 404 (wpisu już nie ma na PC: anulowany / wysłany ponownie
   * jako nowy wpis) = koniec. Inny błąd (np. zerwane połączenie): wpis zostaje w `imported`, więc przy następnym obiegu
   * ponawiamy samo potwierdzenie, a sesji nie importujemy drugi raz.
   */
  async function acknowledge(device, transferId) {
    try {
      const ack = await remoteFetch(device, `/outbox/${encodeURIComponent(transferId)}`, { method: 'DELETE' })
      if (ack.ok || ack.status === 404) { imported.delete(transferId); return }
      console.log(`[dsh-code] potwierdzenie odbioru na ${device.name}: HTTP ${ack.status}, ponowię (sesja już zaimportowana)`)
    } catch (error) {
      console.log(`[dsh-code] potwierdzenie odbioru na ${device.name}: ${describe(error)}, ponowię (sesja już zaimportowana)`)
    }
  }

  ctx.effect(() => {
    const timer = setInterval(() => {
      pullOutboxes().catch((e) => console.log(`[dsh-code] skrzynka: ${e.message}`))
    }, OUTBOX_POLL_MS)
    timer.unref?.()
    return () => clearInterval(timer)
  }, 'dsh-code: odbiór sesji z komputerów')

  /** Cel eksportu: wskazany komputer albo pierwszy połączony, który obsługuje przenoszenie sesji. */
  async function transferTargets() {
    const out = []
    for (const d of data.devices) if (await supportsTransfer(d)) out.push(d)
    return out
  }

  async function exportToComputer(body) {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    if (!sessionId) throw Object.assign(new Error('Brak sessionId.'), { status: 400 })
    const targets = await transferTargets()
    const target = body.device ? targets.find((d) => d.id === body.device) : targets[0]
    if (!target) throw Object.assign(new Error('Brak połączonego komputera z wtyczką dsh-remote-control 0.2 lub nowszą.'), { status: 409 })
    const exported = await localDsh.exportSession(sessionId)
    if (!exported.ok) throw Object.assign(new Error(`Eksport sesji na telefonie nie powiódł się (HTTP ${exported.status}).`), { status: 502 })
    const zip = Buffer.from(await exported.arrayBuffer())
    const t0 = Date.now()
    const up = trackedUpload(zip, { sessionId, dir: 'out', title: null, device: target.name })
    let result
    try { result = await remote(target, '/sessions/import', { method: 'POST', ...up.init, headers: { 'content-type': 'application/zip' }, timeoutMs: TRANSFER_TIMEOUT_MS }) } finally { up.end() }
    console.log(`[dsh-code] wysłano sesję ${sessionId} na ${target.name}: ${result.events} zdarzeń, ${result.attachments} załączników, ${zip.length} B, ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${result.sessionId}${result.modelChanged ? `; na PC model ${result.modelChanged.from} -> ${result.modelChanged.to}` : ''}`)
    // Synchronizacja: właścicielem zostaje nadawca (telefon), kopia na PC jest lustrem do czasu przejęcia.
    await registerLink(target, { pcSessionId: result.sessionId, phoneSessionId: sessionId, owner: 'phone', sharedCount: result.events, title: result.title ?? undefined })
    return { device: target.name, ...result }
  }

  // --- Synchronizacja powiązanych sesji (dsh-remote-control >= 0.3.0, capability "session-sync"; lib/vendor/sync.js) ---
  // Jeden właściciel (zapisywalny) i lustro tylko do odczytu; stan powiązań trzyma brama PC (GET/POST /links…), telefon jest
  // kurierem: co obieg dociąga ogon PC do lustra na telefonie albo wysyła ogon telefonu do lustra na PC. Ogon kończy się na
  // ostatniej zakończonej turze, dopisywanie tylko przez żywe Session.append (walidacja DSH), numery przez SeqMap powiązania.
  const linkState = new Map()   // phoneSessionId -> { linkId, deviceId, deviceName, owner, claim, epoch, error }
  const dirty = new Set()       // sesje telefonu z zakończoną turą do wysłania (z session/event)
  const checked = new Set()     // sesje telefonu sprawdzone przynajmniej raz od startu (tury sprzed restartu)
  const missing = new Map()     // phoneSessionId -> czas: powiązanie do sesji, której nie ma na telefonie
  const present = new Set()     // sesje telefonu, których istnienie już potwierdzono
  let syncing = false, lastFullSync = 0, kick = null

  async function registerLink(device, body) {
    if (!SYNC_ENABLED || !(await supportsSync(device))) return
    try {
      const link = await remote(device, '/links', { method: 'POST', body: JSON.stringify(body) })
      linkState.set(body.phoneSessionId, { linkId: link.linkId, deviceId: device.id, deviceName: device.name, owner: link.owner, claim: link.claim ?? null, epoch: link.epoch, error: null })
      console.log(`[dsh-code] powiązano sesję ${body.phoneSessionId} z ${device.name} (właściciel: ${link.owner === 'pc' ? 'komputer' : 'telefon'}, wspólne zdarzenia: ${body.sharedCount})`)
    } catch (error) {
      console.log(`[dsh-code] powiązanie sesji ${body.phoneSessionId} z ${device.name} nie powiodło się: ${describe(error)}`)
    }
  }

  /** Czy telefon ma własne zakończone tury po `mark` (rozjazd: komputer przejął pisanie bez dostarczenia tych tur). */
  async function ownTurnsAfter(sessionId, mark) {
    const observed = await ctx.get('sessionQuery').observeSession(sessionId)
    try { return observed.events.some((e) => e.seq > mark && e.type === 'turn/end') } finally { observed?.[Symbol.dispose]?.() }
  }

  async function syncOne(device, link) {
    const get = (service) => ctx.get(service)
    const id = link.linkId, phoneId = link.phoneSessionId
    // Najpierw: czy ta sesja jest na telefonie (np. powiązanie testowe na PC wskazuje sesję, której tu nie ma) — błąd
    // „Nie ma sesji …” trafia do syncLinks, które pomija takie powiązanie zamiast próbować co obieg.
    if (!present.has(phoneId)) { await sessionState(get, phoneId); present.add(phoneId) }
    const state = { linkId: id, deviceId: device.id, deviceName: device.name, owner: link.owner, claim: link.claim ?? null, epoch: link.epoch, error: link.lastError?.message ?? null, paused: link.paused ?? null }
    linkState.set(phoneId, state)
    if (link.paused) { state.error = link.paused.message; return }   // wstrzymane na PC: czekamy na „Wznów synchronizację”
    if (link.owner === 'pc') {
      if (link.pcMissing) { state.error = `Sesji nie ma już na ${device.name}.`; return }
      if (link.forced && await ownTurnsAfter(phoneId, link.phoneMark)) {   // rozjazd możliwy tylko po przejęciu „bez telefonu”
        await makeBranch(device, link, phoneId)
        return
      }
      const boundary = link.pcBoundary ?? link.pcMark
      if (boundary <= link.pcMark) return
      const t0 = Date.now()
      const res = await remoteFetch(device, `/links/${id}/events?after=${link.pcMark}&epoch=${link.epoch}`, { timeoutMs: TRANSFER_TIMEOUT_MS })
      if (!res.ok) throw new Error(`ogon z ${device.name}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
      const to = Number(res.headers.get('x-dsh-to'))
      const zip = await readTracked(res, { sessionId: phoneId, dir: 'in', title: link.title ?? null, device: device.name })
      const map = new SeqMap(link.runs)
      const applied = await appendTail(get, phoneId, zip, (pcSeq) => map.toPhone(pcSeq))
      // Agent lustra nie widzi dopisanych tur: wyrównanie jego licznika do logu (inaczej po przejęciu powtórzyłby numer tury).
      const reload = tryReload(phoneId)
      if (reload.error) applied.error = applied.error ?? `Wyrównanie licznika tur na telefonie: ${reload.error}`
      const after = await sessionState(get, phoneId)
      const updated = await remote(device, `/links/${id}/applied`, { method: 'POST', body: JSON.stringify({ epoch: link.epoch, ownerTo: to, mirrorLast: after.lastSeq, pairs: applied.pairs, error: applied.error }) })
      state.error = applied.error ?? null
      console.log(`[dsh-code] synchronizacja ${device.name} → telefon: ${applied.pairs.length} zdarzeń (PC ${link.pcMark + 1}..${to}), ${((Date.now() - t0) / 1000).toFixed(1)} s${applied.error ? `; przerwana: ${applied.error}` : ''} [epoch ${updated.epoch}]`)
      return
    }
    // Właścicielem jest telefon: zaległe pobranie plików z PC (nieudane przy przejęciu) ponawiamy; dopóki się nie uda,
    // nie oddajemy pisania (zwrot starych plików nadpisałby zmiany z PC), ale tury rozmowy synchronizujemy dalej.
    let filesStale = null
    if (data.pullPending?.[phoneId]) {
      try { const note = await pullFiles(device, id, phoneId); console.log(`[dsh-code] ponowione pobranie plików z ${device.name} dla ${phoneId}${note}`) } catch (error) { filesStale = `Pliki projektu z komputera jeszcze nie doszły: ${describe(error)}` }
      if (!filesStale && data.pullPending?.[phoneId]) filesStale = `Komputer ${device.name} nie potwierdził jeszcze pobranych plików projektu.`   // pliki są, potwierdzenie nie
    }
    // Właścicielem jest telefon: wyślij zakończone tury, potem ewentualnie oddaj pisanie na prośbę PC.
    let phoneMark = link.phoneMark, epoch = link.epoch
    if (!dirty.has(phoneId) && checked.has(phoneId) && !link.claim) return   // nic nowego od ostatniego obiegu
    dirty.delete(phoneId); checked.add(phoneId)
    const st = await sessionState(get, phoneId)
    if (st.boundary !== undefined && st.boundary > phoneMark) {
      const tail = await readTail(get, phoneId, phoneMark)
      if (tail.toSeq > phoneMark) {
        const t0 = Date.now()
        const up = trackedUpload(tail.zip, { sessionId: phoneId, dir: 'out', title: link.title ?? null, device: device.name })
        let res, body
        try {
          res = await remoteFetch(device, `/links/${id}/events?after=${phoneMark}&to=${tail.toSeq}&epoch=${epoch}`, { method: 'POST', ...up.init, headers: { 'content-type': 'application/zip' }, timeoutMs: TRANSFER_TIMEOUT_MS })
          body = await res.json().catch(() => ({}))
        } finally { up.end() }
        if (!res.ok) { state.error = body.error ?? `HTTP ${res.status}`; throw new Error(`ogon do ${device.name}: ${state.error}`) }
        phoneMark = body.phoneMark ?? phoneMark; epoch = body.epoch ?? epoch
        state.error = null
        console.log(`[dsh-code] synchronizacja telefon → ${device.name}: ${body.applied ?? 0} zdarzeń (telefon ${link.phoneMark + 1}..${tail.toSeq}), ${((Date.now() - t0) / 1000).toFixed(1)} s`)
      }
    }
    if (filesStale) { state.error = filesStale; return }
    if (link.claim) {
      const now = await sessionState(get, phoneId)
      if (now.busy) return   // tura w toku: oddamy pisanie po jej zakończeniu
      await returnFiles(device, link, phoneId)   // pliki projektu zmienione na telefonie jadą na PC PRZED oddaniem pisania
      const confirmed = await remote(device, `/links/${id}/claim-confirm`, { method: 'POST', body: JSON.stringify({ epoch, phoneBoundary: now.boundary ?? phoneMark, phoneBusy: false }) })
      Object.assign(state, { owner: confirmed.owner, claim: null, epoch: confirmed.epoch })
      const reload = tryReload(phoneId)
      if (reload.error) state.error = `Wyrównanie licznika tur na telefonie: ${reload.error}`
      console.log(`[dsh-code] telefon oddał pisanie sesji ${phoneId} komputerowi ${device.name} [epoch ${confirmed.epoch}]`)
    }
  }

  /**
   * Rozjazd: komputer przejął pisanie bez telefonu, a telefon ma zakończone tury, których nie zdążył oddać. Sesja telefonu
   * zostaje nietknięta jako gałąź („… (gałąź z telefonu)”), powiązanie jest odłączane po obu stronach, sesja na PC zostaje
   * główną wersją. Nic nie jest nadpisywane ani usuwane; wersję z PC można wysłać na telefon ponownie (nowe powiązanie).
   */
  async function makeBranch(device, link, phoneId) {
    let title = null
    try {
      const t = await ctx.get('sessionQuery')?.readTitle?.(phoneId)
      title = typeof t === 'string' ? t : [t?.text, t?.title, t?.value].find((x) => typeof x === 'string' && x) ?? null
    } catch {}
    const branchTitle = `${title || link.title || 'Sesja'} (gałąź z telefonu)`
    try { await ctx.get('sessionController')?.rename?.({ sessionId: phoneId, title: branchTitle }) } catch (error) { console.log(`[dsh-code] nazwa gałęzi ${phoneId}: ${describe(error)}`) }
    await remote(device, `/links/${link.linkId}`, { method: 'DELETE' })
    linkState.delete(phoneId)
    console.log(`[dsh-code] rozjazd z ${device.name}: komputer przejął pisanie bez telefonu, a telefon miał nieoddane tury — sesja ${phoneId} została gałęzią „${branchTitle}”, powiązanie odłączone`)
  }

  // Trwałe usuwanie sesji (wtyczka archiwizacji, np. @michengai/dsh-archive-manager, dokłada workspaceRegistry.deleteSession):
  // sesji powiązanej synchronizacją z komputerem nie usuwamy, tylko odsyłamy do odłączenia. Opakowujemy leniwie w każdym
  // obiegu, bo wtyczka archiwizacji może kopiować swoje metody na rejestr po nas; komunikat trafia do klienta jako treść błędu.
  function guardSyncedDelete() {
    const reg = ctx.get?.('workspaceRegistry')
    const current = reg?.deleteSession
    if (typeof current !== 'function' || current.dshCodeGuard) return
    const guarded = async function (sessionId, ...rest) {
      const link = linkState.get(sessionId)
      if (link) {
        console.log(`[dsh-code] odmowa usunięcia sesji ${sessionId}: synchronizowana z ${link.deviceName ?? 'komputerem'}`)
        throw new Error(`ta sesja jest synchronizowana z komputerem ${link.deviceName ?? ''}. Najpierw odłącz synchronizację: dotknij ikony komputera przy tej sesji na liście, potem usuń ją ponownie.`.replace('  ', ' '))
      }
      const result = await current.call(this, sessionId, ...rest)
      // sesja usunięta z dysku: jej notka o plikach z komputera też (katalog projektu zostaje, to praca usera)
      if (data.imports?.[sessionId]) { delete data.imports[sessionId]; save() }
      return result
    }
    guarded.dshCodeGuard = true
    reg.deleteSession = guarded
  }
  ctx.effect(() => {
    const t = setInterval(() => { try { guardSyncedDelete() } catch (e) { console.log(`[dsh-code] blokada usuwania: ${e.message}`) } }, 5000)
    t.unref?.()
    return () => clearInterval(t)
  }, 'dsh-code: blokada usuwania sesji synchronizowanych')

  async function syncLinks() {
    try { guardSyncedDelete() } catch (e) { console.log(`[dsh-code] blokada usuwania: ${e.message}`) }
    if (!SYNC_ENABLED || syncing) return
    syncing = true
    try {
      const seen = new Set()
      for (const device of data.devices) {
        if (!(await supportsSync(device))) continue
        let links
        try { ({ links } = await remote(device, '/links', { timeoutMs: 15000 })); reachability(device, '/links') } catch (error) { reachability(device, '/links', error); continue }
        for (const link of Array.isArray(links) ? links : []) {
          const since = missing.get(link.phoneSessionId)
          if (since && Date.now() - since < MISSING_RETRY_MS) continue
          seen.add(link.phoneSessionId)
          try { await syncOne(device, link); missing.delete(link.phoneSessionId) } catch (error) {
            if (/not found|Nie ma sesji/i.test(describe(error)) && !/na \S+\.$/.test(describe(error))) {
              if (!missing.has(link.phoneSessionId)) console.log(`[dsh-code] pomijam powiązanie ${link.linkId} z ${device.name}: sesji ${link.phoneSessionId} nie ma na telefonie (sprawdzę ponownie za ${MISSING_RETRY_MS / 60000} min)`)
              missing.set(link.phoneSessionId, Date.now())
              linkState.delete(link.phoneSessionId)
              continue
            }
            const s = linkState.get(link.phoneSessionId)
            if (s) s.error = describe(error)
            console.log(`[dsh-code] synchronizacja sesji ${link.phoneSessionId} z ${device.name}: ${describe(error)}`)
          }
        }
      }
      for (const id of [...linkState.keys()]) if (!seen.has(id)) linkState.delete(id)   // odłączone (np. na PC)
      lastFullSync = Date.now()
    } finally { syncing = false }
  }

  // Koniec tury w powiązanej sesji telefonu: wyślij od razu (po chwili na samodzielne zdarzenia po turn/end), bez czekania na obieg.
  ctx.on?.('session/event', (session, event) => {
    const id = session?.header?.id ?? session?.id
    if (event?.type !== 'turn/end' || !linkState.has(id)) return
    dirty.add(id)
    clearTimeout(kick)
    kick = setTimeout(() => { syncLinks().catch((e) => console.log(`[dsh-code] synchronizacja: ${e.message}`)) }, 1500)
  })
  ctx.effect(() => {
    // Z powiązaniami co SYNC_POLL_MS (tury PC → telefon), bez nich co SYNC_IDLE_MS.
    const timer = setInterval(() => {
      if (linkState.size === 0 && Date.now() - lastFullSync < SYNC_IDLE_MS) return
      syncLinks().catch((e) => console.log(`[dsh-code] synchronizacja: ${e.message}`))
    }, SYNC_POLL_MS)
    timer.unref?.()
    return () => { clearInterval(timer); clearTimeout(kick) }
  }, 'dsh-code: synchronizacja powiązanych sesji')

  /** Przejęcie pisania na telefonie: najpierw dociągnięcie ostatnich zakończonych tur z PC, potem zmiana właściciela na PC. */
  async function claimOnPhone(linkId) {
    const entry = [...linkState.entries()].find(([, v]) => v.linkId === linkId)
    if (!entry) throw Object.assign(new Error('Nie ma takiego powiązania.'), { status: 404 })
    const [phoneId, s] = entry
    const device = data.devices.find((d) => d.id === s.deviceId)
    if (!device) throw Object.assign(new Error('Komputer tego powiązania nie jest już na liście.'), { status: 409 })
    while (syncing) await new Promise((r) => setTimeout(r, 200))
    syncing = true
    try {
      const fresh = async () => ((await remote(device, '/links', { timeoutMs: 15000 })).links ?? []).find((l) => l.linkId === linkId)
      let link = await fresh()
      if (!link) throw Object.assign(new Error('Powiązanie zostało odłączone.'), { status: 409 })
      if (link.owner === 'phone') return { owner: 'phone' }
      await syncOne(device, link)
      link = await fresh()
      const st = await sessionState((service) => ctx.get(service), phoneId)
      const res = await remoteFetch(device, `/links/${linkId}/claim`, { method: 'POST', body: JSON.stringify({ epoch: link.epoch, phoneLast: st.lastSeq }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { status: 409 })
      Object.assign(linkState.get(phoneId) ?? s, { owner: body.owner, claim: null, epoch: body.epoch, error: null })   // syncOne mógł podmienić wpis
      // Nowy właściciel: licznik tur agenta telefonu = ostatnia tura w logu, zanim przyjmie pierwszą turę.
      const reload = tryReload(phoneId)
      if (reload.error) throw Object.assign(new Error(`Przejęto pisanie, ale wyrównanie licznika tur nie powiodło się: ${reload.error}`), { status: 409 })
      if (data.imports?.[phoneId]?.dir) { data.pullPending[phoneId] = true; save() }
      let filesNote
      try { filesNote = await pullFiles(device, linkId, phoneId) } catch (error) {
        console.log(`[dsh-code] telefon przejął pisanie sesji ${phoneId} od ${device.name} [epoch ${body.epoch}], ale pliki z komputera nie doszły: ${describe(error)} (ponawiam co obieg)`)
        throw Object.assign(new Error(`Przejęto pisanie, ale pliki projektu z komputera nie doszły (${describe(error)}). Ponawiam automatycznie; zanim agent zmieni pliki projektu, poczekaj na ich pobranie.`), { status: 409 })
      }
      console.log(`[dsh-code] telefon przejął pisanie sesji ${phoneId} od ${device.name} [epoch ${body.epoch}]${filesNote}`)
      return { owner: body.owner }
    } finally { syncing = false }
  }

  async function unlink(linkId) {
    const entry = [...linkState.entries()].find(([, v]) => v.linkId === linkId)
    if (!entry) throw Object.assign(new Error('Nie ma takiego powiązania.'), { status: 404 })
    const device = data.devices.find((d) => d.id === entry[1].deviceId)
    if (device) await remote(device, `/links/${linkId}`, { method: 'DELETE' })
    linkState.delete(entry[0])
    return { removed: true }
  }

  /** reloadSession sesji telefonu; błąd zwracany jako `{ error }` zamiast wyjątku. */
  function tryReload(phoneId) {
    try { return reloadSession((service) => ctx.get(service), phoneId) } catch (error) { return { error: describe(error) } }
  }

  /** „Wznów synchronizację”: wyrównanie licznika tur po stronie telefonu, potem zdjęcie wstrzymania na PC (które wyrównuje PC). */
  async function resumeLink(linkId) {
    const entry = [...linkState.entries()].find(([, v]) => v.linkId === linkId)
    if (!entry) throw Object.assign(new Error('Nie ma takiego powiązania.'), { status: 404 })
    const [phoneId, s] = entry
    const device = data.devices.find((d) => d.id === s.deviceId)
    if (!device) throw Object.assign(new Error('Komputer tego powiązania nie jest już na liście.'), { status: 409 })
    const reload = tryReload(phoneId)
    if (reload.error) throw Object.assign(new Error(reload.error), { status: 409 })
    const res = await remoteFetch(device, `/links/${linkId}/resume`, { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { status: 409 })
    Object.assign(s, { paused: null, error: null })
    console.log(`[dsh-code] wznowiono synchronizację sesji ${phoneId} z ${device.name}`)
    return { resumed: true }
  }

  // Bramka tury PRZED zapisem `turn/start` (agent/status: running jest emitowane synchronicznie, zanim turn() cokolwiek
  // zapisze; agent/pre-step jest po turn/start, więc za późno): lustro — tura przerwana; właściciel — tura z numerem
  // innym niż ostatni w logu przerwana z zachowaniem wiadomości w kolejce, licznik wyrównany (guardTurnStart z sync.js).
  ctx.on?.('agent/status', (payload) => {
    const stopped = guardTurnStart((service) => ctx.get(service), payload, (id) => {
      const owner = linkState.get(id)?.owner
      return owner === 'phone' ? 'owner' : owner === 'pc' ? 'mirror' : undefined
    })
    if (!stopped || stopped.reason === 'mirror') return
    const s = linkState.get(stopped.sessionId)
    const message = stopped.reason === 'unknown'
      ? 'nieznany stan agenta DSH (zmienione wnętrze DSH); tura przerwana'
      : `tura przerwana: agent miał licznik tur ${stopped.actual}, a w logu jest ${stopped.expected} (licznik wyrównany, wiadomość czeka w kolejce)`
    console.log(`[dsh-code] bramka tury w sesji ${stopped.sessionId}: ${message}`)
    if (!s) return
    Object.assign(s, { error: message, paused: { at: Date.now(), message: `Telefon: ${message}` } })
    // Przerwana tura znaczy, że gdzieś zabrakło wyrównania licznika: wstrzymanie widoczne po obu stronach (dsh-remote-control 79ce65b).
    const device = data.devices.find((d) => d.id === s.deviceId)
    if (device) {
      remote(device, `/links/${s.linkId}/pause`, { method: 'POST', body: JSON.stringify({ message }) })
        .then(() => console.log(`[dsh-code] wstrzymano synchronizację sesji ${stopped.sessionId} (zgłoszone do ${device.name})`))
        .catch((error) => console.log(`[dsh-code] zgłoszenie wstrzymania do ${device.name}: ${describe(error)}`))
    }
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      // Ta sama sesja co interfejs DSH: 403 = obce pochodzenie/host, 401 = brak ważnego ciasteczka.
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) return send(res, rejection, { error: rejection === 401 ? 'unauthorized' : 'forbidden' })
      const url = new URL(req.url ?? '/', 'http://local')
      const route = `${req.method} ${url.pathname.slice(PREFIX.length)}`
      try {
        if (route === 'GET /state') return send(res, 200, await state())
        if (route === 'GET /transfer') return send(res, 200, { active: [...active.values()].map((e) => ({ sessionId: e.sessionId, dir: e.dir, bytes: e.bytes, total: e.total, title: e.title, device: e.device, ms: Date.now() - e.at })), targets: (await transferTargets()).map((d) => ({ id: d.id, name: d.name })), received, links: [...linkState.entries()].map(([phoneSessionId, v]) => ({ phoneSessionId, ...v })) })
        const lm = /^\/links\/([0-9a-f-]{36})(\/claim|\/resume)?$/.exec(url.pathname.slice(PREFIX.length))
        if (lm && req.method === 'POST' && lm[2] === '/claim') return send(res, 200, await claimOnPhone(lm[1]))
        if (lm && req.method === 'POST' && lm[2] === '/resume') return send(res, 200, await resumeLink(lm[1]))
        if (lm && req.method === 'DELETE' && !lm[2]) return send(res, 200, await unlink(lm[1]))
        if (route === 'POST /export') return send(res, 200, await exportToComputer(await readJson(req)))
        if (route === 'POST /devices') return send(res, 200, await addDevice(await readJson(req)))
        if (req.method === 'DELETE' && url.pathname.startsWith(`${PREFIX}/devices/`)) return send(res, 200, await removeDevice(decodeURIComponent(url.pathname.slice(`${PREFIX}/devices/`.length))))
        if (route === 'GET /workspaces') return send(res, 200, await remote(device(url.searchParams.get('device')), '/workspaces'))
        if (route === 'POST /sessions') {
          const body = await readJson(req)
          const d = device(body.device)
          const created = await remote(d, '/sessions', { method: 'POST', body: JSON.stringify({ workspaceId: body.workspaceId, text: body.text }), timeoutMs: 30000 })
          return send(res, 200, { ...created, openUrl: await sessionOpenUrl(d, created.sessionId) })
        }
        return send(res, 404, { error: 'nieznana ścieżka' })
      } catch (error) {
        return send(res, error.status ?? 502, { error: describe(error) })
      }
    },
  }), 'dsh-code: /api/dsh-code')
}

/** „pc.tail1234.ts.net” -> „https://pc.tail1234.ts.net/”; pelny adres zostaje, z ukosnikiem na koncu. */
export function normalizeUrl(input) {
  let u = String(input ?? '').trim()
  if (!u) throw Object.assign(new Error('Podaj adres komputera.'), { status: 400 })
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  const parsed = new URL(u)
  return `${parsed.origin}/`
}

function describe(error) {
  if (error?.name === 'TimeoutError') return 'brak odpowiedzi (Tailscale na telefonie włączony? komputer i DSH działają?)'
  const cause = error?.cause?.code ? ` (${error.cause.code})` : ''
  return `${error?.message ?? error}${cause}`
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('za duża treść'), { status: 413 })); req.destroy() } else chunks.push(c) })
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) } catch { reject(Object.assign(new Error('treść nie jest JSON'), { status: 400 })) } })
    req.on('error', reject)
  })
}
