// Test obu wtyczek razem: dsh-code (telefon) -> pośrednik udający `tailscale serve` (dokleja
// Tailscale-User-Login) -> brama dsh-remote-tailscale z API na fałszywych usługach DSH (komputer).
// Ścieżkę do wtyczki komputera podaje DSH_REMOTE_PLUGIN; bez niej test jest pomijany.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { apply, normalizeUrl } from '../lib/index.js'

const REMOTE = process.env.DSH_REMOTE_PLUGIN
const OWNER = 'artur@example.com'

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)))

async function pc() {
  const { createGateway } = await import(pathToFileURL(join(REMOTE, 'lib', 'gateway.js')).href)
  const { createApi } = await import(pathToFileURL(join(REMOTE, 'lib', 'api.js')).href)
  const prompts = []
  const services = {
    sessionController: {
      async list() { return { items: [{ sessionId: 's1', updatedAt: Date.now() - 60_000, running: true, cwd: 'C:\\proj\\alpha', projections: { kind: 'x', asOfSeq: 1, values: { title: 'Build apki' } } }] } },
      async create(req) { return { sessionId: `nowa-${req.workspaceId}` } },
      async prompt(req) { prompts.push(req); return { accepted: true } },
    },
    sessionQuery: { async filterEvents() { return [{ type: 'assistant/message', text: 'Przesłać to tam?' }] }, async readTitle() { return undefined } },
    workspaceRegistry: { list: () => [{ id: 'w1', name: 'alpha', path: 'C:\\proj\\alpha' }], resolveByPath: async () => ({ name: 'alpha' }) },
  }
  const dsh = http.createServer((req, res) => { res.writeHead(401); res.end() })
  const dshPort = await listen(dsh)
  const gw = createGateway({ targetPort: () => dshPort, authenticatedUrl: () => '', admit: (l) => l === OWNER, api: createApi({ get: (n) => services[n] }) })
  const gwPort = await listen(gw.server)
  // `tailscale serve`: TLS pomijamy, ale tozsamosc dokleja zawsze (nadpisuje to, co przyslal klient).
  const serve = http.createServer((req, res) => {
    const headers = { ...req.headers, 'tailscale-user-login': OWNER }
    const p = http.request({ host: '127.0.0.1', port: gwPort, method: req.method, path: req.url, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
    req.pipe(p)
  })
  const servePort = await listen(serve)
  return {
    url: `http://127.0.0.1:${servePort}/`, prompts,
    async close() { for (const s of [serve, dsh]) { s.closeAllConnections(); await new Promise((r) => s.close(r)) } await gw.close() },
  }
}

async function phone() {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-code-'))
  let handler
  let allowed = true
  const ctx = {
    webServer: { register(route) { handler = route.handler; return () => {} } },
    connection: { admit: () => (allowed ? { peer: {} } : { rejection: 401 }) },
    effect(fn) { fn() },
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
  return { call, deny() { allowed = false }, async close() { server.closeAllConnections(); await new Promise((r) => server.close(r)) } }
}

test('adres urządzenia: sama nazwa z Tailscale dostaje https i ukośnik', () => {
  assert.equal(normalizeUrl(' pc.tail1234.ts.net '), 'https://pc.tail1234.ts.net/')
  assert.equal(normalizeUrl('https://pc.tail1234.ts.net/cokolwiek'), 'https://pc.tail1234.ts.net/')
})

test('telefon <-> komputer: urządzenie, sesje, obszary, nowa sesja, rozłączenie, brak sesji DSH', { skip: !REMOTE && 'brak DSH_REMOTE_PLUGIN' }, async (t) => {
  const computer = await pc()
  const ph = await phone()
  t.after(async () => { await ph.close() })

  const added = await ph.call('POST', '/devices', { url: computer.url })
  assert.equal(added.status, 200)
  assert.equal(added.json.devices.length, 1)
  const dev = added.json.devices[0]
  assert.equal(dev.connected, true)
  assert.ok(dev.name.length > 0, 'nazwa komputera z /__remote/api/info')

  const st = await ph.call('GET', '/state')
  assert.deepEqual(st.json.sessions.map((s) => [s.sessionId, s.title, s.workspace, s.running, s.connected, s.last.text]),
    [['s1', 'Build apki', 'alpha', true, true, 'Przesłać to tam?']])

  const ws = await ph.call('GET', `/workspaces?device=${dev.id}`)
  assert.deepEqual(ws.json.workspaces.map((w) => w.id), ['w1'])

  const created = await ph.call('POST', '/sessions', { device: dev.id, workspaceId: 'w1', text: 'zbuduj apkę' })
  assert.equal(created.json.sessionId, 'nowa-w1')
  assert.equal(created.json.openUrl, `${computer.url}?dshOpen=nowa-w1`)
  assert.equal(computer.prompts[0].content[0].text, 'zbuduj apkę')

  await computer.close()
  const off = await ph.call('GET', '/state')
  assert.equal(off.json.devices[0].connected, false)
  assert.equal(off.json.sessions[0].connected, false, 'ostatnio widziane sesje zostają jako Rozłączone')
  assert.equal(off.json.sessions[0].title, 'Build apki')

  ph.deny()
  const denied = await ph.call('GET', '/state')
  assert.equal(denied.status, 401, 'bez sesji DSH na telefonie trasy są zamknięte')
})
