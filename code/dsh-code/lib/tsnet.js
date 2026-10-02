/**
 * Węzeł Tailscale wbudowany w apkę: nadzór nad procesem dsh-tsnet-mobile (Go, tsnet) i jego API sterującym.
 * Sekret losujemy tu i przekazujemy TYLKO przez env; każde żądanie do API i do pośredników niesie go w nagłówku
 * X-DSH-Secret. Stan węzła (BackendState, AuthURL) przychodzi liniami JSON na stdout.
 */

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'

export const SECRET_HEADER = 'X-DSH-Secret'
const RESTART_MS = 3000

/** Wolny port na pętli zwrotnej (API sterujące programu Go). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
  })
}

/** Adres pierwszego wejścia WebView do pośrednika: ustawia ciasteczko sesji i przekierowuje bez dshrk. */
export function openUrl(origin, secret, sessionId) {
  const u = new URL('/', origin)
  u.searchParams.set('dshrk', secret)
  if (sessionId) u.searchParams.set('dshOpen', sessionId)
  return u.toString()
}

/** Jedna linia stdout programu Go -> obiekt stanu albo null (śmieci/puste linie ignorujemy). */
export function parseStateLine(line) {
  const t = String(line).trim()
  if (!t.startsWith('{')) return null
  try { const o = JSON.parse(t); return typeof o === 'object' && o ? o : null } catch { return null }
}

/**
 * Startuje i nadzoruje dsh-tsnet-mobile. Zwraca uchwyt: state(), ensureProxy(target, port), headers(), secret, stop().
 * @param {{bin:string, dir:string, hostname?:string, log?:(s:string)=>void}} opts
 */
export function startTsnet({ bin, dir, hostname = 'dsh-mobile', log = () => {}, onPeers = () => {} }) {
  const secret = randomBytes(32).toString('hex')
  let child = null, controlPort = 0, stopping = false, restartTimer = null
  let state = { BackendState: 'Starting' }
  let peers = []

  async function launch() {
    controlPort = await freePort()
    const env = { ...process.env, DSH_TSNET_SECRET: secret }
    child = spawn(bin, ['--dir', dir, '--hostname', hostname, '--listen', `127.0.0.1:${controlPort}`], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    log(`tsnet: start pid ${child.pid}, API 127.0.0.1:${controlPort}`)
    let buf = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const o = parseStateLine(buf.slice(0, i)); buf = buf.slice(i + 1)
        if (!o) continue
        if (Array.isArray(o.Peers)) { peers = o.Peers; log(`tsnet: urządzenia w sieci: ${peers.length} (online ${peers.filter((p) => p.Online).length})`); try { onPeers(peers) } catch (e) { log(`tsnet: onPeers: ${e.message}`) }; continue }
        state = o; log(`tsnet: ${o.BackendState ?? ''}${o.Error ? ' error ' + o.Error : ''}${o.AuthURL ? ' (czeka na logowanie)' : ''}`)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d) => { for (const l of String(d).split('\n')) if (l.trim()) log(`tsnet: ${l}`) })
    child.on('exit', (code, sig) => {
      log(`tsnet: proces zakończony (${code ?? sig})`)
      child = null; state = { BackendState: 'Stopped', Error: `proces zakończony (${code ?? sig})` }
      if (!stopping) restartTimer = setTimeout(() => launch().catch((e) => log(`tsnet: restart nieudany: ${e.message}`)), RESTART_MS)
    })
    child.on('error', (e) => log(`tsnet: ${e.message}`))
  }

  async function control(path, init = {}, timeoutMs = 5000) {
    if (!child) throw new Error('węzeł Tailscale nie działa')
    const res = await fetch(`http://127.0.0.1:${controlPort}${path}`, { ...init, headers: { 'content-type': 'application/json', [SECRET_HEADER]: secret, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `tsnet API HTTP ${res.status}`)
    return body
  }

  launch().catch((e) => { log(`tsnet: start nieudany: ${e.message}`); state = { BackendState: 'Stopped', Error: e.message } })

  return {
    secret,
    state: () => state,
    peers: () => peers,
    /** GET https://<target>/__remote/api/info przez tsnet (limit 4 s w programie Go); {target, status, body|error}. */
    probe: (target) => control('/probe', { method: 'POST', body: JSON.stringify({ target }) }, 8000),
    running: () => !!child && state.BackendState === 'Running',
    headers: () => ({ [SECRET_HEADER]: secret }),
    /** Pośrednik dla komputera; `port` = zapamiętany (0 = dowolny). Zwraca {port, origin} — port zapisać, gdy inny. */
    ensureProxy: (target, port = 0) => control('/proxy', { method: 'POST', body: JSON.stringify({ target, port }) }),
    stop() {
      stopping = true
      clearTimeout(restartTimer)
      if (child) { child.stdin.end(); setTimeout(() => child?.kill(), 2000) }   // EOF na stdin = program kończy sam
    },
  }
}

export function tsnetBinaryPath() {
  if (process.env.DSH_TSNET_BIN) return process.env.DSH_TSNET_BIN
  const p = new URL('../../bin/dsh-tsnet-mobile', import.meta.url).pathname   // <rt>/dsh-code/lib -> <rt>/bin
  return existsSync(p) ? p : null
}
