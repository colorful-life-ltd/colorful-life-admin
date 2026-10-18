/** Read-only renderer contract. Never pass raw financial database rows across IPC. */
export interface PaymentView {
  id: number; amount: string; currency: string; provider: string
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED'
  paidAt: string | null; refundedAmount: string; reservedRefundAmount: string
}
export interface RefundView {
  id: number; paymentId: number; amount: string; currency: string; provider: string
  status: 'SUCCEEDED' | 'FAILED' | 'PROCESSING'; createdAt: string
  reason: string | null; actorId: number; resolutionCode: string | null; reviewRequired: boolean
}
export type FinancialRead<T> = { state: 'ready'; value: T } | { state: 'error'; message: string }
export interface OrderFinancials {
  payment: FinancialRead<PaymentView | null>
  refunds: FinancialRead<RefundView[]>
  consistent: boolean
}

export function currencyDigits(currency: string): number {
  if (!Intl.supportedValuesOf('currency').includes(currency)) throw new Error('Unsupported currency')
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits!
}
/** Backend Decimal(12,2) is in MAJOR units. Use exact hundredths for arithmetic. */
export function financialHundredths(value: unknown, currency: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value)) throw new Error('Invalid financial amount')
  const [whole, fraction = ''] = value.split('.')
  const digits = currencyDigits(currency)
  if (digits < 2 && /[1-9]/.test(fraction.slice(digits))) throw new Error('Invalid currency precision')
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
}
export function formatFinancialAmount(value: string, currency: string): string {
  financialHundredths(value, currency)
  const digits = currencyDigits(currency)
  const [whole, decimal = ''] = value.split('.')
  const fraction = decimal.padEnd(digits, '0').slice(0, digits)
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).formatToParts(BigInt(whole))
    .map(part => part.type === 'fraction' ? fraction : part.value).join('') + ` ${currency}`
}

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const id = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 2147483647
const timestamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v))
const nullableText = (v: unknown): v is string | null => v === null || typeof v === 'string'
const provider = (v: unknown): v is string => typeof v === 'string' && ['MANUAL', 'STRIPE', 'PAYPAL'].includes(v)
const invalid = (): never => { throw new Error('Invalid financial response') }
function amount(v: unknown, currency: string): string {
  financialHundredths(v, currency)
  return v as string
}
export function parsePayments(value: unknown, orderId: number): PaymentView | null {
  if (!Array.isArray(value) || value.length > 1) return invalid()
  if (!value.length) return null
  const p: unknown = value[0]
  if (!object(p) || !id(p.id) || p.orderId !== orderId || typeof p.currency !== 'string' || !provider(p.provider)
    || typeof p.status !== 'string' || !['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED'].includes(p.status)
    || !(p.paidAt === null || timestamp(p.paidAt))) return invalid()
  const result: PaymentView = { id: p.id, amount: amount(p.amount, p.currency), currency: p.currency, provider: p.provider,
    status: p.status as PaymentView['status'], paidAt: p.paidAt, refundedAmount: amount(p.refundedAmount, p.currency), reservedRefundAmount: amount(p.reservedRefundAmount, p.currency) }
  if (financialHundredths(result.amount, result.currency) <= 0n
    || financialHundredths(result.refundedAmount, result.currency) + financialHundredths(result.reservedRefundAmount, result.currency) > financialHundredths(result.amount, result.currency)) return invalid()
  return result
}
export function parseRefunds(value: unknown, orderId: number): RefundView[] {
  if (!Array.isArray(value)) return invalid()
  const seen = new Set<number>()
  return value.map((r: unknown) => {
    if (!object(r) || !id(r.id) || seen.has(r.id) || r.orderId !== orderId || !id(r.paymentId) || typeof r.currency !== 'string' || !provider(r.provider)
      || typeof r.status !== 'string' || !['SUCCEEDED', 'FAILED', 'PROCESSING'].includes(r.status) || !timestamp(r.createdAt) || !nullableText(r.reason)
      || !id(r.performedByUserId) || !nullableText(r.resolutionCode) || typeof r.reviewRequired !== 'boolean') return invalid()
    seen.add(r.id)
    const result: RefundView = { id: r.id, paymentId: r.paymentId, amount: amount(r.amount, r.currency), currency: r.currency, provider: r.provider,
      status: r.status as RefundView['status'], createdAt: r.createdAt, reason: r.reason, actorId: r.performedByUserId, resolutionCode: r.resolutionCode, reviewRequired: r.reviewRequired }
    if (financialHundredths(result.amount, result.currency) <= 0n) return invalid()
    return result
  })
}
export function financialsConsistent(payment: PaymentView | null, refunds: RefundView[]): boolean {
  if (!payment) return refunds.length === 0
  if (payment.status === 'SUCCEEDED' && !payment.paidAt) return false
  if (refunds.some(r => r.paymentId !== payment.id || r.currency !== payment.currency || r.provider !== payment.provider)) return false
  const sum = (status: RefundView['status']) => refunds.filter(r => r.status === status).reduce((total, r) => total + financialHundredths(r.amount, r.currency), 0n)
  return sum('SUCCEEDED') === financialHundredths(payment.refundedAmount, payment.currency)
    && sum('PROCESSING') === financialHundredths(payment.reservedRefundAmount, payment.currency)
}
export function refundOutcomeUncertain(refund: RefundView): boolean {
  return refund.status === 'PROCESSING' || refund.reviewRequired
    || (refund.resolutionCode !== null && refund.resolutionCode !== `REFUND_${refund.status}`)
}
export function dispatchFinancialWarning(data: OrderFinancials | null): string | null {
  if (!data) return 'Financial information is loading. Wait before dispatching.'
  if (data.payment.state === 'error' || data.refunds.state === 'error') return 'Financial information is incomplete. Refresh before dispatching.'
  if (!data.consistent) return 'Financial reads do not agree. They are separate snapshots; refresh before dispatching.'
  const payment = data.payment.value
  if (!payment) return 'No payment is recorded. Dispatch is unavailable.'
  if (data.refunds.value.some(r => r.reviewRequired || (r.status !== 'PROCESSING' && refundOutcomeUncertain(r)))) return 'A refund requires review. Its recorded status is not a conclusive outcome; resolve it before dispatching.'
  if (financialHundredths(payment.reservedRefundAmount, payment.currency) > 0n) return 'A refund is pending or unresolved. Dispatch is blocked while refund funds are reserved.'
  if (financialHundredths(payment.refundedAmount, payment.currency) >= financialHundredths(payment.amount, payment.currency)) return 'This payment is fully refunded. Dispatch is blocked.'
  if (payment.status !== 'SUCCEEDED' || !payment.paidAt) return 'Payment is not verified as paid. Dispatch is unavailable.'
  return null
}
