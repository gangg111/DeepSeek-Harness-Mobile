import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BACKOFF_MS, acceptProbe, hostOf, nextDue, planProbes, recordFailure, runLimited } from '../lib/discover.js'

const peers = [
  { DNSName: 'zeta.t.ts.net', HostName: 'zeta', Online: true },
  { DNSName: 'dsh-pc.t.ts.net', HostName: 'AORUS', Online: true },
  { DNSName: 'offline.t.ts.net', HostName: 'off', Online: false },
  { DNSName: 'known.t.ts.net', HostName: 'known', Online: true },
  { DNSName: 'removed.t.ts.net', HostName: 'rm', Online: true },
  { DNSName: 'dsh-laptop.t.ts.net', HostName: 'lap', Online: true },
]

test('planProbes: najpierw dsh-*, pomija znane, usunięte i offline', () => {
  const probed = new Map()
  const due = planProbes(peers, [{ url: 'https://known.t.ts.net/' }], ['removed.t.ts.net'], probed)
  assert.deepEqual(due, ['dsh-laptop.t.ts.net', 'dsh-pc.t.ts.net', 'zeta.t.ts.net'])
  assert.deepEqual(probed.get('offline.t.ts.net'), { online: false })
})

test('planProbes: po sukcesie/wyczerpaniu nie ponawia, dopóki stan online się nie zmieni', () => {
  const probed = new Map([['zeta.t.ts.net', { online: true }], ['dsh-pc.t.ts.net', { online: false }]])
  const due = planProbes(peers, [{ url: 'https://known.t.ts.net/' }], ['removed.t.ts.net'], probed)
  assert.deepEqual(due, ['dsh-laptop.t.ts.net', 'dsh-pc.t.ts.net'])   // zeta już sondowana online; dsh-pc wróciło z offline
})

test('acceptProbe: tylko service dsh-remote-control, nazwa z pola name', () => {
  assert.equal(acceptProbe({ status: 200, body: { service: 'dsh-remote-control', name: 'AORUS_Z690' } }), 'AORUS_Z690')
  assert.equal(acceptProbe({ status: 200, body: { service: 'inne', name: 'x' } }), null)
  assert.equal(acceptProbe({ status: 200, body: { service: 'dsh-remote-control' } }), null)
  assert.equal(acceptProbe({ error: 'timeout' }), null)
  assert.equal(hostOf('https://DSH-PC.t.ts.net/'), 'dsh-pc.t.ts.net')
})

test('runLimited: nie więcej niż 4 naraz', async () => {
  let active = 0, peak = 0
  await runLimited(Array.from({ length: 9 }, (_, i) => `h${i}`), 4, async () => {
    active++; peak = Math.max(peak, active)
    await new Promise((r) => setTimeout(r, 5))
    active--
  })
  assert.equal(peak, 4)
})

test('ponowienia po nieudanej sondzie: 30 s, 2 min, 10 min, potem koniec', () => {
  assert.deepEqual(BACKOFF_MS, [30_000, 120_000, 600_000])
  const t0 = 1_000_000
  let e = recordFailure(undefined, t0)
  assert.deepEqual(e, { online: true, failures: 1, nextAt: t0 + 30_000 })
  e = recordFailure(e, t0 + 30_000)
  assert.deepEqual(e, { online: true, failures: 2, nextAt: t0 + 30_000 + 120_000 })
  e = recordFailure(e, t0 + 150_000)
  assert.deepEqual(e, { online: true, failures: 3, nextAt: t0 + 150_000 + 600_000 })
  e = recordFailure(e, t0 + 750_000)
  assert.deepEqual(e, { online: true, failures: 4 })   // bez nextAt = koniec ponowień
  // powrót z offline zeruje licznik
  assert.deepEqual(recordFailure({ online: false }, t0), { online: true, failures: 1, nextAt: t0 + 30_000 })
})

test('planProbes: ponawia dopiero gdy minie nextAt; nextDue daje najbliższy termin', () => {
  const t0 = 5_000_000
  const probed = new Map([
    ['zeta.t.ts.net', { online: true, failures: 1, nextAt: t0 + 30_000 }],
    ['dsh-pc.t.ts.net', { online: true, failures: 2, nextAt: t0 + 10_000 }],
    ['dsh-laptop.t.ts.net', { online: true, failures: 4 }],   // wyczerpane
  ])
  assert.deepEqual(planProbes(peers, [{ url: 'https://known.t.ts.net/' }], ['removed.t.ts.net'], probed, t0), [])
  assert.equal(nextDue(probed), t0 + 10_000)
  assert.deepEqual(planProbes(peers, [{ url: 'https://known.t.ts.net/' }], ['removed.t.ts.net'], probed, t0 + 10_000), ['dsh-pc.t.ts.net'])
  assert.deepEqual(planProbes(peers, [{ url: 'https://known.t.ts.net/' }], ['removed.t.ts.net'], probed, t0 + 31_000), ['dsh-pc.t.ts.net', 'zeta.t.ts.net'])
  // wyczerpane dsh-laptop wraca do sondowania po przejściu offline->online
  const flip = peers.map((p) => (p.DNSName === 'dsh-laptop.t.ts.net' ? { ...p, Online: false } : p))
  planProbes(flip, [], [], probed, t0)
  assert.deepEqual(probed.get('dsh-laptop.t.ts.net'), { online: false })
  assert.ok(planProbes(peers, [{ url: 'https://known.t.ts.net/' }], ['removed.t.ts.net'], probed, t0).includes('dsh-laptop.t.ts.net'))
})
