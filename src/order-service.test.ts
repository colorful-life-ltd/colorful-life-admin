import { AuthService } from '../electron/auth-service'
import { describe, expect, it, vi } from 'vitest'
import { OrderService, validateDispatch } from '../electron/order-service'
import { order, orderPage } from './test-fixtures/order'
import { canCancel, canFulfil } from '../electron/order-contract'
import { safeTrackingUrl } from '../electron/tracking-url'
const input = { carrier: 'ROYAL_MAIL' as const, trackingNumber: 'ab 123-456789 gb', actualShippingCost: 3.5 }
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
describe('order service', () => {
  it.each(['SECURITY_REVIEW_REQUIRED', 'ORDER_PAYMENT_NOT_VERIFIED'])('explains a payment security hold (%s) without retrying dispatch', async code => {
    const fetch = vi.fn().mockResolvedValue(response({ error: { code, message: 'Order 41 payment is not verified for fulfilment (SECURITY_REVIEW_REQUIRED)' } }, 409))
    const api = new OrderService({ authenticatedFetch: fetch })
    await expect(api.dispatch(41, input)).rejects.toMatchObject({ status: 409, backendCode: code, message: expect.stringContaining('Dispatch is blocked by a payment security review') })
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('uses paginated admin reads and the new fulfilment endpoint with normalized tracking', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(orderPage)).mockImplementation(async () => response(order))
    const api = new OrderService({ authenticatedFetch: fetch })
    expect(await api.list()).toEqual(orderPage)
    expect(await api.get(41)).toEqual(order)
    await api.preparing(41); await api.dispatch(41, input)
    expect(fetch.mock.calls.map(c => c[0])).toEqual(['/admin/orders?page=1&pageSize=20', '/admin/orders/41', '/admin/orders/41/fulfilment/preparing', '/admin/orders/41/fulfilment/dispatch'])
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ ...input, trackingNumber: 'AB123456789GB' })
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({})
  })
  it('uses seller cancellation and preserves payment safety errors', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ status: 'CANCELLED' })).mockResolvedValueOnce(response({ error: { code: 'ORDER_ALREADY_PAID', message: 'paid' } }, 409))
    const api = new OrderService({ authenticatedFetch: fetch })
    await api.cancel(41, 'OUT_OF_STOCK')
    expect(fetch).toHaveBeenCalledWith('/orders/41/seller-cancel', expect.objectContaining({ body: '{"reason":"OUT_OF_STOCK"}' }))
    await expect(api.cancel(41, 'OTHER')).rejects.toMatchObject({ status: 409, backendCode: 'ORDER_ALREADY_PAID', message: expect.stringContaining('cannot be cancelled') })
  })
  it.each([401, 403, 404, 409, 500])('preserves API status %s without masking authorization or conflicts', async status => {
    const api = new OrderService({ authenticatedFetch: vi.fn().mockResolvedValue(response({ error: 'Rejected' }, status)) })
    await expect(api.get(41)).rejects.toMatchObject({ status, message: 'Rejected' })
  })
  it('preserves network failures and rejects malformed responses', async () => {
    const api = new OrderService({ authenticatedFetch: vi.fn().mockRejectedValue(new Error('Network unavailable')) })
    await expect(api.get(41)).rejects.toThrow('Network unavailable')
    const bad = new OrderService({ authenticatedFetch: vi.fn().mockResolvedValue(response({ ...order, payment: undefined })) })
    await expect(bad.get(41)).rejects.toMatchObject({ code: 'malformed-response' })
  })
  it('cannot read or mutate orders without an authenticated Admin session', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ token: 'test-token', accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(), refreshToken: 'test-refresh', refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() })).mockResolvedValueOnce(response({ id: 2, email: 'customer@example.com', role: 'CUSTOMER', createdAt: '2026-01-01', updatedAt: '2026-01-01' }))
    const auth = new AuthService('http://fixture.invalid', fetch)
    const api = new OrderService(auth)
    await expect(api.list()).rejects.toMatchObject({ code: 'session-invalid' })
    await expect(auth.login({ email: 'customer@example.com', password: 'test' })).rejects.toMatchObject({ code: 'not-authorized' })
    await expect(api.get(41)).rejects.toMatchObject({ code: 'session-invalid' })
    await expect(api.preparing(41)).rejects.toMatchObject({ code: 'session-invalid' })
    await expect(api.dispatch(41, input)).rejects.toMatchObject({ code: 'session-invalid' })
    await expect(api.cancel(41, 'OTHER')).rejects.toMatchObject({ code: 'session-invalid' })
    expect(fetch.mock.calls.some(c => c[0].includes('/orders'))).toBe(false)
  })
  it('rejects invalid requests before contacting the backend', async () => {
    const fetch = vi.fn(); const api = new OrderService({ authenticatedFetch: fetch })
    await expect(api.list(1, 51)).rejects.toThrow(); await expect(api.get(-1)).rejects.toThrow()
    await expect(api.dispatch(41, { ...input, trackingNumber: 'https://evil.test' })).rejects.toThrow()
    await expect(api.dispatch(41, { ...input, actualShippingCost: NaN })).rejects.toThrow()
    await expect(api.cancel(41, 'CHANGED_MIND' as 'OTHER')).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([
    { carrier: 'EVRI', trackingNumber: '1234567890abcdef' },
    { carrier: 'DPD', trackingNumber: '12345678901234' },
    { carrier: 'OTHER', carrierName: 'Local Post', trackingNumber: 'ABC123' },
  ])('validates carrier-specific tracking $carrier', value => {
    expect(validateDispatch({ ...value, actualShippingCost: 0 }).trackingNumber).toBe(value.trackingNumber.toUpperCase())
  })
  it('rejects URLs, unknown fields, missing Other names and names on trusted carriers', () => {
    for (const value of [{ ...input, url: 'https://evil.test' }, { ...input, carrierName: 'Name' }, { ...input, carrier: 'OTHER' }, { ...input, actualShippingCost: 100001 }]) expect(() => validateDispatch(value)).toThrow()
  })
  it('gates fulfilment on verified payment and cancellation on absence of any payment record', () => {
    expect(canFulfil(order)).toBe(true); expect(canCancel(order)).toBe(false)
    expect(canCancel({ ...order, payment: null, paymentStatus: null })).toBe(true)
    for (const status of ['PENDING', 'PROCESSING', 'FAILED', 'CANCELED'] as const) {
      const value = { ...order, payment: { ...order.payment!, status }, paymentStatus: status }
      expect(canFulfil(value)).toBe(false); expect(canCancel(value)).toBe(false)
    }
    expect(canFulfil({ ...order, payment: { ...order.payment!, paidAt: null } })).toBe(false)
    expect(canCancel({ ...order, status: 'DISPATCHED', payment: null })).toBe(false)
  })
  it('allows official HTTPS tracking hosts only', () => {
    expect(safeTrackingUrl('https://www.royalmail.com/track-your-item#/tracking-results/AB123456789GB')).toContain('royalmail.com')
    for (const value of [null, 'javascript:alert(1)', 'https://evil.test', 'https://www.evri.com.evil.test/', 'https://user@www.evri.com/', 'http://www.evri.com/', 'https://www.evri.com:444/']) expect(safeTrackingUrl(value)).toBeNull()
  })
})
