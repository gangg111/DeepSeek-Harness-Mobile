// Przenoszenie sesji telefon ⇄ komputer: prawdziwa brama dsh-remote-control (>= 0.2.0: createGateway + createApi
// + createOutbox z repo komputera, ścieżka w DSH_REMOTE_PLUGIN) i prawdziwy dsh-code na telefonie, po obu stronach
// fałszywe usługi DSH o kształtach z 0.2.0-rc.2. Bez DSH_REMOTE_PLUGIN test jest pomijany.
//  1. komputer → telefon: wpis w skrzynce PC; telefon sam go odbiera, importuje i potwierdza (DELETE),
//  2. telefon → komputer: POST /api/dsh-code/export -> lokalny eksport DSH -> POST /sessions/import na PC.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeZip } from '../test-support/zip-writer.js'   // kopia z dsh-remote-control (test/zip-writer.js)

const REMOTE = process.env.DSH_REMOTE_PLUGIN
const OWNER = 'artur@example.com'
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)))
const PNG = Buffer.from('89504e470d0a1a0a', 'hex')
const IMG = 'sha256:' + 'c'.repeat(64)

function exportOf(id, text) {
  const header = { type: 'session', version: 4, id, createdAt: 1, cwd: '/x', isSeeded: false, delegationDepth: 0 }
  const events = [
    { type: 'turn/start', seq: 0, time: 10, data: { turn: 1 } },
    { type: 'user/message', seq: 1, time: 11, data: { id: 'm1', role: 'user', content: [{ type: 'text', text }, { type: 'image', attachment: { attachmentId: IMG, mediaType: 'image/png', bytes: 8, width: 1, height: 1 } }] } },
    { type: 'session-log-deepseek/delivery-accepted', seq: 2, time: 12, data: { sessionId: id, sessionFormatVersion: 4, throughSeq: 1 } },
  ]
  return writeZip([['session.v4.jsonl', [header, ...events].map((l) => JSON.stringify(l)).join('\n') + '\n'], [`media/${IMG}.png`, PNG]])
}

/** Fałszywe usługi DSH: zapisują, co przyszło przez sessionPersistence/attachments/workspaceRegistry. */
function fakeDsh(defaultPath, opts = {}) {
  const sessions = []
  const services = {
    sessionPersistence: {
      async create(header) {
        const s = { header, events: [] }
        sessions.push(s)
        return { append: async (ev) => { s.events.push(...ev) }, flush: async () => {}, close: async () => {} }
      },
    },
    workspaceRegistry: {
      created: [],
      list() { return [{ id: 'def', path: defaultPath, attachSession: async () => {} }, ...this.created] },
      async create(path, title) { let w = this.created.find((x) => x.path === path); if (!w) { w = { id: `ws-${this.created.length + 1}`, path, title, attachSession: async () => {} }; this.created.push(w) } return w },
      resolveByPath: async () => undefined,
    },
    attachments: { saveImage: async ({ data, mediaType }) => ({ attachmentId: IMG, mediaType, bytes: data.length, width: 1, height: 1 }) },
    sessionQuery: { async observeSession(id) { return { ...(opts.observe?.(id) ?? {}), [Symbol.dispose]() {} } }, async readTitle(id) { const s = sessions.find((x) => x.header.id === id); return { text: s?.events[1]?.data?.content?.[0]?.text ?? null } } },
    sessionController: { async list() { return { items: [] } }, async rename() {} },
  }
  return { sessions, get: (n) => services[n] }
}

async function computer(opts = {}) {
  const { createGateway } = await import(pathToFileURL(join(REMOTE, 'lib', 'gateway.js')).href)
  const { createApi } = await import(pathToFileURL(join(REMOTE, 'lib', 'api.js')).href)
  const { createOutbox } = await import(pathToFileURL(join(REMOTE, 'lib', 'outbox.js')).href)
  const dsh = fakeDsh('C:\\Users\\A\\deepseek-harness-default-workspace', opts)
  const outbox = createOutbox(join(mkdtempSync(join(tmpdir(), 'pc-outbox-')), 'outbox.json'))
  const exports = { 's-pc': exportOf('s-pc', 'sesja z komputera') }
  const api = createApi({
    get: dsh.get, outbox, emit: () => {}, removeSession: async () => {}, dshVersion: '0.2.0-rc.2',
    dsh: { exportSession: async (id) => (exports[id] ? new Response(exports[id], { status: 200 }) : new Response('', { status: 404 })) },
  })
  const target = http.createServer((req, res) => { res.writeHead(401); res.end() })
  const targetPort = await listen(target)
  const gw = createGateway({ targetPort: () => targetPort, authenticatedUrl: () => '', admit: (l) => l === OWNER, api })
  const gwPort = await listen(gw.server)
  const serve = http.createServer((req, res) => {   // `tailscale serve`: dokleja tożsamość właściciela
    const p = http.request({ host: '127.0.0.1', port: gwPort, method: req.method, path: req.url, headers: { ...req.headers, 'tailscale-user-login': OWNER } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
    p.on('error', () => res.destroy())
    req.pipe(p)
  })
  const servePort = await listen(serve)
  return {
    url: `http://127.0.0.1:${servePort}/`, dsh, outbox,
    async close() { for (const s of [serve, target]) { s.closeAllConnections(); await new Promise((r) => s.close(r)) } await gw.close() },
  }
}

async function phone() {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-code-xfer-'))
  process.env.DSH_CODE_OUTBOX_POLL_MS = '200'
  const { apply } = await import('../lib/index.js')
  const dsh = fakeDsh('/storage/emulated/0/Download')
  const emitted = []
  // Lokalny serwer DSH telefonu: logowanie tokenem startowym -> ciasteczko, potem /api/session.export.
  const local = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.searchParams.get('token') === 'start') { res.writeHead(303, { 'set-cookie': 'dsh-auth-test=ok; Path=/', location: '/' }); return res.end() }
    if (url.pathname === '/api/session.export' && req.headers.cookie === 'dsh-auth-test=ok' && url.searchParams.get('sessionId') === 's-phone') {
      res.writeHead(200, { 'content-type': 'application/zip' }); return res.end(exportOf('s-phone', 'sesja z telefonu'))
    }
    res.writeHead(401); res.end()
  })
  const localPort = await listen(local)
  let handler, promptContext
  const effects = []
  const ctx = {
    webServer: { port: localPort, register(route) { handler = route.handler; return () => {} } },
    connection: { requestRejection: () => undefined, authenticatedUrl: (base) => `${base}/?token=start` },
    effect(fn) { const d = fn(); if (typeof d === 'function') effects.push(d) },
    get: dsh.get,
    emit: (e, p) => emitted.push([e, p]),
    inject(deps, fn) { fn({ systemPrompt: { context(c) { promptContext = c } } }) },
  }
  apply(ctx)
  const server = http.createServer((req, res) => handler(req, res))
  const port = await listen(server)
  const call = (method, path, body) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: `/api/dsh-code${path}`, headers: { 'content-type': 'application/json' } }, (res) => {
      let d = ''; res.on('data', (c) => { d += c }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(d) }))
    })
    r.on('error', reject); if (body) r.write(JSON.stringify(body)); r.end()
  })
  return {
    call, dsh, emitted, note: (sessionId) => promptContext.text({ agent: { session: { id: sessionId } } }),
    async close() { for (const d of effects) d(); for (const s of [server, local]) { s.closeAllConnections(); await new Promise((r) => s.close(r)) } },
  }
}

const waitFor = async (cond, ms = 5000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 50)) } }

test('przenoszenie sesji: komputer → telefon (skrzynka) i telefon → komputer (import)', { skip: !REMOTE && 'brak DSH_REMOTE_PLUGIN' }, async (t) => {
  const pc = await computer()
  const ph = await phone()
  t.after(async () => { await ph.close(); await pc.close() })

  const added = await ph.call('POST', '/devices', { url: pc.url })
  assert.equal(added.status, 200)
  const xfer = await ph.call('GET', '/transfer')
  assert.deepEqual(xfer.json.targets.map((d) => d.name).length, 1, 'komputer zgłasza session-transfer')

  // 1. komputer → telefon
  const item = pc.outbox.add('s-pc', 'Z komputera')
  await waitFor(() => ph.dsh.sessions.length === 1)
  const got = ph.dsh.sessions[0]
  assert.match(got.header.id, /^session-[0-9a-f-]{36}$/)
  assert.equal(got.header.cwd, '/storage/emulated/0/Download', 'domyślny obszar roboczy telefonu')
  assert.equal(got.events[1].data.content[0].text, 'sesja z komputera')
  assert.equal(got.events[2].data.sessionId, got.header.id, 'znacznik wysłania wskazuje nową sesję')
  assert.equal(ph.emitted[0][0], 'api-session/added')
  await waitFor(() => pc.outbox.waiting().length === 0)
  assert.equal(pc.outbox.get(item.transferId).state, 'received', 'telefon potwierdził odbiór dopiero po imporcie')
  await new Promise((r) => setTimeout(r, 600))
  assert.equal(ph.dsh.sessions.length, 1, 'odebrany wpis nie jest importowany drugi raz')

  // 1b. wpis znika z PC w trakcie odbioru (anulowany / wysłany ponownie): import się udał, potwierdzenie dostaje 404 —
  // to nie błąd, sesja nie może zostać zaimportowana drugi raz.
  const before = ph.dsh.sessions.length
  const raced = pc.outbox.add('s-pc', 'Z komputera, drugi raz')
  const origGet = pc.outbox.markReceived.bind(pc.outbox)
  pc.outbox.markReceived = (id) => { if (id !== raced.transferId) return origGet(id); pc.outbox.remove(id); return undefined }   // wpis znika, brama odpowie 404
  await waitFor(() => ph.dsh.sessions.length === before + 1)
  await new Promise((r) => setTimeout(r, 800))
  assert.equal(ph.dsh.sessions.length, before + 1, 'po 404 na potwierdzeniu brak ponownego importu')
  pc.outbox.markReceived = origGet

  // 1c. potwierdzenie pada (500), wpis zostaje w skrzynce: telefon ponawia samo potwierdzenie, bez drugiego importu.
  const before2 = ph.dsh.sessions.length
  const flaky = pc.outbox.add('s-pc', 'Z komputera, trzeci raz')
  let failOnce = true
  pc.outbox.markReceived = (id) => { if (id === flaky.transferId && failOnce) { failOnce = false; throw new Error('chwilowy błąd') } return origGet(id) }
  await waitFor(() => pc.outbox.waiting().length === 0)
  assert.equal(failOnce, false, 'pierwsze potwierdzenie rzeczywiście padło')
  assert.equal(ph.dsh.sessions.length, before2 + 1, 'po nieudanym potwierdzeniu sesja zaimportowana tylko raz')
  pc.outbox.markReceived = origGet

  // 2. telefon → komputer
  const sent = await ph.call('POST', '/export', { sessionId: 's-phone' })
  assert.equal(sent.status, 200, JSON.stringify(sent.json))
  assert.equal(pc.dsh.sessions.length, 1)
  assert.equal(pc.dsh.sessions[0].header.cwd, 'C:\\Users\\A\\deepseek-harness-default-workspace')
  assert.equal(pc.dsh.sessions[0].events[1].data.content[0].text, 'sesja z telefonu')
  assert.equal(sent.json.sessionId, pc.dsh.sessions[0].header.id)
  assert.equal(sent.json.events, 3)

  const missing = await ph.call('POST', '/export', {})
  assert.equal(missing.status, 400)

  // 3. skrzynka PC nie odpowiada: jeden wpis w logu (nie co obieg), po powrocie wpis „znowu odpowiada”.
  const logged = []
  const origLog = console.log
  console.log = (m, ...rest) => { if (String(m).includes('/outbox na')) logged.push(String(m)); else origLog(m, ...rest) }
  t.after(() => { console.log = origLog })
  const origWaiting = pc.outbox.waiting.bind(pc.outbox)
  pc.outbox.waiting = () => { throw new Error('skrzynka padła') }
  await new Promise((r) => setTimeout(r, 1000))   // ~5 obiegów po 200 ms
  pc.outbox.waiting = origWaiting
  await waitFor(() => logged.some((m) => m.includes('znowu odpowiada')))
  console.log = origLog
  assert.equal(logged.filter((m) => m.includes('nie odpowiada')).length, 1, `jeden wpis o błędzie: ${JSON.stringify(logged)}`)
  assert.match(logged[0], /HTTP 500|skrzynka padła/)
})

test('pliki projektu z sesją: komputer → telefon do osobnego obszaru, konflikt obok, sekrety i binarki pominięte', { skip: !REMOTE && 'brak DSH_REMOTE_PLUGIN' }, async (t) => {
  const { mkdirSync, writeFileSync, readFileSync, readdirSync } = await import('node:fs')
  const pcRoot = join(mkdtempSync(join(tmpdir(), 'pc-proj-')), 'PS5')
  const put = (rel, text) => { mkdirSync(join(pcRoot, rel, '..'), { recursive: true }); writeFileSync(join(pcRoot, rel), text) }
  put('a.txt', 'nowe z PC'); put('src/b.ps1', 'Write-Output ok'); put('.env', 'KEY=sekret'); put('bin/x.dll', 'MZ')
  put('notes/z-powloki.txt', 'zrobione poleceniem, nie narzędziem agenta')   // tryb „cały projekt” (workspace-files-project)
  const call = (seq, name, file_path) => ({ type: 'tool/call', seq, time: seq, data: { name, arguments: JSON.stringify({ file_path }) } })
  const events = [call(1, 'write', join(pcRoot, 'a.txt')), call(2, 'edit', 'src/b.ps1'), call(3, 'write', join(pcRoot, '.env')), call(4, 'write', join(pcRoot, 'bin/x.dll'))]
  const pc = await computer({ observe: () => ({ header: { cwd: pcRoot }, events }) })
  const home = mkdtempSync(join(tmpdir(), 'phone-home-'))
  const oldHome = process.env.HOME; process.env.HOME = home
  mkdirSync(join(home, 'PS5')); writeFileSync(join(home, 'PS5', 'a.txt'), 'stare z telefonu')
  const ph = await phone()
  t.after(async () => { process.env.HOME = oldHome; await ph.close(); await pc.close() })

  assert.equal((await ph.call('POST', '/devices', { url: pc.url })).status, 200)
  pc.outbox.add('s-pc', 'PS5 z komputera')
  await waitFor(() => ph.dsh.sessions.length === 1)
  await waitFor(() => pc.outbox.waiting().length === 0)
  const dest = join(home, 'PS5')
  const got = ph.dsh.sessions[0]
  assert.equal(got.header.cwd, dest, 'sesja dostaje katalog projektu jako cwd')
  assert.deepEqual(ph.dsh.get('workspaceRegistry').created.map((w) => [w.path, w.title]), [[dest, 'PS5']], 'osobny obszar roboczy')
  assert.equal(readFileSync(join(dest, 'a.txt'), 'utf8'), 'nowe z PC')
  assert.equal(readFileSync(join(dest, 'src', 'b.ps1'), 'utf8'), 'Write-Output ok', 'ścieżka względna z edit')
  assert.equal(readFileSync(join(dest, 'notes', 'z-powloki.txt'), 'utf8'), 'zrobione poleceniem, nie narzędziem agenta', 'cały projekt: plik spoza narzędzi agenta też przyszedł')
  const kept = readdirSync(dest).filter((n) => n.startsWith('a.txt.przed-importem-'))
  assert.equal(kept.length, 1); assert.equal(readFileSync(join(dest, kept[0]), 'utf8'), 'stare z telefonu', 'konflikt: stara wersja obok')
  assert.ok(!readdirSync(dest).includes('.env') && !readdirSync(dest).includes('bin'), 'sekret i binarka nie przyjechały')
  const note = ph.note(got.header.id)
  assert.match(note, /PS5/); assert.ok(note.includes(dest)); assert.match(note, /2 created, 0 updated, 1 conflicts/); assert.match(note, /1 skipped/)   // bin/ w trybie całego projektu nie jest w ogóle przechodzone
  assert.equal(ph.note('session-inna'), '', 'notka tylko w zaimportowanej sesji')
  assert.equal(ph.note(undefined), '')

  // 2. import tego samego projektu: a.txt zmieniony tylko na PC -> czysto; b.ps1 zmieniony na PC i na telefonie -> kopia
  put('a.txt', 'v2 z PC'); put('src/b.ps1', 'Write-Output v2')
  writeFileSync(join(dest, 'src', 'b.ps1'), 'zmiana na telefonie')
  pc.outbox.add('s-pc', 'PS5 drugi raz')
  await waitFor(() => ph.dsh.sessions.length === 2)
  await waitFor(() => pc.outbox.waiting().length === 0)
  assert.equal(readFileSync(join(dest, 'a.txt'), 'utf8'), 'v2 z PC')
  assert.equal(readdirSync(dest).filter((n) => n.startsWith('a.txt.przed-importem-')).length, 1, 'bez nowej kopii a.txt (tylko ta z 1. importu)')
  assert.equal(readFileSync(join(dest, 'src', 'b.ps1'), 'utf8'), 'Write-Output v2')
  const keptB = readdirSync(join(dest, 'src')).filter((n) => n.startsWith('b.ps1.przed-importem-'))
  assert.equal(keptB.length, 1); assert.equal(readFileSync(join(dest, 'src', keptB[0]), 'utf8'), 'zmiana na telefonie', 'zmiana z telefonu ocalała')
  assert.ok(!readdirSync(dest).some((n) => n.includes('.dsh-base-')), 'bez śladów odłożonych plików')
  const note2 = ph.note(ph.dsh.sessions[1].header.id)
  assert.match(note2, /0 created, 2 updated, 1 conflicts/)   // a.txt czysto + niezmieniony notes/z-powloki.txt (identyczny = written)

  // usunięcie sesji (wtyczka archiwizacji): notka znika, pliki projektu zostają
  const reg = ph.dsh.get('workspaceRegistry')
  reg.deleteSession = async () => ({ deleted: true })
  await waitFor(() => reg.deleteSession.dshCodeGuard === true, 8000)
  await reg.deleteSession(ph.dsh.sessions[1].header.id)
  assert.equal(ph.note(ph.dsh.sessions[1].header.id), '', 'notka usuniętej sesji wyczyszczona')
  assert.equal(readFileSync(join(dest, 'a.txt'), 'utf8'), 'v2 z PC', 'pliki projektu nietknięte')
})

test('nieudane /info nie wyłącza odbioru na 10 min: po powrocie komputera sesja przychodzi w kolejnym obiegu', { skip: !REMOTE && 'brak DSH_REMOTE_PLUGIN' }, async (t) => {
  const pc = await computer()
  let failInfo = false, infoCalls = 0
  const flaky = http.createServer((req, res) => {   // przed bramą PC: na żądanie /info odpowiada 503 (zimne połączenie)
    if (req.url.startsWith('/__remote/api/info')) { infoCalls++; if (failInfo && infoCalls > 1) { res.writeHead(503); return res.end('{}') } }   // 1. = sprawdzenie przy dodaniu
    const p = http.request({ host: '127.0.0.1', port: new URL(pc.url).port, method: req.method, path: req.url, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
    p.on('error', () => res.destroy())   // zamykanie serwerów po teście: bez tego „socket hang up” jako uncaughtException
    req.pipe(p)
  })
  const flakyPort = await listen(flaky)
  const ph = await phone()
  t.after(async () => { await ph.close(); flaky.closeAllConnections(); await new Promise((r) => flaky.close(r)); await pc.close() })
  failInfo = true
  assert.equal((await ph.call('POST', '/devices', { url: `http://127.0.0.1:${flakyPort}/` })).status, 200)
  assert.deepEqual((await ph.call('GET', '/transfer')).json.targets, [], 'komputer chwilowo bez /info')
  const before = infoCalls
  failInfo = false
  pc.outbox.add('s-pc', 'Po powrocie')
  await waitFor(() => ph.dsh.sessions.length === 1, 3000)
  assert.ok(infoCalls > before, 'telefon ponowił /info zamiast trzymać porażkę 10 min')
})

test('postęp: odbiór sesji z komputera widać w /transfer (bajty względem content-length), po imporcie lista pusta', { skip: !REMOTE && 'brak DSH_REMOTE_PLUGIN' }, async (t) => {
  const pc = await computer()
  const slow = http.createServer((req, res) => {   // przed bramą PC: eksport sesji oddawany porcjami co 150 ms
    const p = http.request({ host: '127.0.0.1', port: new URL(pc.url).port, method: req.method, path: req.url, headers: req.headers }, (r) => {
      if (!/^\/__remote\/api\/outbox\/[^/]+$/.test(req.url ?? '') || req.method !== 'GET') { res.writeHead(r.statusCode, r.headers); return r.pipe(res) }
      const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => {
        const buf = Buffer.concat(chunks); const parts = 6, size = Math.ceil(buf.length / parts)
        const { 'transfer-encoding': _te, ...headers } = r.headers
        res.writeHead(r.statusCode, { ...headers, 'content-length': String(buf.length) })
        let i = 0; const next = () => { if (i * size >= buf.length) return res.end(); res.write(buf.subarray(i * size, (i + 1) * size)); i++; setTimeout(next, 150) }; next()
      })
    })
    p.on('error', () => res.destroy())
    req.pipe(p)
  })
  const slowPort = await listen(slow)
  const ph = await phone()
  t.after(async () => { await ph.close(); slow.closeAllConnections(); await new Promise((r) => slow.close(r)); await pc.close() })
  assert.equal((await ph.call('POST', '/devices', { url: `http://127.0.0.1:${slowPort}/` })).status, 200)
  pc.outbox.add('s-pc', 'Powolna sesja')
  let seen = null
  for (const t0 = Date.now(); !seen && Date.now() - t0 < 5000; await new Promise((r) => setTimeout(r, 50))) {   // waitFor tu jest synchroniczne
    seen = (await ph.call('GET', '/transfer')).json.active.find((e) => e.dir === 'in' && e.total > 0 && e.bytes > 0 && e.bytes < e.total) ?? null
  }
  assert.ok(seen, 'w trakcie odbioru /transfer pokazuje częściowy postęp')
  assert.equal(seen.title, 'Powolna sesja'); assert.equal(seen.sessionId, null, 'nowa sesja: bez wiersza na liście')
  await waitFor(() => ph.dsh.sessions.length === 1, 5000)
  let left = 1
  for (const t0 = Date.now(); left && Date.now() - t0 < 3000; await new Promise((r) => setTimeout(r, 50))) left = (await ph.call('GET', '/transfer')).json.active.length
  assert.equal(left, 0, 'po imporcie bez aktywnych transferów')
})
