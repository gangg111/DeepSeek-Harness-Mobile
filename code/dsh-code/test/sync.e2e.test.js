// Synchronizacja powiązanych sesji: prawdziwa brama dsh-remote-control >= 0.3.1 (createGateway + createApi + createOutbox
// + createLinks + createLinkApi, ścieżka w DSH_REMOTE_PLUGIN) i prawdziwy dsh-code na telefonie (kurier), po obu stronach
// sztuczny DSH, którego agent odwzorowuje ReactLoopAgent z DSH 0.2 (jak test/takeover.test.js w repo PC): licznik tur
// czytany z projekcji `turnBoundary` tylko przy powstaniu agenta, `agent/status: running` emitowane synchronicznie,
// a `turn/start` zapisywany po sprawdzeniu przerwania i PRZED `agent/pre-step`. Bez wyrównania licznika (reloadSession)
// przejęcie dałoby drugi raz ten sam numer tury — test sprawdza numery tur. Bez DSH_REMOTE_PLUGIN test jest pomijany.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeZip } from '../test-support/zip-writer.js'

const REMOTE = process.env.DSH_REMOTE_PLUGIN
const OWNER = 'artur@example.com'
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)))
const waitFor = async (cond, ms = 8000) => { const t0 = Date.now(); while (!(await cond())) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 50)) } }

/** Zakończona tura `n` od numeru `seq0` (log startowy sesji). */
const turn = (seq0, n) => [
  { type: 'turn/start', seq: seq0, time: 1, data: { turn: n } },
  { type: 'user/message', seq: seq0 + 1, time: 1, data: { text: `pytanie ${n}` }, surfaceOp: 'append' },
  { type: 'turn/end', seq: seq0 + 2, time: 1, data: { turn: n } },
]
const turnsOf = (session) => session.events.filter((e) => e.type === 'turn/start').map((e) => e.data.turn)

class FakeAgent {
  constructor(dsh, session) {
    this.dsh = dsh
    this.session = session
    this.id = session.header.id
    this.requestHeaderLogged = true
    this.phase = { kind: 'idle', lastTurn: dsh.projections.stateOf(session, 'turnBoundary').lastTurn }
  }
  get status() { return this.phase.kind === 'running' ? 'running' : 'idle' }
  setPhase(next) {
    const before = this.status
    this.phase = next
    if (this.status !== before) this.dsh.emitStatus({ agent: this, status: this.status })
  }
  cancel(_cause, options = {}) {
    if (!options.keepInbox) this.session.append('agent/inbox/spliced', { cleared: true })
    if (this.phase.kind !== 'idle') this.phase.abort.abort()
  }
  /** Jedna tura z wiadomością usera (wakeDriver + kick). */
  followup(text) {
    this.setPhase({ kind: 'running', abort: new AbortController(), turn: this.phase.lastTurn, step: 0, wakeRequested: false })
    const phase = this.phase
    try {
      phase.abort.signal.throwIfAborted()
      const n = phase.turn + 1
      this.session.append('turn/start', { turn: n })
      phase.turn = n
      this.session.append('user/message', { text }, { surfaceOp: 'append' })
      this.session.append('turn/end', { turn: n })
    } catch {
      // przerwanie przed turn/start: nic nie zapisane
    } finally {
      this.setPhase({ kind: 'idle', lastTurn: phase.turn })
    }
  }
}

/** Sztuczny DSH: sesje, projekcja turnBoundary, rejestr agentów, session/event i agent/status do `hooks`. */
function fakeDsh(defaultPath, hooks = {}) {
  const sessions = new Map()
  const titles = new Map()
  const agents = new Map()
  const dsh = {
    emitStatus: (payload) => hooks['agent/status']?.(payload),
    projections: {
      stateOf: (session, key) => (key === 'turnBoundary' ? { lastTurn: Math.max(0, ...turnsOf(session)) } : undefined),
    },
  }
  const newSession = (header, events = []) => {
    const s = {
      header, events,
      append(type, data, opts) {
        const e = { type, seq: (this.events.at(-1)?.seq ?? -1) + 1, time: Date.now(), data, ...(opts ?? {}) }
        this.events.push(e)
        hooks['session/event']?.(this, e)
        return e
      },
    }
    sessions.set(header.id, s)
    return s
  }
  /** Wznowienie sesji jak w DSH: agent powstaje z logu. */
  const resume = (id) => { const a = new FakeAgent(dsh, sessions.get(id)); agents.set(id, a); return a }
  const services = {
    sessionPersistence: {
      async create(header) { const s = newSession(header); return { append: async (ev) => { s.events.push(...ev) }, flush: async () => {}, close: async () => {} } },
    },
    sessions: { get: (id) => sessions.get(id) },
    sessionQuery: {
      async observeSession(id) { const s = sessions.get(id); if (!s) throw new Error('not found'); return { header: s.header, events: [...s.events], [Symbol.dispose]() {} } },
      async readTitle(id) { return sessions.get(id) ? { text: titles.get(id) ?? `tytuł ${id}` } : null },
    },
    sessionProjections: dsh.projections,
    agents: { get: (id) => agents.get(id) },
    sessionController: {
      async list() { return { items: [] } },
      async rename({ sessionId, title }) { titles.set(sessionId, title); if (!agents.has(sessionId)) resume(sessionId) },
    },
    workspaceRegistry: {
      deleted: [], created: [],
      list() { return [{ id: 'def', path: defaultPath, attachSession: async () => {} }, ...this.created] },
      async create(path, title) { let w = this.created.find((x) => x.path === path); if (!w) { w = { id: `ws-${this.created.length + 1}`, path, title, attachSession: async () => {} }; this.created.push(w) } return w },
      resolveByPath: async () => undefined,
      async deleteSession(id) { this.deleted.push(id); return { deleted: true } },
    },
    attachments: { saveImage: async ({ data, mediaType }) => ({ attachmentId: 'sha256:' + 'e'.repeat(64), mediaType, bytes: data.length, width: 1, height: 1 }) },
  }
  return { sessions, titles, agents, newSession, resume, get: (n) => services[n] }
}

async function computer(opts = {}) {
  const imp = (f) => import(pathToFileURL(join(REMOTE, 'lib', f)).href)
  const [{ createGateway }, { createApi }, { createOutbox }, { createLinks }, { createLinkApi }, { createFileBase }] = await Promise.all(['gateway.js', 'api.js', 'outbox.js', 'links.js', 'link-api.js', 'file-base.js'].map(imp))
  const dsh = fakeDsh('C:\\Users\\A\\deepseek-harness-default-workspace')
  const dir = mkdtempSync(join(tmpdir(), 'pc-sync-'))
  const outbox = createOutbox(join(dir, 'outbox.json'))
  const links = createLinks(join(dir, 'links.json'))
  // Sesja na PC: tury 1 i 2, aktywny agent (licznik 2).
  dsh.newSession({ id: 's-pc', ...(opts.pcCwd ? { cwd: opts.pcCwd } : {}) }, [...turn(0, 1), ...turn(3, 2), ...(opts.extraEvents ?? [])])
  const agent = dsh.resume('s-pc')
  const exportOf = (id) => {
    const s = dsh.sessions.get(id)
    const header = { type: 'session', version: 4, id, createdAt: 1, cwd: 'C:\\proj', isSeeded: false, delegationDepth: 0 }
    return writeZip([['session.v4.jsonl', [header, ...s.events].map((l) => JSON.stringify(l)).join('\n') + '\n']])
  }
  const fileBase = createFileBase(join(dir, 'filebase.json'))
  const api = createApi({ fileBase,
    get: dsh.get, outbox, emit: () => {}, removeSession: async () => {}, dshVersion: '0.2.0-rc.2', syncEnabled: true,
    dsh: { exportSession: async (id) => new Response(exportOf(id), { status: 200 }) },
    linkApi: createLinkApi({ get: dsh.get, links, enabled: true, fileBase }),
  })
  const target = http.createServer((q, s) => { s.writeHead(401); s.end() })
  const targetPort = await listen(target)
  const gw = createGateway({ targetPort: () => targetPort, authenticatedUrl: () => '', admit: (l) => l === OWNER, api })
  const gwPort = await listen(gw.server)
  const serve = http.createServer(async (req, res) => {
    if (opts.intercept && await opts.intercept(req, res, gwPort)) return
    const p = http.request({ host: '127.0.0.1', port: gwPort, method: req.method, path: req.url, headers: { ...req.headers, 'tailscale-user-login': OWNER } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
    p.on('error', () => res.destroy())
    req.pipe(p)
  })
  const servePort = await listen(serve)
  return {
    url: `http://127.0.0.1:${servePort}/`, dsh, outbox, links, agent,
    link: () => links.list().find((l) => l.pcSessionId === 's-pc'),
    async close() { for (const s of [serve, target]) { s.closeAllConnections(); await new Promise((r) => s.close(r)) } await gw.close() },
  }
}

async function phone() {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-code-sync-'))
  process.env.DSH_CODE_OUTBOX_POLL_MS = '150'
  process.env.DSH_CODE_SYNC = '1'
  const { apply } = await import('../lib/index.js')
  const hooks = {}
  const dsh = fakeDsh('/storage/emulated/0/Download', hooks)
  const local = http.createServer((q, s) => { s.writeHead(401); s.end() })
  const localPort = await listen(local)
  let handler
  const effects = []
  const ctx = {
    webServer: { port: localPort, register(route) { handler = route.handler; return () => {} } },
    connection: { requestRejection: () => undefined, authenticatedUrl: (base) => `${base}/?token=x` },
    effect(fn) { const d = fn(); if (typeof d === 'function') effects.push(d) },
    get: dsh.get, emit: () => {},
    on(name, fn) { hooks[name] = fn },
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
    call, dsh,
    links: async () => (await call('GET', '/transfer')).json.links,
    async close() { for (const d of effects) d(); for (const s of [server, local]) { s.closeAllConnections(); await new Promise((r) => s.close(r)) } },
  }
}

test('synchronizacja: numery tur po synchronizacji i przejęciach, bramka lustra przed turn/start, gałąź przy rozjeździe', { skip: !REMOTE && 'brak DSH_REMOTE_PLUGIN' }, async (t) => {
  const pc = await computer()
  const ph = await phone()
  t.after(async () => { await ph.close(); await pc.close() })
  assert.equal((await ph.call('POST', '/devices', { url: pc.url })).status, 200)

  // Powiązanie do sesji, której nie ma na telefonie (np. testowe na PC): pomijane, nie przeszkadza reszcie.
  pc.links.create({ pcSessionId: 's-pc-inna', phoneSessionId: 'brak-na-telefonie', owner: 'pc', sharedCount: 1 })

  // 1. PC → telefon ze skrzynki; powiązanie z właścicielem PC, agent telefonu z licznikiem 2 (z logu).
  pc.outbox.add('s-pc', 'Z komputera')
  await waitFor(async () => (await ph.links()).length === 1)
  const link0 = (await ph.links())[0]
  assert.equal(link0.owner, 'pc')
  const phoneId = link0.phoneSessionId
  const phS = () => ph.dsh.sessions.get(phoneId)
  const pcS = () => pc.dsh.sessions.get('s-pc')
  const phAgent = () => ph.dsh.agents.get(phoneId)
  assert.deepEqual(turnsOf(phS()), [1, 2])

  // 2. Tura w lustrze na telefonie: przerwana PRZED turn/start (nic z tury nie trafia do logu).
  phAgent().followup('w lustrze')
  assert.deepEqual(turnsOf(phS()), [1, 2], 'lustro nie dostało turn/start')

  // 3. Tura 3 na PC trafia do lustra na telefonie, a licznik agenta telefonu jest wyrównany do 3.
  pc.agent.followup('pytanie 3 z PC')
  await waitFor(() => turnsOf(phS()).includes(3))
  await waitFor(() => phAgent().phase.lastTurn === 3)

  // 4. Telefon przejmuje pisanie; jego tura dostaje numer 4 (nie 3) i trafia do lustra na PC, gdzie licznik też jest wyrównany.
  const claimed = await ph.call('POST', `/links/${link0.linkId}/claim`)
  assert.equal(claimed.status, 200, JSON.stringify(claimed.json))
  assert.equal(pc.link().owner, 'phone')
  phAgent().followup('pytanie 4 z telefonu')
  assert.deepEqual(turnsOf(phS()), [1, 2, 3, 4])
  await waitFor(() => turnsOf(pcS()).includes(4))
  assert.equal(pc.agent.phase.lastTurn, 4, 'agent PC wyrównany po dopisaniu ogona telefonu')

  // 4b. Bramka właściciela: agent telefonu ma nieaktualny licznik (symulacja brakującego wyrównania) — tura przerwana przed
  //     turn/start, licznik wyrównany, powiązanie wstrzymane po obu stronach; „Wznów synchronizację” je zdejmuje.
  phAgent().phase.lastTurn = 3
  phAgent().followup('z nieaktualnym licznikiem')
  assert.deepEqual(turnsOf(phS()), [1, 2, 3, 4], 'przerwana tura nie zapisała turn/start')
  assert.equal(phAgent().phase.lastTurn, 4, 'licznik wyrównany do logu')
  await waitFor(() => Boolean(pc.link().paused))
  assert.match(pc.link().paused.message, /^Telefon: /)
  assert.ok((await ph.links())[0].paused, 'telefon pokazuje wstrzymanie')
  const resumed = await ph.call('POST', `/links/${link0.linkId}/resume`)
  assert.equal(resumed.status, 200, JSON.stringify(resumed.json))
  assert.equal(pc.link().paused ?? null, null)

  // 5. PC prosi o przejęcie, telefon oddaje pisanie; następna tura PC ma numer 5 i trafia na telefon z licznikiem 5.
  pc.links.requestClaim(pc.link().linkId)
  await waitFor(() => pc.link().owner === 'pc')
  await waitFor(async () => (await ph.links())[0]?.owner === 'pc')
  pc.agent.followup('pytanie 5 z PC')
  assert.deepEqual(turnsOf(pcS()).slice(-2), [4, 5])
  await waitFor(() => turnsOf(phS()).includes(5))
  await waitFor(() => phAgent().phase.lastTurn === 5)
  phAgent().followup('znów w lustrze')
  assert.equal(turnsOf(phS()).at(-1), 5, 'po oddaniu pisania telefon znów jest lustrem (bez turn/start)')

  // 6. Rozjazd: telefon przejmuje i pisze turę 6, a PC w tej samej chwili przejmuje bez telefonu i pisze swoją.
  assert.equal((await ph.call('POST', `/links/${link0.linkId}/claim`)).status, 200)
  phAgent().followup('pytanie 6 z telefonu')
  const l = pc.link()
  pc.links.switchOwner(l.linkId, { to: 'pc', epoch: l.epoch, force: true, mirrorLast: pcS().events.at(-1).seq })
  pc.agent.followup('pytanie 6 z PC')
  await waitFor(() => !pc.links.list().some((x) => x.pcSessionId === 's-pc'))
  await waitFor(async () => (await ph.links()).length === 0)
  assert.match(ph.dsh.titles.get(phoneId), /\(gałąź z telefonu\)$/)
  assert.equal(phS().events.filter((e) => e.type === 'user/message').at(-1).data.text, 'pytanie 6 z telefonu')
  assert.equal(pcS().events.filter((e) => e.type === 'user/message').at(-1).data.text, 'pytanie 6 z PC')
})

test('synchronizacja: odłączenie z telefonu usuwa powiązanie na PC i zdejmuje lustro', { skip: !REMOTE && 'brak DSH_REMOTE_PLUGIN' }, async (t) => {
  const pc = await computer()
  const ph = await phone()
  t.after(async () => { await ph.close(); await pc.close() })
  assert.equal((await ph.call('POST', '/devices', { url: pc.url })).status, 200)
  pc.outbox.add('s-pc', 'Z komputera')
  await waitFor(async () => (await ph.links()).length === 1)
  const link = (await ph.links())[0]
  // usuwanie (wtyczka archiwizacji) sesji synchronizowanej: odmowa z komunikatem, dopóki jest powiązanie
  const reg = ph.dsh.get('workspaceRegistry')
  await waitFor(() => reg.deleteSession.dshCodeGuard === true)
  await assert.rejects(reg.deleteSession(link.phoneSessionId), /synchronizowana z komputerem .*odłącz synchronizację/)
  assert.deepEqual(reg.deleted, [])
  assert.equal((await ph.call('DELETE', `/links/${link.linkId}`)).status, 200)
  assert.deepEqual(await reg.deleteSession(link.phoneSessionId), { deleted: true }, 'po odłączeniu usuwanie przechodzi')
  assert.deepEqual(reg.deleted, [link.phoneSessionId])
  reg.deleted.length = 0
  assert.equal(pc.links.list().length, 0)
  assert.equal((await ph.links()).length, 0)
  const before = turnsOf(ph.dsh.sessions.get(link.phoneSessionId)).length
  ph.dsh.agents.get(link.phoneSessionId).followup('po odłączeniu')
  assert.equal(turnsOf(ph.dsh.sessions.get(link.phoneSessionId)).length, before + 1, 'po odłączeniu sesja na telefonie jest zwykłą sesją')
})

test('ponowne wysłanie powiązanej sesji z PC aktualizuje istniejącą kopię zamiast tworzyć drugą', { skip: !REMOTE && 'brak DSH_REMOTE_PLUGIN' }, async (t) => {
  const pc = await computer()
  const ph = await phone()
  t.after(async () => { await ph.close(); await pc.close() })
  assert.equal((await ph.call('POST', '/devices', { url: pc.url })).status, 200)
  pc.outbox.add('s-pc', 'Z komputera')
  await waitFor(async () => (await ph.links()).length === 1)
  const { phoneSessionId } = (await ph.links())[0]
  pc.agent.followup('nowa tura na PC')
  pc.outbox.add('s-pc', 'Drugi raz')
  await waitFor(() => pc.outbox.waiting().length === 0)
  await waitFor(() => ph.dsh.sessions.get(phoneSessionId).events.some((e) => e.type === 'user/message' && e.data.text === 'nowa tura na PC'))
  assert.equal(ph.dsh.sessions.size, 1, 'bez drugiej kopii na telefonie')
  assert.equal((await ph.links()).length, 1, 'jedno powiązanie')
  assert.equal(pc.links.list().length, 1)
})

test('faza 2: pliki zmienione na telefonie wracają na PC przed oddaniem pisania (prawdziwa trasa PC)', { skip: !REMOTE && 'brak DSH_REMOTE_PLUGIN' }, async (t) => {
  const { writeFileSync, readdirSync } = await import('node:fs')
  const pcRoot = join(mkdtempSync(join(tmpdir(), 'pc-root-')), 'proj')
  const { mkdirSync } = await import('node:fs'); mkdirSync(pcRoot)
  writeFileSync(join(pcRoot, 'a.txt'), 'z PC')
  const write = { type: 'tool/call', seq: 6, time: 6, data: { name: 'write', arguments: JSON.stringify({ file_path: join(pcRoot, 'a.txt') }) } }
  const pc = await computer({ pcCwd: pcRoot, extraEvents: [write] })
  const home = mkdtempSync(join(tmpdir(), 'phone-home-')); const oldHome = process.env.HOME; process.env.HOME = home
  const ph = await phone()
  t.after(async () => { process.env.HOME = oldHome; await ph.close(); await pc.close() })
  assert.equal((await ph.call('POST', '/devices', { url: pc.url })).status, 200)
  pc.outbox.add('s-pc', 'Z komputera')
  await waitFor(async () => (await ph.links()).length === 1)
  const link0 = (await ph.links())[0]
  const dir = join(home, 'proj')
  await waitFor(() => { try { return readFileSync(join(dir, 'a.txt'), 'utf8') === 'z PC' } catch { return false } })
  assert.equal((await ph.call('POST', `/links/${link0.linkId}/claim`)).status, 200)
  // praca na telefonie: dopisek do pliku z PC, nowy plik „z powłoki”, kopia konfliktu (zostaje na telefonie)
  writeFileSync(join(dir, 'a.txt'), 'z PC + dopisek z telefonu'); writeFileSync(join(dir, 'b.txt'), 'nowy z telefonu')
  writeFileSync(join(dir, 'a.txt.przed-importem-2026'), 'stara kopia')
  pc.links.requestClaim(pc.link().linkId)
  await waitFor(() => pc.link().owner === 'pc')
  assert.equal(readFileSync(join(pcRoot, 'a.txt'), 'utf8'), 'z PC + dopisek z telefonu', 'PC ma dopisek z telefonu')
  assert.equal(readFileSync(join(pcRoot, 'b.txt'), 'utf8'), 'nowy z telefonu')
  assert.deepEqual(readdirSync(pcRoot).sort(), ['a.txt', 'b.txt'], 'bez kopii (a.txt niezmieniony na PC od wysłania) i bez kopii konfliktu z telefonu')
  // drugi cykl: zmiana na telefonie i JEDNOCZEŚNIE na PC -> na PC kopia wersji PC
  assert.equal((await ph.call('POST', `/links/${link0.linkId}/claim`)).status, 200)
  writeFileSync(join(dir, 'b.txt'), 'b v2 z telefonu'); writeFileSync(join(pcRoot, 'b.txt'), 'b zmieniony na PC')
  pc.links.requestClaim(pc.link().linkId)
  await waitFor(() => pc.link().owner === 'pc')
  assert.equal(readFileSync(join(pcRoot, 'b.txt'), 'utf8'), 'b v2 z telefonu')
  const kept = readdirSync(pcRoot).filter((n) => n.startsWith('b.txt.przed-importem-'))
  assert.equal(kept.length, 1); assert.equal(readFileSync(join(pcRoot, kept[0]), 'utf8'), 'b zmieniony na PC', 'zmiana z PC ocalała')
  // 3. PC zmienia plik po zwrocie; telefon przejmuje pisanie i od razu ma wersję z PC (workspace-files-pull), bez kopii
  writeFileSync(join(pcRoot, 'a.txt'), 'a v3 z PC')
  const claimed3 = await ph.call('POST', `/links/${link0.linkId}/claim`)
  assert.equal(claimed3.status, 200, JSON.stringify(claimed3.json))
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'a v3 z PC', 'po przejęciu (przed pierwszą turą) telefon ma zmianę z PC')
  assert.equal(readdirSync(dir).filter((n) => n.startsWith('a.txt.przed-importem-') && n !== 'a.txt.przed-importem-2026').length, 0, 'bez nowej kopii na telefonie')
  // i z powrotem: telefon niczego nie zmienił -> PC bez nowych kopii a.txt
  pc.links.requestClaim(pc.link().linkId)
  await waitFor(() => pc.link().owner === 'pc')
  assert.equal(readFileSync(join(pcRoot, 'a.txt'), 'utf8'), 'a v3 z PC')
  assert.equal(readdirSync(pcRoot).filter((n) => n.startsWith('a.txt.przed-importem-')).length, 0)
})

test('faza 2: nieudane pobranie plików po przejęciu blokuje oddanie pisania, aż pliki dojdą', { skip: !REMOTE && 'brak DSH_REMOTE_PLUGIN' }, async (t) => {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const pcRoot = join(mkdtempSync(join(tmpdir(), 'pc-root-')), 'proj'); mkdirSync(pcRoot)
  writeFileSync(join(pcRoot, 'a.txt'), 'z PC')
  const write = { type: 'tool/call', seq: 6, time: 6, data: { name: 'write', arguments: JSON.stringify({ file_path: join(pcRoot, 'a.txt') }) } }
  let breakPull = false, breakAck = false
  const pulls = [], acks = []
  const intercept = async (req, res) => {
    if (req.method === 'GET' && /\/links\/[^/]+\/files/.test(req.url ?? '')) pulls.push(req.url)
    if (req.method === 'POST' && /\/files-applied$/.test(req.url ?? '')) { acks.push(req.url); if (breakAck) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"awaria potwierdzenia"}'); return true } }
    if (breakPull && req.method === 'GET' && /\/__remote\/api\/links\/[^/]+\/files(\?|$)/.test(req.url ?? '')) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"awaria testowa"}'); return true }
    return false
  }
  const pc = await computer({ pcCwd: pcRoot, extraEvents: [write], intercept })
  const home = mkdtempSync(join(tmpdir(), 'phone-home-')); const oldHome = process.env.HOME; process.env.HOME = home
  const ph = await phone()
  t.after(async () => { process.env.HOME = oldHome; await ph.close(); await pc.close() })
  assert.equal((await ph.call('POST', '/devices', { url: pc.url })).status, 200)
  pc.outbox.add('s-pc', 'Z komputera')
  await waitFor(async () => (await ph.links()).length === 1)
  const link0 = (await ph.links())[0]
  const dir = join(home, 'proj')
  await waitFor(() => { try { return readFileSync(join(dir, 'a.txt'), 'utf8') === 'z PC' } catch { return false } })
  writeFileSync(join(pcRoot, 'a.txt'), 'zmiana na PC')
  breakPull = true
  const claimed = await ph.call('POST', `/links/${link0.linkId}/claim`)
  assert.equal(claimed.status, 409); assert.match(claimed.json.error, /pliki projektu z komputera nie doszły/)
  pc.links.requestClaim(pc.link().linkId)
  await new Promise((r) => setTimeout(r, 1500))
  assert.equal(pc.link().owner, 'phone', 'bez plików z PC telefon nie oddaje pisania')
  assert.equal(readFileSync(join(pcRoot, 'a.txt'), 'utf8'), 'zmiana na PC', 'zmiana na PC nienadpisana')
  breakPull = false
  await waitFor(() => pc.link().owner === 'pc', 8000)
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'zmiana na PC', 'po ponowieniu telefon ma wersję z PC')
  assert.equal(readFileSync(join(pcRoot, 'a.txt'), 'utf8'), 'zmiana na PC')
  assert.ok(pulls.length > 0 && pulls.every((u) => /[?&]ack=1(&|$)/.test(u) && /[?&]scope=project(&|$)/.test(u)), 'pobranie z potwierdzeniem, cały projekt')
  assert.ok(acks.length >= 1)

  // potwierdzenie nie dochodzi: pliki już są na telefonie, ale PC nie przesuwa bazy; telefon czeka z oddaniem pisania
  writeFileSync(join(pcRoot, 'a.txt'), 'PC v2')
  breakAck = true
  const claimed2 = await ph.call('POST', `/links/${link0.linkId}/claim`)
  assert.equal(claimed2.status, 200, 'pliki doszły, tylko potwierdzenie nie')
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'PC v2')
  pc.links.requestClaim(pc.link().linkId)
  await new Promise((r) => setTimeout(r, 1500))
  assert.equal(pc.link().owner, 'phone', 'bez potwierdzenia telefon nie oddaje pisania')
  const acksBefore = acks.length
  breakAck = false
  await waitFor(() => pc.link().owner === 'pc', 8000)
  assert.ok(acks.length > acksBefore, 'potwierdzenie ponowione')
  const { readdirSync } = await import('node:fs')
  assert.equal(readdirSync(pcRoot).filter((n) => n.startsWith('a.txt.przed-importem-')).length, 0, 'na PC bez zbędnych kopii')
})
