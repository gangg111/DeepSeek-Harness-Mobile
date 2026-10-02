import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptProbe, hostOf, planProbes, runLimited } from '../lib/discover.js'

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

test('planProbes: nie ponawia, dopóki stan online się nie zmieni', () => {
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
