/**
 * dsh-code (serwer DSH na telefonie): lista komputerow z wtyczka dsh-remote-control i ich sesji
 * dla ekranu „Code”. Zapytania do komputerow ida z tego procesu (przez Tailscale na telefonie),
 * bo przegladarka nie moze pytac komputera bezposrednio (inne pochodzenie, SameSite=Strict).
 *
 * Trasy pod /api/dsh-code wymagaja tej samej sesji co interfejs DSH (ctx.connection.admit),
 * wiec inne aplikacje na telefonie nie moga przez nie sterowac komputerem.
 * Dane: $DSH_HOME/dsh-code.json (urzadzenia + ostatnio widziane sesje, pokazywane jako Rozlaczone).
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-code'
export const inject = ['webServer', 'connection']

const PREFIX = '/api/dsh-code'
const TIMEOUT_MS = 6000
const MAX_BODY = 64 * 1024

export function apply(ctx) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const file = join(home, 'dsh-code.json')
  let data = load()

  function load() {
    try {
      const d = JSON.parse(readFileSync(file, 'utf8'))
      return { devices: Array.isArray(d.devices) ? d.devices : [], cache: d.cache && typeof d.cache === 'object' ? d.cache : {} }
    } catch { return { devices: [], cache: {} } }
  }
  function save() {
    mkdirSync(home, { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2))
    renameSync(tmp, file)
  }

  async function remote(device, path, init = {}) {
    const res = await fetch(new URL(`__remote/api${path}`, device.url), { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS), headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
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
    const sessions = results.flatMap(({ device, sessions: list }) => list.map((s) => ({ ...s, deviceId: device.id, deviceName: device.name, deviceUrl: device.url, connected: device.connected })))
    sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    return { devices: results.map((r) => r.device), sessions }
  }

  async function addDevice(body) {
    const url = normalizeUrl(body.url)
    if (data.devices.some((d) => d.url === url)) throw Object.assign(new Error('To urządzenie jest już dodane.'), { status: 409 })
    let info
    try { info = await remote({ url }, '/info') } catch (error) {
      throw Object.assign(new Error(`Nie mogę połączyć się z ${url}: ${describe(error)}`), { status: 502 })
    }
    data.devices.push({ id: randomUUID(), name: info.name || new URL(url).hostname.split('.')[0], url })
    save()
    return state()
  }

  function removeDevice(id) {
    data.devices = data.devices.filter((d) => d.id !== id)
    delete data.cache[id]
    save()
    return state()
  }

  function device(id) {
    const d = data.devices.find((x) => x.id === id)
    if (!d) throw Object.assign(new Error('Nieznane urządzenie.'), { status: 404 })
    return d
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      const admission = ctx.connection.admit(req)
      if ('rejection' in admission) return send(res, admission.rejection, { error: 'unauthorized' })
      const url = new URL(req.url ?? '/', 'http://local')
      const route = `${req.method} ${url.pathname.slice(PREFIX.length)}`
      try {
        if (route === 'GET /state') return send(res, 200, await state())
        if (route === 'POST /devices') return send(res, 200, await addDevice(await readJson(req)))
        if (req.method === 'DELETE' && url.pathname.startsWith(`${PREFIX}/devices/`)) return send(res, 200, await removeDevice(decodeURIComponent(url.pathname.slice(`${PREFIX}/devices/`.length))))
        if (route === 'GET /workspaces') return send(res, 200, await remote(device(url.searchParams.get('device')), '/workspaces'))
        if (route === 'POST /sessions') {
          const body = await readJson(req)
          const d = device(body.device)
          const created = await remote(d, '/sessions', { method: 'POST', body: JSON.stringify({ workspaceId: body.workspaceId, text: body.text }), timeoutMs: 30000 })
          return send(res, 200, { ...created, openUrl: `${d.url}?dshOpen=${encodeURIComponent(created.sessionId)}` })
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
