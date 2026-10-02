/**
 * Automatyczne wykrywanie komputerow z dsh-remote-control w tailnecie (ekran Code bez wpisywania adresu).
 * Wezel tsnet daje liste urzadzen (Peers); kazde online, ktorego nie ma na liscie i ktorego user nie usunal
 * recznie, sondujemy GET https://<DNSName>/__remote/api/info (przez tsnet, limit 4 s). Odpowiedz JSON
 * z service === "dsh-remote-control" => dodajemy urzadzenie. Najpierw nazwy dsh-*, potem reszta, max 4 naraz.
 * Nieudana sonda jest ponawiana po 30 s, 2 min i 10 min (BACKOFF_MS); potem dopiero po zmianie stanu online.
 */

export const SERVICE = 'dsh-remote-control'
export const MAX_PARALLEL = 4
export const BACKOFF_MS = [30_000, 120_000, 600_000]

/** Host z adresu urządzenia (https://dsh-pc.tail.ts.net/ -> dsh-pc.tail.ts.net). */
export function hostOf(url) {
  try { return new URL(url).host.toLowerCase() } catch { return String(url).toLowerCase() }
}

/**
 * Które urządzenia sondować teraz. `probed` pamięta per host: ostatni sondowany stan online, liczbę
 * nieudanych sond i czas następnej próby (`nextAt`). Sondujemy online: nieznane, te po zmianie stanu
 * online i te, którym minął czas ponowienia; bez `nextAt` (sukces albo wyczerpane ponowienia) czekamy
 * na zmianę stanu.
 * @param {{DNSName:string,HostName:string,Online:boolean}[]} peers
 * @param {{url:string}[]} devices  urządzenia już na liście
 * @param {string[]} ignored        hosty usunięte ręcznie przez usera
 * @param {Map<string,{online:boolean,failures?:number,nextAt?:number}>} probed
 * @param {number} now
 */
export function planProbes(peers, devices, ignored, probed, now = Date.now()) {
  const known = new Set(devices.map((d) => hostOf(d.url)))
  const skip = new Set(ignored.map((h) => h.toLowerCase()))
  const due = []
  for (const p of peers) {
    const host = String(p.DNSName || '').toLowerCase()
    if (!host || known.has(host) || skip.has(host)) continue
    const prev = probed.get(host)
    if (!p.Online) { probed.set(host, { online: false }); continue }   // offline: zapamiętaj stan, sonduj po powrocie
    if (prev && prev.online === true) {
      if (prev.nextAt === undefined || now < prev.nextAt) continue      // sukces/wyczerpane albo jeszcze nie czas
    } else if (prev) {
      probed.delete(host)                                              // wróciło online: licznik od zera
    }
    due.push(host)
  }
  const prio = (h) => (h.startsWith('dsh-') ? 0 : 1)
  due.sort((a, b) => prio(a) - prio(b) || a.localeCompare(b))
  return due
}

/** Wpis `probed` po nieudanej sondzie: kolejna próba wg BACKOFF_MS albo koniec ponowień (bez nextAt). */
export function recordFailure(prev, now = Date.now()) {
  const failures = (prev && prev.online === true ? prev.failures ?? 0 : 0) + 1
  const wait = BACKOFF_MS[failures - 1]
  return wait === undefined ? { online: true, failures } : { online: true, failures, nextAt: now + wait }
}

/** Najbliższy zaplanowany czas ponowienia (albo null). */
export function nextDue(probed) {
  let min = null
  for (const e of probed.values()) if (e.nextAt !== undefined && (min === null || e.nextAt < min)) min = e.nextAt
  return min
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
