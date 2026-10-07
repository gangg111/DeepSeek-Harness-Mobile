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

export const name = 'dsh-code'
export const inject = ['webServer', 'connection']

const PREFIX = '/api/dsh-code'
const TIMEOUT_MS = 6000
const MAX_BODY = 64 * 1024
/** Przenoszenie sesji (dsh-remote-control >= 0.2.0 zgłasza capability "session-transfer" w /info). */
const TRANSFER_TIMEOUT_MS = 5 * 60 * 1000
const OUTBOX_POLL_MS = Number(process.env.DSH_CODE_OUTBOX_POLL_MS) || 15000   // zmienna tylko dla testów
const OUTBOX_RETRY_MS = 5 * 60 * 1000
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
      return { devices: Array.isArray(d.devices) ? d.devices : [], cache: d.cache && typeof d.cache === 'object' ? d.cache : {}, ignored: Array.isArray(d.ignored) ? d.ignored : [] }
    } catch { return { devices: [], cache: {}, ignored: [] } }
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

  /** Usuwa katalog sesji, której DSH nie przyjął przy kontrolnym odczycie po imporcie (jak brama PC). */
  async function removeSession(id) {
    const root = join(home, 'sessions')
    for (const project of existsSync(root) ? readdirSync(root, { withFileTypes: true }) : []) {
      const dir = join(root, project.name, id)
      if (project.isDirectory() && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    }
  }
  const transferLog = { warn: (m) => console.log(m) }
  const importOptions = { emit: (event, payload) => ctx.emit(event, payload), removeSession, log: transferLog }

  async function supportsTransfer(device) {
    const c = caps.get(device.id)
    if (c && Date.now() - c.at < CAPS_TTL_MS) return c.transfer
    let transfer = false
    try { const info = await remote(device, '/info'); transfer = Array.isArray(info.capabilities) && info.capabilities.includes('session-transfer') } catch {}
    caps.set(device.id, { at: Date.now(), transfer })
    return transfer
  }

  async function pullOutboxes() {
    if (pulling) return
    pulling = true
    try {
      for (const device of data.devices) {
        if (!(await supportsTransfer(device))) continue
        let items
        try { ({ items } = await remote(device, '/outbox', { timeoutMs: 15000 })) } catch { continue }   // pierwsze połączenie przez tsnet potrafi trwać > 6 s   // komputer offline: spróbujemy przy następnym obiegu
        for (const item of Array.isArray(items) ? items : []) {
          if (item.state && item.state !== 'waiting') continue
          if ((retryAt.get(item.transferId) ?? 0) > Date.now()) continue
          const t0 = Date.now()
          if (imported.has(item.transferId)) { await acknowledge(device, item.transferId); continue }
          try {
            const res = await remoteFetch(device, `/outbox/${encodeURIComponent(item.transferId)}`, { timeoutMs: TRANSFER_TIMEOUT_MS })
            if (res.status === 404) continue   // anulowane albo odebrane w międzyczasie
            if (!res.ok) throw new Error(`HTTP ${res.status} przy pobieraniu sesji`)
            const zip = Buffer.from(await res.arrayBuffer())
            const result = await importSession((service) => ctx.get(service), zip, importOptions)
            imported.set(item.transferId, result.sessionId)
            await acknowledge(device, item.transferId)
            retryAt.delete(item.transferId)
            received.unshift({ at: Date.now(), from: device.name, title: result.title ?? item.title ?? null, sessionId: result.sessionId })
            received.splice(10)
            console.log(`[dsh-code] odebrano sesję „${result.title ?? item.title ?? item.sessionId}” z ${device.name}: ${result.events} zdarzeń, ${result.attachments} załączników, ${zip.length} B, ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${result.sessionId}${result.modelChanged ? `; model ${result.modelChanged.from} niedostępny tutaj -> ${result.modelChanged.to}` : ''}`)
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
    const timer = setInterval(() => { pullOutboxes().catch((e) => console.log(`[dsh-code] skrzynka: ${e.message}`)) }, OUTBOX_POLL_MS)
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
    const result = await remote(target, '/sessions/import', { method: 'POST', body: zip, headers: { 'content-type': 'application/zip' }, timeoutMs: TRANSFER_TIMEOUT_MS })
    console.log(`[dsh-code] wysłano sesję ${sessionId} na ${target.name}: ${result.events} zdarzeń, ${result.attachments} załączników, ${zip.length} B, ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${result.sessionId}${result.modelChanged ? `; na PC model ${result.modelChanged.from} -> ${result.modelChanged.to}` : ''}`)
    return { device: target.name, ...result }
  }

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
        if (route === 'GET /transfer') return send(res, 200, { targets: (await transferTargets()).map((d) => ({ id: d.id, name: d.name })), received })
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
