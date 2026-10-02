import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freePort, openUrl, parseStateLine } from '../lib/tsnet.js'

test('openUrl: wejście do pośrednika niesie dshrk i dshOpen, bez śladu adresu komputera', () => {
  const u = new URL(openUrl('http://127.0.0.1:45001', 'sekret-x', 'sess 1'))
  assert.equal(u.origin, 'http://127.0.0.1:45001')
  assert.equal(u.pathname, '/')
  assert.equal(u.searchParams.get('dshrk'), 'sekret-x')
  assert.equal(u.searchParams.get('dshOpen'), 'sess 1')
  assert.equal(new URL(openUrl('http://127.0.0.1:45001', 's')).searchParams.has('dshOpen'), false)
})

test('parseStateLine: linie JSON ze stanu, reszta ignorowana', () => {
  assert.deepEqual(parseStateLine('{"BackendState":"NeedsLogin","AuthURL":"https://login.tailscale.com/a/1"}'), { BackendState: 'NeedsLogin', AuthURL: 'https://login.tailscale.com/a/1' })
  assert.equal(parseStateLine('2026/10/01 tsnet starting'), null)
  assert.equal(parseStateLine('{nie json'), null)
  assert.equal(parseStateLine(''), null)
})

test('freePort: wolny port na pętli zwrotnej', async () => {
  const p = await freePort()
  assert.ok(p > 0 && p < 65536)
})
