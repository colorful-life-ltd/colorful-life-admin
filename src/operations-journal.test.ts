import { expect, it, vi } from 'vitest'
import { OperationsService, intentFingerprint, intentSlot, type OperationJournal } from '../electron/operations-service'
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
it('finishes only a locally saved rejected intent and never calls the Backend', async () => {
  const rejected: SavedOperation = { operation: 'refund', input: refund, key: '12345678-1234-1234-1234-123456789abc', state: 'rejected' }
  const f = fixture({ version: 2, intents: [rejected] })
  await f.service.finish('refund', refund)
  expect(await f.service.pending()).toEqual([])
  expect(f.authenticatedFetch).not.toHaveBeenCalled()
  expect(f.store.write).toHaveBeenCalledWith('https://backend.test|2', null)
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
  // A recorded fingerprint for a different payload never clears the intent.
  f.authenticatedFetch.mockResolvedValueOnce(json({ auditId: '8', replayed: false, intentFingerprint: intentFingerprint('securityReview', { ...security, action: 'HOLD' }) }, 201))
  await expect(f.service.resolve('securityReview', security, 'NOT_APPLIED', 'Order audit shows no security event')).rejects.toThrow('does not match')
  expect(await f.service.pending()).toHaveLength(2)
  f.authenticatedFetch.mockResolvedValueOnce(json({ auditId: '9', replayed: false, intentFingerprint: intentFingerprint('securityReview', security) }, 201))
  expect(await f.service.resolve('securityReview', security, 'NOT_APPLIED', 'Order audit shows no security event')).toEqual({ auditId: '9', replayed: false, intentFingerprint: intentFingerprint('securityReview', security) })
  const [path, init] = f.authenticatedFetch.mock.calls.at(-1)!
  expect(path).toBe('/admin/operator-intents/resolutions'); expect(init.method).toBe('POST'); expect(init.headers['Idempotency-Key']).toBe(key)
  expect(JSON.parse(init.body)).toEqual({ operation: 'securityReview', decision: 'NOT_APPLIED', note: 'Order audit shows no security event', intent: security, orderId: 41 })
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
it('retains an uncertain refund across service restart and retries with its original key', async () => {
  const f = fixture(); f.authenticatedFetch.mockRejectedValueOnce(new Error('lost response'))
  await expect(f.service.execute('refund', refund)).rejects.toThrow()
  const original = (await f.service.pending())[0].key
  const restarted = new OperationsService({
    restore: vi.fn().mockResolvedValue({ user: { id: 2, role: 'ADMIN' } }),
    authenticatedFetch: f.authenticatedFetch,
  }, f.store, 'https://backend.test')
  expect(await restarted.pending()).toMatchObject([{ state: 'uncertain', key: original }])
  f.authenticatedFetch.mockResolvedValueOnce(json({ refundId: 3, status: 'PROCESSING', amount: '5.00', currency: 'GBP', provider: 'STRIPE' }, 202))
  await restarted.execute('refund', refund)
  expect(f.authenticatedFetch.mock.calls.at(-1)![1].headers['Idempotency-Key']).toBe(original)
})
it('rechecks a previously confirmed refund through Backend idempotency using its original key', async () => {
  const confirmed: SavedOperation = { operation: 'refund', input: refund, key: '12345678-1234-1234-1234-123456789abc', state: 'confirmed' }
  const f = fixture({ version: 2, intents: [confirmed] })
  f.authenticatedFetch.mockResolvedValueOnce(json({ refundId: 13, status: 'PROCESSING', amount: '5.00', currency: 'GBP', provider: 'STRIPE' }, 202))
  await f.service.execute('refund', refund)
  expect(f.authenticatedFetch.mock.calls[0][1].headers['Idempotency-Key']).toBe(confirmed.key)
  expect(await f.service.pending()).toMatchObject([{ state: 'confirmed', key: confirmed.key }])
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
it('fingerprints match the Backend canonical form: known answer, key order and payload sensitivity', () => {
  expect(intentFingerprint('securityReview', security)).toBe('49cf11ea376dd7b12055cd1ecc1eb8aa17625edc8674cc2c0ebd1aee834150a9')
  expect(intentFingerprint('securityReview', { note: security.note, action: 'RELEASE', orderId: 41 })).toBe('49cf11ea376dd7b12055cd1ecc1eb8aa17625edc8674cc2c0ebd1aee834150a9')
  expect(intentFingerprint('securityReview', { ...security, action: 'HOLD' })).not.toBe('49cf11ea376dd7b12055cd1ecc1eb8aa17625edc8674cc2c0ebd1aee834150a9')
  expect(intentFingerprint('completeOrder', security)).not.toBe('49cf11ea376dd7b12055cd1ecc1eb8aa17625edc8674cc2c0ebd1aee834150a9')
})
it('refund intents share an order slot by design: one Payment per Order, so paymentId cannot select another payment', async () => {
  // Backend invariant: unique Payment.orderId; POST /orders/:id/refunds 404s a paymentId of another order.
  expect(intentSlot('refund', refund)).toBe(intentSlot('refund', { ...refund, paymentId: 8 }))
  const f = fixture(); f.authenticatedFetch.mockRejectedValueOnce(new Error('lost'))
  await expect(f.service.execute('refund', refund)).rejects.toThrow()
  // An uncertain refund keeps every other refund intent for that order fail-closed, whatever paymentId is entered.
  await expect(f.service.execute('refund', { ...refund, paymentId: 8 })).rejects.toThrow('saved intent exists')
  expect(f.authenticatedFetch).toHaveBeenCalledTimes(1)
  // A definitive Backend refusal clears only with its explicit no-submission contract.
  const g = fixture(); g.authenticatedFetch.mockResolvedValueOnce(json({ error: 'REFUND_CAPACITY_EXCEEDED', refundSubmissionDisposition: 'NOT_SUBMITTED' }, 409))
  await expect(g.service.execute('refund', { ...refund, paymentId: 8 })).rejects.toThrow()
  expect(await g.service.pending()).toEqual([])
  g.authenticatedFetch.mockResolvedValueOnce(json({ refundId: 6, status: 'PROCESSING', amount: '5.00', currency: 'GBP', provider: 'STRIPE' }, 202))
  await g.service.execute('refund', { ...refund, paymentId: 8, amount: 4.99 })
  const keys = g.authenticatedFetch.mock.calls.map(([, init]) => init.headers['Idempotency-Key'])
  expect(keys).toHaveLength(2); expect(keys[0]).not.toBe(keys[1])
})
it('does not infer a definitive refund rejection from 4xx status and keeps the saved intent', async () => {
  const f = fixture(); f.authenticatedFetch.mockResolvedValueOnce(json({ error: 'REFUND_CAPACITY_EXCEEDED' }, 409))
  await expect(f.service.execute('refund', refund)).rejects.toThrow()
  expect(await f.service.pending()).toMatchObject([{ operation: 'refund', state: 'uncertain', input: refund }])
  await expect(f.service.execute('refund', { ...refund, amount: 4.99 })).rejects.toThrow('saved intent exists')
  expect(f.authenticatedFetch).toHaveBeenCalledOnce()
})
it('releases a definitively unsubmitted £23.99 refund so the operator can correct it to £23.98', async () => {
  const f = fixture()
  const order11 = { orderId: 11, paymentId: 9, amount: 23.99, reason: 'BB-R-11 — Faulty' }
  f.authenticatedFetch.mockResolvedValueOnce(json({ error: 'REFUND_CAPACITY_EXCEEDED', refundSubmissionDisposition: 'NOT_SUBMITTED' }, 409))
  await expect(f.service.execute('refund', order11)).rejects.toThrow()
  expect(await f.service.pending()).toEqual([])
  f.authenticatedFetch.mockResolvedValueOnce(json({ refundId: 12, status: 'PROCESSING', amount: '23.98', currency: 'GBP', provider: 'STRIPE' }, 202))
  await f.service.execute('refund', { ...order11, amount: 23.98 })
  expect(JSON.parse(f.authenticatedFetch.mock.calls[1][1].body)).toMatchObject({ amount: 23.98 })
  expect(await f.service.pending()).toMatchObject([{ state: 'confirmed', input: { amount: 23.98 } }])
})
