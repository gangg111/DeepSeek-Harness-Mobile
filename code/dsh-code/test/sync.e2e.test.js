// Synchronizacja powiązanych sesji: prawdziwa brama dsh-remote-control >= 0.3.1 (createGateway + createApi + createOutbox
// + createLinks + createLinkApi, ścieżka w DSH_REMOTE_PLUGIN) i prawdziwy dsh-code na telefonie (kurier), po obu stronach
// sztuczny DSH, którego agent odwzorowuje ReactLoopAgent z DSH 0.2 (jak test/takeover.test.js w repo PC): licznik tur
// czytany z projekcji `turnBoundary` tylko przy powstaniu agenta, `agent/status: running` emitowane synchronicznie,
// a `turn/start` zapisywany po sprawdzeniu przerwania i PRZED `agent/pre-step`. Bez wyrównania licznika (reloadSession)
// przejęcie dałoby drugi raz ten sam numer tury — test sprawdza numery tur. Bez DSH_REMOTE_PLUGIN test jest pomijany.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync } from 'node:fs'
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
      async observeSession(id) { const s = sessions.get(id); if (!s) throw new Error('not found'); return { events: [...s.events], [Symbol.dispose]() {} } },
      async readTitle(id) { return sessions.get(id) ? { text: titles.get(id) ?? `tytuł ${id}` } : null },
    },
    sessionProjections: dsh.projections,
    agents: { get: (id) => agents.get(id) },
    sessionController: {
      async list() { return { items: [] } },
      async rename({ sessionId, title }) { titles.set(sessionId, title); if (!agents.has(sessionId)) resume(sessionId) },
    },
    workspaceRegistry: { list: () => [{ id: 'def', path: defaultPath, attachSession: async () => {} }], resolveByPath: async () => undefined },
    attachments: { saveImage: async ({ data, mediaType }) => ({ attachmentId: 'sha256:' + 'e'.repeat(64), mediaType, bytes: data.length, width: 1, height: 1 }) },
  }
  return { sessions, titles, agents, newSession, resume, get: (n) => services[n] }
}

async function computer() {
  const imp = (f) => import(pathToFileURL(join(REMOTE, 'lib', f)).href)
  const [{ createGateway }, { createApi }, { createOutbox }, { createLinks }, { createLinkApi }] = await Promise.all(['gateway.js', 'api.js', 'outbox.js', 'links.js', 'link-api.js'].map(imp))
  const dsh = fakeDsh('C:\\Users\\A\\deepseek-harness-default-workspace')
  const dir = mkdtempSync(join(tmpdir(), 'pc-sync-'))
  const outbox = createOutbox(join(dir, 'outbox.json'))
  const links = createLinks(join(dir, 'links.json'))
  // Sesja na PC: tury 1 i 2, aktywny agent (licznik 2).
  dsh.newSession({ id: 's-pc' }, [...turn(0, 1), ...turn(3, 2)])
  const agent = dsh.resume('s-pc')
  const exportOf = (id) => {
    const s = dsh.sessions.get(id)
    const header = { type: 'session', version: 4, id, createdAt: 1, cwd: 'C:\\proj', isSeeded: false, delegationDepth: 0 }
    return writeZip([['session.v4.jsonl', [header, ...s.events].map((l) => JSON.stringify(l)).join('\n') + '\n']])
  }
  const api = createApi({
    get: dsh.get, outbox, emit: () => {}, removeSession: async () => {}, dshVersion: '0.2.0-rc.2', syncEnabled: true,
    dsh: { exportSession: async (id) => new Response(exportOf(id), { status: 200 }) },
    linkApi: createLinkApi({ get: dsh.get, links, enabled: true }),
  })
  const target = http.createServer((q, s) => { s.writeHead(401); s.end() })
  const targetPort = await listen(target)
  const gw = createGateway({ targetPort: () => targetPort, authenticatedUrl: () => '', admit: (l) => l === OWNER, api })
  const gwPort = await listen(gw.server)
  const serve = http.createServer((req, res) => {
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
  assert.equal((await ph.call('DELETE', `/links/${link.linkId}`)).status, 200)
  assert.equal(pc.links.list().length, 0)
  assert.equal((await ph.links()).length, 0)
  const before = turnsOf(ph.dsh.sessions.get(link.phoneSessionId)).length
  ph.dsh.agents.get(link.phoneSessionId).followup('po odłączeniu')
  assert.equal(turnsOf(ph.dsh.sessions.get(link.phoneSessionId)).length, before + 1, 'po odłączeniu sesja na telefonie jest zwykłą sesją')
})
