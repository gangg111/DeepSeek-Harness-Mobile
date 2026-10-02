/**
 * Automatyczne wykrywanie komputerow z dsh-remote-control w tailnecie (ekran Code bez wpisywania adresu).
 * Wezel tsnet daje liste urzadzen (Peers); kazde online, ktorego nie ma na liscie i ktorego user nie usunal
 * recznie, sondujemy GET https://<DNSName>/__remote/api/info (przez tsnet, limit 4 s). Odpowiedz JSON
 * z service === "dsh-remote-control" => dodajemy urzadzenie. Najpierw nazwy dsh-*, potem reszta, max 4 naraz.
 * Urzadzen, ktore nie odpowiedzialy, nie ponawiamy, dopoki nie zmieni sie ich stan online.
 */

export const SERVICE = 'dsh-remote-control'
export const MAX_PARALLEL = 4

/** Host z adresu urządzenia (https://dsh-pc.tail.ts.net/ -> dsh-pc.tail.ts.net). */
export function hostOf(url) {
  try { return new URL(url).host.toLowerCase() } catch { return String(url).toLowerCase() }
}

/**
 * Które urządzenia sondować teraz. `probed` pamięta ostatni sondowany stan online per host:
 * sondujemy tylko online, nieznane i te, których stan online zmienił się od ostatniej sondy.
 * @param {{DNSName:string,HostName:string,Online:boolean}[]} peers
 * @param {{url:string}[]} devices  urządzenia już na liście
 * @param {string[]} ignored        hosty usunięte ręcznie przez usera
 * @param {Map<string,{online:boolean}>} probed
 */
export function planProbes(peers, devices, ignored, probed) {
  const known = new Set(devices.map((d) => hostOf(d.url)))
  const skip = new Set(ignored.map((h) => h.toLowerCase()))
  const due = []
  for (const p of peers) {
    const host = String(p.DNSName || '').toLowerCase()
    if (!host || known.has(host) || skip.has(host)) continue
    const prev = probed.get(host)
    if (prev && prev.online === p.Online) continue   // już sondowane w tym stanie
    if (!p.Online) { probed.set(host, { online: false }); continue }   // offline: zapamiętaj stan, sonduj po powrocie
    due.push(host)
  }
  const prio = (h) => (h.startsWith('dsh-') ? 0 : 1)
  due.sort((a, b) => prio(a) - prio(b) || a.localeCompare(b))
  return due
}

/** Czy odpowiedź sondy to komputer z dsh-remote-control; zwraca nazwę albo null. */
export function acceptProbe(result) {
  const body = result && result.body
  if (!body || typeof body !== 'object' || body.service !== SERVICE) return null
  return typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null
}

/** Uruchamia `fn` dla hostów z ograniczeniem równoległości. */
export async function runLimited(hosts, limit, fn) {
  const queue = [...hosts]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) { const h = queue.shift(); await fn(h) }
  })
  await Promise.all(workers)
}
