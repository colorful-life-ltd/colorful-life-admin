import { expect, it } from 'vitest'
import { liveConnectionBlockMessage, parseConnectionMode, stripeEnvironmentMismatch } from './refund-ux'

it.each([
  ['LIVE', 'direct', false],
  ['LIVE', 'remote-sandbox', true],
  ['LIVE', null, true],
  ['LIVE', undefined, true],
  ['LIVE', '', true],
  ['LIVE', 'DIRECT', true],
  ['LIVE', 'remote_sandbox', true],
  ['LIVE', { mode: 'direct' }, true],
  ['TEST', 'direct', false],
  ['TEST', 'remote-sandbox', false],
  ['TEST', null, false],
  ['UNKNOWN', 'direct', false],
] as const)('LIVE requires an exact direct connection: %s with %j blocks=%s', (environment, mode, blocked) => {
  expect(stripeEnvironmentMismatch(environment, mode)).toBe(blocked)
})

it.each([
  [{ mode: 'direct', state: 'connected', message: 'ok' }, 'direct'],
  [{ mode: 'remote-sandbox', state: 'connected', message: 'ok' }, 'remote-sandbox'],
  [{ state: 'connected', message: 'ok' }, null],
  [{ mode: undefined }, null],
  [{ mode: null }, null],
  [{ mode: 'Direct' }, null],
  [{ mode: 'direct ' }, null],
  [{ mode: 'remote_sandbox' }, null],
  [null, null],
  [undefined, null],
  ['direct', null],
  [[{ mode: 'direct' }], null],
] as const)('accepts only an exact reported connection mode: %j -> %s', (status, expected) => {
  expect(parseConnectionMode(status)).toBe(expected)
})

it('explains why a LIVE refund is blocked without implying an unverified mode is a Sandbox', () => {
  expect(liveConnectionBlockMessage('remote-sandbox')).toMatch(/Sandbox is connected to a LIVE Stripe environment/)
  expect(liveConnectionBlockMessage(null)).toMatch(/verified direct Admin connection/)
})
