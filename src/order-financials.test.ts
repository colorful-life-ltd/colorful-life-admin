import { expect, it, vi } from 'vitest'
import { AuthError, AuthService } from '../electron/auth-service'
import { OrderService } from '../electron/order-service'
import { dispatchFinancialWarning, financialsConsistent, formatFinancialAmount, parsePayments, parseRefunds, refundOutcomeUncertain } from '../electron/order-financials'
import { payment, refund } from './test-fixtures/order'
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const view = (p = payment, rs: unknown[] = []) => ({ payment: { state: 'ready' as const, value: parsePayments([p], 41) }, refunds: { state: 'ready' as const, value: parseRefunds(rs, 41) }, consistent: financialsConsistent(parsePayments([p], 41), parseRefunds(rs, 41)) })
it.each([['25', 'GBP', '£25.00 GBP'], ['12.5', 'GBP', '£12.50 GBP'], ['0', 'GBP', '£0.00 GBP'], ['9999999999.99', 'USD', 'US$9,999,999,999.99 USD'], ['12', 'JPY', 'JP¥12 JPY'], ['12.5', 'KWD', 'KWD\u00a012.500 KWD']])('formats major units exactly: %s %s', (amount, currency, expected) => {
  expect(formatFinancialAmount(amount, currency)).toBe(expected)
})
it.each(['-1', 'NaN', 'Infinity', '1e2', '1.001', '10000000000', '', ' 2', '01', 25, null])('rejects malformed amount %s', amount => {
  expect(() => parsePayments([{ ...payment, amount }], 41)).toThrow()
})
it('rejects unknown currencies and unsupported currency precision', () => {
  expect(() => formatFinancialAmount('1', 'ZZZ')).toThrow()
  expect(() => formatFinancialAmount('1.01', 'JPY')).toThrow()
})
it('allows no refund and partial refund, but explains full and pending refund restrictions', () => {
  expect(dispatchFinancialWarning(view())).toBeNull()
  expect(dispatchFinancialWarning(view({ ...payment, refundedAmount: '5' }, [refund]))).toBeNull()
  expect(dispatchFinancialWarning(view({ ...payment, refundedAmount: '25' }, [{ ...refund, amount: '25' }]))).toContain('fully refunded')
  expect(dispatchFinancialWarning(view({ ...payment, reservedRefundAmount: '5' }, [{ ...refund, status: 'PROCESSING', resolutionCode: 'PROVIDER_PENDING' }]))).toContain('pending or unresolved')
})
it('keeps unknown and conflicting evidence separate from recorded status', () => {
  for (const row of [{ ...refund, status: 'PROCESSING', resolutionCode: 'PROVIDER_OUTCOME_UNKNOWN' }, { ...refund, reviewRequired: true }, { ...refund, resolutionCode: 'PROVIDER_EVIDENCE_MISMATCH' }]) {
    expect(refundOutcomeUncertain(parseRefunds([row], 41)[0])).toBe(true)
  }
  expect(dispatchFinancialWarning(view({ ...payment, refundedAmount: '5' }, [{ ...refund, reviewRequired: true }]))).toContain('not a conclusive outcome')
})
it.each([
  [payment, [refund]], // financial counters changed between reads
  [{ ...payment, reservedRefundAmount: '5' }, []],
  [{ ...payment, refundedAmount: '5' }, [{ ...refund, paymentId: 9 }]],
  [{ ...payment, refundedAmount: '5' }, [{ ...refund, currency: 'USD' }]],
  [{ ...payment, refundedAmount: '5' }, [{ ...refund, provider: 'PAYPAL' }]],
])('does not infer safety from inconsistent snapshots', (p, rows) => {
  expect(dispatchFinancialWarning(view(p, rows))).toContain('separate snapshots')
})
it('does not accept refund history without a payment or a succeeded payment without paidAt', () => {
  expect(financialsConsistent(null, parseRefunds([refund], 41))).toBe(false)
  expect(financialsConsistent(null, [])).toBe(true)
  expect(financialsConsistent({ ...parsePayments([payment], 41)!, paidAt: null }, [])).toBe(false)
})
it.each([
  { ...payment, orderId: 42 }, { ...payment, refundedAmount: '26' }, { ...payment, reservedRefundAmount: '26' },
  { ...payment, status: 'UNKNOWN' }, { ...payment, provider: ['STRIPE'] }, { ...payment, paidAt: 'bad' },
])('rejects malformed payment identity, totals and status', row => {
  expect(() => parsePayments([row], 41)).toThrow()
})
it.each([
  { ...refund, orderId: 42 }, { ...refund, amount: '0' }, { ...refund, status: 'UNKNOWN' },
  { ...refund, performedByUserId: null }, { ...refund, reviewRequired: 'false' }, { ...refund, createdAt: 'bad' },
])('rejects malformed refund response', row => { expect(() => parseRefunds([row], 41)).toThrow() })
it('rejects duplicate IDs and unexpected collection shapes', () => {
  expect(() => parsePayments([payment, payment], 41)).toThrow()
  expect(() => parseRefunds([refund, refund], 41)).toThrow()
  expect(() => parseRefunds({ items: [] }, 41)).toThrow()
})
it('GETs only expected paths and explicitly whitelists fields before IPC', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response([{ ...payment, providerReference: 'SECRET', idempotencyKey: 'SECRET' }])).mockResolvedValueOnce(response([{ ...refund, providerOutcome: { secret: 'SECRET' }, providerReference: 'SECRET', refundIdempotencyKey: 'SECRET' }]))
  const result = await new OrderService({ authenticatedFetch: fetch }).financials(41)
  expect(fetch.mock.calls.map(c => c.slice(0, 2))).toEqual([['/orders/41/payments', {}], ['/orders/41/refunds', {}]])
  expect(JSON.stringify(result)).not.toContain('SECRET')
  expect(result.payment).toEqual({ state: 'ready', value: { id: 7, amount: '25', currency: 'GBP', provider: 'STRIPE', status: 'SUCCEEDED', paidAt: payment.paidAt, refundedAmount: '0', reservedRefundAmount: '0' } })
  expect(Object.keys(result.refunds.state === 'ready' ? result.refunds.value[0] : {})).toEqual(['id', 'paymentId', 'amount', 'currency', 'provider', 'status', 'createdAt', 'reason', 'actorId', 'resolutionCode', 'reviewRequired'])
})
it.each(['network', 'malformed', 'http'])('keeps failed refund history distinct from zero refunds: %s', async mode => {
  const fetch = vi.fn().mockResolvedValueOnce(response([payment]))
  if (mode === 'network') fetch.mockRejectedValueOnce(new Error('secret transport details'))
  else fetch.mockResolvedValueOnce(response(mode === 'malformed' ? [{ ...refund, amount: 'NaN' }] : { error: 'secret error' }, mode === 'http' ? 500 : 200))
  const result = await new OrderService({ authenticatedFetch: fetch }).financials(41)
  expect(result.payment.state).toBe('ready'); expect(result.refunds.state).toBe('error')
  expect(dispatchFinancialWarning(result)).toContain('incomplete')
  expect(JSON.stringify(result)).not.toContain('secret')
})
it('preserves readable history when payment read fails', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(response([refund]))
  const result = await new OrderService({ authenticatedFetch: fetch }).financials(41)
  expect(result.payment.state).toBe('error'); expect(result.refunds.state).toBe('ready'); expect(result.consistent).toBe(false)
})
it.each([401, 403])('rejects authorization %s instead of returning partial financial data', async status => {
  const fetch = vi.fn().mockResolvedValueOnce(response([payment])).mockResolvedValueOnce(response({ error: 'Forbidden' }, status))
  await expect(new OrderService({ authenticatedFetch: fetch }).financials(41)).rejects.toMatchObject({ status })
})
it('validates ID before I/O and requires a Main Process Admin session', async () => {
  const fetch = vi.fn()
  const service = new OrderService({ authenticatedFetch: fetch })
  await expect(service.financials(-1)).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
  await expect(new OrderService(new AuthService('http://127.0.0.1', fetch)).financials(41)).rejects.toMatchObject({ code: 'session-invalid' })
  expect(fetch).not.toHaveBeenCalled()
})

it('preserves a successful refund read when Main transport raises AuthError(network)', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new AuthError('network', 'Unable to reach service.')).mockResolvedValueOnce(response([refund]))
  const result = await new OrderService({ authenticatedFetch: fetch }).financials(41)
  expect(result.payment.state).toBe('error')
  expect(result.refunds.state).toBe('ready')
})

it('shows review requirements even while the refund is still processing', () => {
  const data = view({ ...payment, reservedRefundAmount: '5' }, [{ ...refund, status: 'PROCESSING', reviewRequired: true, resolutionCode: 'MANUAL_REVIEW_REQUIRED' }])
  expect(dispatchFinancialWarning(data)).toContain('requires review')
})
