import { financialHundredths } from '../electron/order-financials'
import type { OrderDetail } from '../electron/order-contract'
import type { ReturnCaseView } from '../electron/return-contract'

/**
 * Trust the explicit Admin connection-mode report; do not infer it from a URL.
 * Direct mode remains valid for owner-approved environments. A known remote Sandbox
 * paired with LIVE Stripe is contradictory and must fail closed.
 */
export function stripeEnvironmentMismatch(environment: 'TEST' | 'LIVE' | 'UNKNOWN', connectionMode: 'direct' | 'remote-sandbox' | null): boolean {
  return connectionMode === 'remote-sandbox' && environment === 'LIVE'
}

export function refundInputCents(value: string): bigint | null {
  const match = /^(0|[1-9]\d{0,8})(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!match) return null
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
}

export function refundCentsText(cents: bigint): string {
  if (cents < 0n) throw new Error('Invalid refund amount')
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`
}

export function completedReturnedItemsCents(detail: ReturnCaseView, order: OrderDetail, currency = order.currency): bigint | null {
  const prices = new Map(order.orderItems.map(item => [item.id, item.unitPrice]))
  let total = 0n
  try {
    for (const submission of detail.submissions) for (const line of submission.lines) {
      if (line.status !== 'COMPLETED') continue
      const price = prices.get(line.orderItemId)
      if (!price) return null
      total += financialHundredths(price, currency) * BigInt(line.quantity)
    }
  } catch { return null }
  return total
}

/** Uses the Backend's reconciled frozen delivery snapshot; never infer it from totals. */
export function orderDeliveryChargeCents(order: OrderDetail): bigint | null {
  const chargePence = order.financials?.shipping?.chargePence
  return typeof chargePence === 'number' && Number.isSafeInteger(chargePence) && chargePence >= 0
    ? BigInt(chargePence) : null
}

export function clampRefundCents(value: bigint, available: bigint): bigint {
  if (value < 0n || available < 0n) return 0n
  return value > available ? available : value
}
