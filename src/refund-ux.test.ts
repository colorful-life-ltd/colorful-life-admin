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

const connected = { state: 'connected', message: 'ok' } as const
it.each([
  [{ mode: 'direct', ...connected }, 'direct'],
  [{ mode: 'remote-sandbox', ...connected }, 'remote-sandbox'],
  [{ ...connected }, null],
  [{ mode: undefined, ...connected }, null],
  [{ mode: null, ...connected }, null],
  [{ mode: 'Direct', ...connected }, null],
  [{ mode: 'direct ', ...connected }, null],
  [{ mode: 'remote_sandbox', ...connected }, null],
  [null, null],
  [undefined, null],
  ['direct', null],
  [[{ mode: 'direct', ...connected }], null],
] as const)('accepts only an exact reported connection mode: %j -> %s', (status, expected) => {
  expect(parseConnectionMode(status)).toBe(expected)
})

it.each([
  ['connected direct', { mode: 'direct', state: 'connected', message: 'Direct Backend connection configured.' }, 'direct'],
  ['connected remote-sandbox', { mode: 'remote-sandbox', state: 'connected', message: 'Secure Backend connection is ready.' }, 'remote-sandbox'],
  ['failed direct', { mode: 'direct', state: 'failed', message: 'Connection failed' }, null],
  ['failed remote-sandbox', { mode: 'remote-sandbox', state: 'failed', message: 'Connection failed' }, null],
  ['connecting direct', { mode: 'direct', state: 'connecting', message: 'Connecting securely to the Backend' }, null],
  ['connecting remote-sandbox', { mode: 'remote-sandbox', state: 'connecting', message: 'Connecting securely to the Backend' }, null],
  ['missing state', { mode: 'direct', message: 'Direct' }, null],
  ['unknown state', { mode: 'direct', state: 'CONNECTED', message: 'Direct' }, null],
  ['missing message', { mode: 'direct', state: 'connected' }, null],
  ['non-string message', { mode: 'direct', state: 'connected', message: 42 }, null],
  ['null message', { mode: 'direct', state: 'connected', message: null }, null],
] as const)('accepts a mode only from a complete connected status: %s', (_label, status, expected) => {
  expect(parseConnectionMode(status)).toBe(expected)
})

it('explains why a LIVE refund is blocked without implying an unverified mode is a Sandbox', () => {
  expect(liveConnectionBlockMessage('remote-sandbox')).toMatch(/Sandbox is connected to a LIVE Stripe environment/)
  expect(liveConnectionBlockMessage(null)).toMatch(/verified Production or direct Admin connection/)
})
