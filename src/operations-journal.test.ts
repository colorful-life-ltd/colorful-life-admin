import { expect, it, vi } from 'vitest'
import { OperationsService, intentSlot, type OperationJournal } from '../electron/operations-service'
import type { SavedOperation } from '../electron/operations-contract'
const security = { orderId: 41, action: 'RELEASE', note: 'Mistyped order identifier' }
const refund = { orderId: 42, paymentId: 7, amount: 5, reason: 'Customer refund request' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
function fixture(initial: OperationJournal | SavedOperation | null = null) {
  let saved = initial
  const store = { read: vi.fn(() => saved), write: vi.fn((_s: string, v: OperationJournal | SavedOperation | null) => { saved = v }) }
  const authenticatedFetch = vi.fn()
  const service = new OperationsService({ restore: vi.fn().mockResolvedValue({ user: { id: 2, role: 'ADMIN' } }), authenticatedFetch }, store, 'https://backend.test')
  return { service, authenticatedFetch, store, journal: () => saved }
}
it('reproduced lockout: one uncertain security review no longer blocks other orders or operations', async () => {
  const f = fixture()
  f.authenticatedFetch.mockResolvedValueOnce(json({ error: 'Review update unavailable' }, 503))
  await expect(f.service.execute('securityReview', security)).rejects.toThrow()
  expect(await f.service.pending()).toMatchObject([{ operation: 'securityReview', state: 'uncertain' }])
  f.authenticatedFetch.mockResolvedValueOnce(json({ refundId: 3, status: 'SUCCEEDED' }, 201)).mockResolvedValueOnce(json({ updated: true }))
  await f.service.execute('refund', refund)
  await f.service.execute('securityReview', { ...security, orderId: 43 })
  // The genuinely uncertain intent stays fail-closed for its own operation and target.
  await expect(f.service.execute('securityReview', security)).rejects.toThrow('record the investigated outcome')
  await expect(f.service.finish('securityReview', security)).rejects.toThrow('cannot be discarded')
  expect(f.authenticatedFetch).toHaveBeenCalledTimes(3)
  expect((await f.service.pending()).map(i => [i.operation, i.input.orderId, i.state])).toEqual([['securityReview', 41, 'uncertain'], ['refund', 42, 'confirmed'], ['securityReview', 43, 'confirmed']])
})
it('definitive 4xx refusals such as ORDER_NOT_FOUND are rejected and finishable, never uncertain', async () => {
  const f = fixture(); f.authenticatedFetch.mockResolvedValueOnce(json({ error: 'ORDER_NOT_FOUND' }, 404))
  await expect(f.service.execute('securityReview', security)).rejects.toThrow()
  expect(await f.service.pending()).toMatchObject([{ state: 'rejected' }])
  await f.service.finish('securityReview', security); expect(await f.service.pending()).toEqual([])
})
it('records an audited investigated outcome for an uncertain non-replayable intent and clears only that slot', async () => {
  const f = fixture(); f.authenticatedFetch.mockRejectedValueOnce(new Error('lost')).mockRejectedValueOnce(new Error('lost'))
  await expect(f.service.execute('securityReview', security)).rejects.toThrow()
  await expect(f.service.execute('completeOrder', { orderId: 41 })).rejects.toThrow()
  const key = (await f.service.pending())[0].key
  await expect(f.service.resolve('securityReview', security, 'NOT_APPLIED', 'short')).rejects.toThrow('10–1000')
  await expect(f.service.resolve('securityReview', security, 'MAYBE' as never, 'Order audit shows no security event')).rejects.toThrow()
  f.authenticatedFetch.mockResolvedValueOnce(json({ error: 'OPERATOR_INTENT_RESOLUTION_UNAVAILABLE' }, 503))
  await expect(f.service.resolve('securityReview', security, 'NOT_APPLIED', 'Order audit shows no security event')).rejects.toThrow()
  expect(await f.service.pending()).toHaveLength(2) // The local intent survives a failed audit write.
  f.authenticatedFetch.mockResolvedValueOnce(json({ auditId: '9', replayed: false }, 201))
  expect(await f.service.resolve('securityReview', security, 'NOT_APPLIED', 'Order audit shows no security event')).toEqual({ auditId: '9', replayed: false })
  const [path, init] = f.authenticatedFetch.mock.calls.at(-1)!
  expect(path).toBe('/admin/operator-intents/resolutions'); expect(init.method).toBe('POST'); expect(init.headers['Idempotency-Key']).toBe(key)
  expect(JSON.parse(init.body)).toEqual({ operation: 'securityReview', decision: 'NOT_APPLIED', note: 'Order audit shows no security event', orderId: 41 })
  expect(await f.service.pending()).toMatchObject([{ operation: 'completeOrder', state: 'uncertain' }])
})
it('keeps uncertain financial intents fail-closed: no operator decision, same-key retry only, no payload change', async () => {
  const f = fixture(); f.authenticatedFetch.mockRejectedValueOnce(new Error('lost'))
  await expect(f.service.execute('refund', refund)).rejects.toThrow()
  await expect(f.service.resolve('refund', refund, 'NOT_APPLIED', 'Provider dashboard shows nothing')).rejects.toThrow('retrying its saved key')
  await expect(f.service.execute('refund', { ...refund, amount: 6 })).rejects.toThrow('saved intent exists')
  f.authenticatedFetch.mockResolvedValueOnce(json({ refundId: 3, status: 'SUCCEEDED' }, 201))
  await f.service.execute('refund', refund)
  const keys = f.authenticatedFetch.mock.calls.map(([, init]) => init.headers['Idempotency-Key'])
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1])
})
it('migrates a version 1 single-intent journal without dropping its uncertainty', async () => {
  const legacy: SavedOperation = { operation: 'securityReview', input: security, key: '5b2c3a4e-1111-4222-8333-944455556666', state: 'uncertain' }
  const f = fixture(legacy)
  expect(await f.service.pending()).toEqual([legacy])
  await expect(f.service.execute('securityReview', security)).rejects.toThrow('does not guarantee replay')
  f.authenticatedFetch.mockResolvedValueOnce(json({ updated: true }))
  await f.service.execute('securityReview', { ...security, orderId: 44 })
  expect(f.journal()).toMatchObject({ version: 2, intents: [legacy, { input: { orderId: 44 }, state: 'confirmed' }] })
})
it('derives slots from operation and target identity only', () => {
  expect(intentSlot('securityReview', security)).not.toBe(intentSlot('securityReview', { ...security, orderId: 43 }))
  expect(intentSlot('securityReview', security)).not.toBe(intentSlot('completeOrder', { orderId: 41 }))
  expect(intentSlot('refund', refund)).toBe(intentSlot('refund', { ...refund, amount: 6 }))
})
