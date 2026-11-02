export interface BackendErrorDetails {
  code: string | null
  message: string
  reason?: string
  refundSubmissionDisposition?: 'NOT_SUBMITTED'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export async function readBackendError(response: Response, fallback: string): Promise<BackendErrorDetails> {
  try {
    const body: unknown = await response.clone().json()
    if (!isRecord(body)) return { code: null, message: fallback }

    const embeddedError = isRecord(body.error) ? body.error : null
    const refundSubmissionDisposition = body.refundSubmissionDisposition === 'NOT_SUBMITTED'
      && !['refundId', 'status', 'resolutionCode'].some(key => key in body || !!embeddedError && key in embeddedError)
      ? 'NOT_SUBMITTED' as const : undefined
    if (isRecord(body.error)) {
      return {
        code: typeof body.error.code === 'string' ? body.error.code : null,
        message: typeof body.error.message === 'string' ? body.error.message : fallback,
        reason: typeof body.error.reason === 'string' ? body.error.reason : undefined,
        refundSubmissionDisposition,
      }
    }

    if (typeof body.error === 'string') return { code: /^[A-Z][A-Z0-9_]+$/.test(body.error) ? body.error : null, message: body.error, refundSubmissionDisposition }
  } catch {
    // Keep the operation-specific fallback for unreadable response bodies.
  }
  return { code: null, message: fallback }
}
