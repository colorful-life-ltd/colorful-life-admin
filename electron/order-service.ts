import { parsePayments, parseRefunds, financialsConsistent } from './order-financials.js'
import type { OrderFinancials } from './order-financials.js'
import type { AuthService } from './auth-service.js'
import { readBackendError } from './backend-error.js'
import { cancellationReasons } from './order-contract.js'
import type { AdminOrdersApi, Carrier, CancellationReason, DispatchInput, OrderDetail, OrderPage, OrderSummary } from './order-contract.js'

export class OrderError extends Error {
  readonly code: string
  readonly backendCode: string | null
  readonly status: number | null
  constructor(code: string, message: string, backendCode: string | null = null, status: number | null = null) { super(message); this.name = 'OrderError'; this.code = code; this.backendCode = backendCode; this.status = status }
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const text = (v: unknown): v is string => typeof v === 'string'
const nullableText = (v: unknown) => v === null || text(v)
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v))
const nullableDate = (v: unknown) => v === null || date(v)
const money = (v: unknown) => text(v) && /^\d+(\.\d+)?$/.test(v)
const stage = (v: unknown) => v === null || ['CONFIRMED', 'PREPARING', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED'].includes(String(v))
const malformed = () => new OrderError('malformed-response', 'The server returned invalid order data. Please refresh.')
export function validateOrderId(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 2147483647) throw new OrderError('validation', 'Invalid order ID.')
  return v
}
export function validatePage(v: unknown, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > max) throw new OrderError('validation', 'Invalid order pagination.')
  return v
}
const patterns: Record<Carrier, RegExp> = { ROYAL_MAIL: /^[A-Z]{2}\d{9}GB$/, EVRI: /^[A-Z0-9]{16}$/, DPD: /^\d{14}$/, OTHER: /^[A-Z0-9]{6,40}$/ }
export function validateDispatch(v: unknown): DispatchInput {
  if (!record(v) || Object.keys(v).some(k => !['carrier', 'carrierName', 'trackingNumber', 'actualShippingCost'].includes(k)) || !Object.hasOwn(patterns, String(v.carrier))) throw new OrderError('validation', 'Choose a supported carrier.')
  const carrier = v.carrier as Carrier
  if (!text(v.trackingNumber) || v.trackingNumber.length > 100) throw new OrderError('validation', 'Enter a valid tracking number.')
  const trackingNumber = v.trackingNumber.trim().replace(/[\s-]+/g, '').toUpperCase()
  if (!patterns[carrier].test(trackingNumber)) throw new OrderError('validation', 'Enter a valid tracking number for the selected carrier.')
  if (typeof v.actualShippingCost !== 'number' || !Number.isFinite(v.actualShippingCost) || v.actualShippingCost < 0 || v.actualShippingCost > 100000) throw new OrderError('validation', 'Shipping cost must be between 0 and 100000.')
  if (carrier === 'OTHER' ? !text(v.carrierName) || !v.carrierName.trim() || v.carrierName.trim().length > 100 : v.carrierName !== undefined) throw new OrderError('validation', 'Provide a carrier name only when choosing Other (up to 100 characters).')
  return { carrier, trackingNumber, actualShippingCost: v.actualShippingCost, ...(carrier === 'OTHER' ? { carrierName: (v.carrierName as string).trim() } : {}) }
}
export function validateReason(v: unknown): CancellationReason {
  if (!cancellationReasons.includes(v as CancellationReason)) throw new OrderError('validation', 'Choose a cancellation reason.')
  return v as CancellationReason
}
export function parseSummary(v: unknown): OrderSummary {
  if (!record(v) || !record(v.user) || !text(v.user.email) || !nullableText(v.user.firstName) || !nullableText(v.user.lastName) || !money(v.totalAmount) || !text(v.currency) || !/^[A-Z]{3}$/.test(v.currency.toUpperCase()) || !date(v.createdAt) || !nullableDate(v.preparingAt) || !nullableDate(v.dispatchedAt) || !nullableText(v.shippingCarrier) || !nullableText(v.trackingNumber) || !stage(v.fulfilmentStage) || !['PENDING', 'CONFIRMED', 'DISPATCHED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'RETURNED'].includes(String(v.status))) throw malformed()
  validateOrderId(v.id); validateOrderId(v.user.id)
  if (v.payment !== null && (!record(v.payment) || !['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED'].includes(String(v.payment.status)) || !text(v.payment.currency) || !nullableDate(v.payment.paidAt))) throw malformed()
  if (v.paymentStatus !== (v.payment === null ? null : (v.payment as Record<string, unknown>).status)) throw malformed()
  return v as unknown as OrderSummary
}
export function parseDetail(v: unknown): OrderDetail {
  parseSummary(v)
  if (!record(v) || !nullableDate(v.cancelledAt) || !(v.actualShippingCost === null || money(v.actualShippingCost)) || !['deliveryRecipientName', 'deliveryLine1', 'deliveryCity', 'deliveryPostcode', 'deliveryCountryCode'].every(k => text(v[k])) || !['deliveryLine2', 'deliveryCounty', 'deliveryPhone'].every(k => nullableText(v[k])) || !Array.isArray(v.orderItems) || !record(v.fulfilment) || !stage(v.fulfilment.stage) || !nullableDate(v.fulfilment.preparingAt) || !nullableDate(v.fulfilment.dispatchedAt) || !Array.isArray(v.fulfilment.shipments) || !Array.isArray(v.fulfilmentEvents)) throw malformed()
  for (const item of v.orderItems) {
    if (!record(item) || !money(item.unitPrice) || !money(item.lineTotal) || !record(item.productListing) || !record(item.productListing.legoProduct) || !text(item.productListing.legoProduct.title) || !text(item.productListing.legoProduct.setNumber) || !text(item.productListing.condition)) throw malformed()
    validateOrderId(item.id); validateOrderId(item.quantity)
  }
  for (const s of v.fulfilment.shipments) {
    if (!record(s) || !text(s.carrierName) || !nullableText(s.trackingNumber) || !date(s.dispatchedAt) || !nullableText(s.trackingUrl) || typeof s.trackingUrlIncludesNumber !== 'boolean' || !(s.carrier === null || Object.hasOwn(patterns, String(s.carrier)))) throw malformed()
    validateOrderId(s.sequence)
  }
  for (const e of v.fulfilmentEvents) {
    if (!record(e) || !text(e.action) || !stage(e.fromStage) || !stage(e.toStage) || !text(e.source) || !date(e.createdAt) || !record(e.performedByUser) || !text(e.performedByUser.email)) throw malformed()
    validateOrderId(e.id); validateOrderId(e.performedByUser.id)
  }
  return v as unknown as OrderDetail
}
export class OrderService implements AdminOrdersApi {
  private readonly auth: Pick<AuthService, 'authenticatedFetch'>
  constructor(auth: Pick<AuthService, 'authenticatedFetch'>) { this.auth = auth }
  private async request(path: string, body?: object): Promise<unknown> {
    const response = await this.auth.authenticatedFetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!response.ok) {
      const error = await readBackendError(response, 'The order request could not be completed.')
      const messages: Record<string, string> = { ORDER_ALREADY_PAID: 'Paid orders cannot be cancelled. No refund has been performed.', ORDER_PAYMENT_UNRESOLVED: 'This order has a payment attempt and cannot be cancelled.', ORDER_PAYMENT_NOT_VERIFIED: 'Payment is not eligible for fulfilment. The order has been refreshed.', FULFILMENT_TRANSITION_INVALID: 'The order state changed or this action is unavailable. The order has been refreshed.', ORDER_ALREADY_DISPATCHED: 'This order has already been dispatched. Shipment details cannot be overwritten.' }
      const blockReasons: Record<string,string> = {
        CANCELLATION_PENDING: 'A paid cancellation request is active. Follow staged cancellation or withdraw the exact request before refund initiation.',
        INVENTORY_DISCREPANCY: 'Inventory discrepancy: inspect the listing and record a reasoned physical stocktake.',
        PROVIDER_DISPUTE_REVIEW_REQUIRED: 'Provider dispute: investigate verified financial evidence. Acknowledgement alone cannot release this hold.',
        PROVIDER_REVERSAL_REVIEW_REQUIRED: 'Provider reversal: investigate the capture and refund evidence before fulfilment.',
        PAYMENT_UNRESOLVED: 'Payment evidence is unresolved or conflicting. Reconcile and review; do not dispatch.',
        PAYMENT_AMOUNT_MISMATCH: 'Payment amount or currency does not match the order. Investigate the payment.',
        REFUND_IN_PROGRESS: 'Refund is pending or uncertain. Reconcile it before fulfilment.',
        FULLY_REFUNDED: 'Payment is fully refunded. Do not dispatch; use the eligible cancellation/return workflow.',
        REFUND_REVIEW_REQUIRED: 'Refund evidence requires review before fulfilment.',
      }
      const reason = error.reason ?? /\(([A-Z_]+)\)/.exec(error.message)?.[1]
      if (reason && blockReasons[reason]) throw new OrderError('api',blockReasons[reason],reason,response.status)
      messages.SECURITY_REVIEW_REQUIRED = 'Dispatch is blocked by a payment security review. This hold cannot be released here. Wait until the review is resolved before trying again.'
      // The current Backend nests the security-review reason in its payment eligibility error.
      const securityReview = error.code === 'SECURITY_REVIEW_REQUIRED' || (error.code === 'ORDER_PAYMENT_NOT_VERIFIED' && error.message.includes('(SECURITY_REVIEW_REQUIRED)'))
      throw new OrderError('api', securityReview ? messages.SECURITY_REVIEW_REQUIRED : messages[error.code ?? ''] ?? error.message, error.code, response.status)
    }
    try { return await response.json() } catch { throw malformed() }
  }
  async financials(id: number): Promise<OrderFinancials> {
    validateOrderId(id)
    const [payment, refunds] = await Promise.allSettled([
      this.request(`/orders/${id}/payments`).then(value => parsePayments(value, id)),
      this.request(`/orders/${id}/refunds`).then(value => parseRefunds(value, id)),
    ])
    // Never turn an authorization failure into a partial financial view.
    for (const read of [payment, refunds]) {
      if (read.status === 'rejected' && (read.reason?.status === 401 || read.reason?.status === 403 || ['auth-required', 'session-invalid', 'forbidden', 'not-authorized'].includes(read.reason?.code))) throw read.reason
    }
    return {
      payment: payment.status === 'fulfilled' ? { state: 'ready', value: payment.value } : { state: 'error', message: 'Payment information could not be read. Refresh to retry.' },
      refunds: refunds.status === 'fulfilled' ? { state: 'ready', value: refunds.value } : { state: 'error', message: 'Refund history could not be read. Refresh to retry.' },
      consistent: payment.status === 'fulfilled' && refunds.status === 'fulfilled' && financialsConsistent(payment.value, refunds.value),
    }
  }
  async list(page = 1, pageSize = 20): Promise<OrderPage> {
    const v = await this.request(`/admin/orders?page=${validatePage(page, 10000)}&pageSize=${validatePage(pageSize, 50)}`)
    if (!record(v) || !Array.isArray(v.items) || !record(v.pagination) || !['page', 'pageSize', 'totalItems', 'totalPages'].every(k => typeof v.pagination === 'object' && v.pagination !== null && Number.isInteger((v.pagination as Record<string, unknown>)[k]) && Number((v.pagination as Record<string, unknown>)[k]) >= 0)) throw malformed()
    return { items: v.items.map(parseSummary), pagination: v.pagination as unknown as OrderPage['pagination'] }
  }
  async get(id: number) { return parseDetail(await this.request(`/admin/orders/${validateOrderId(id)}`)) }
  async preparing(id: number) { return parseDetail(await this.request(`/admin/orders/${validateOrderId(id)}/fulfilment/preparing`, {})) }
  async dispatch(id: number, input: DispatchInput) { return parseDetail(await this.request(`/admin/orders/${validateOrderId(id)}/fulfilment/dispatch`, validateDispatch(input))) }
  async cancel(id: number, reason: CancellationReason) { await this.request(`/orders/${validateOrderId(id)}/seller-cancel`, { reason: validateReason(reason) }) }
}
