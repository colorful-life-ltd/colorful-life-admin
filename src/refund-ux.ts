import { financialHundredths } from '../electron/order-financials'
import type { OrderDetail } from '../electron/order-contract'
import type { ReturnCaseView } from '../electron/return-contract'

import type { ConnectionMode } from '../electron/connection-contract'
export type { ConnectionMode }

/**
 * Accept a mode only from a complete, connected ConnectionStatus (electron/connection-contract.ts):
 * a non-array object with state 'connected', a string message and an exact mode. Anything else,
 * including a connecting or failed connection, is unverified (null). Never infer the mode from a
 * URL and never default to a permissive mode.
 */
export function parseConnectionMode(status: unknown): ConnectionMode | null {
  if (!status || typeof status !== 'object' || Array.isArray(status)) return null
  const { mode, state, message } = status as Record<string, unknown>
  if (state !== 'connected' || typeof message !== 'string') return null
  return mode === 'direct' || mode === 'remote-sandbox' || mode === 'remote-production' ? mode : null
}

/**
 * A LIVE (real-money) refund requires an explicitly verified Production tunnel or direct Admin connection.
 * LIVE with a remote Sandbox, a missing or a malformed connection mode fails closed, and a Production
 * tunnel reporting TEST Stripe is a misconfiguration that fails closed too.
 * TEST and UNKNOWN environments are otherwise gated separately by the caller.
 */
export function stripeEnvironmentMismatch(environment: 'TEST' | 'LIVE' | 'UNKNOWN', connectionMode: unknown): boolean {
  if (connectionMode === 'remote-production') return environment === 'TEST'
  return environment === 'LIVE' && connectionMode !== 'direct'
}

export function liveConnectionBlockMessage(connectionMode: unknown): string {
  if (connectionMode === 'remote-sandbox') return 'Sandbox is connected to a LIVE Stripe environment. Refund is blocked.'
  if (connectionMode === 'remote-production') return 'Production is reporting a TEST Stripe environment. Refund is blocked.'
  return 'LIVE Stripe refunds require a verified Production or direct Admin connection, and the connection mode could not be verified. Refund is blocked.'
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
