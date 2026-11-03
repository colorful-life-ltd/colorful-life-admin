export type StripeEnvironment = 'TEST' | 'LIVE' | 'UNKNOWN'
export type PaymentEnvironment = {
  stripeEnvironment: StripeEnvironment
  refundReconciliationEnabled: boolean
}

export function parsePaymentEnvironment(value: unknown): PaymentEnvironment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Stripe environment status is unavailable.')
  const v = value as Record<string, unknown>
  if (!['TEST', 'LIVE', 'UNKNOWN'].includes(String(v.stripeEnvironment)) || typeof v.refundReconciliationEnabled !== 'boolean') {
    throw new Error('Stripe environment status is unavailable.')
  }
  return { stripeEnvironment: v.stripeEnvironment as StripeEnvironment, refundReconciliationEnabled: v.refundReconciliationEnabled }
}
