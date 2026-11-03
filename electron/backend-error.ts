export interface BackendErrorDetails {
  code: string | null
  message: string
  reason?: string
  refundSubmissionDisposition?: 'NOT_SUBMITTED'
  refundRequestKey?: string
  availableRefundAmount?: string
  blockingRefundId?: number
  blockingRefundStatus?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export async function readBackendError(response: Response, fallback: string): Promise<BackendErrorDetails> {
  try {
    const body: unknown = await response.clone().json()
    if (!isRecord(body)) return { code: null, message: fallback }

    const embeddedError = isRecord(body.error) ? body.error : null
    const requestKey = typeof body.refundRequestKey === 'string' && /^[a-f0-9-]{36}$/.test(body.refundRequestKey) ? body.refundRequestKey : undefined
    const refundSubmissionDisposition = body.refundSubmissionDisposition === 'NOT_SUBMITTED' && requestKey !== undefined
      && !['refundId', 'status', 'resolutionCode'].some(key => key in body || !!embeddedError && key in embeddedError)
      ? 'NOT_SUBMITTED' as const : undefined
    const availableRefundAmount = typeof body.availableRefundAmount === 'string' && /^(0|[1-9]\d{0,9})\.\d{2}$/.test(body.availableRefundAmount)
      ? body.availableRefundAmount : undefined
    const blockingRefundId = Number.isSafeInteger(body.blockingRefundId) && Number(body.blockingRefundId) > 0 ? Number(body.blockingRefundId) : undefined
    const blockingRefundStatus = typeof body.blockingRefundStatus === 'string' ? body.blockingRefundStatus : undefined
    if (isRecord(body.error)) {
      return {
        code: typeof body.error.code === 'string' ? body.error.code : null,
        message: typeof body.error.message === 'string' ? body.error.message : fallback,
        reason: typeof body.error.reason === 'string' ? body.error.reason : undefined,
        refundSubmissionDisposition,
        refundRequestKey: requestKey,
        availableRefundAmount,
        blockingRefundId,
        blockingRefundStatus,
      }
    }

    if (typeof body.error === 'string') return { code: /^[A-Z][A-Z0-9_]+$/.test(body.error) ? body.error : null, message: body.error, refundSubmissionDisposition,
      refundRequestKey: requestKey, availableRefundAmount, blockingRefundId, blockingRefundStatus }
  } catch {
    // Keep the operation-specific fallback for unreadable response bodies.
  }
  return { code: null, message: fallback }
}
