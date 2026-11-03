import { describe, expect, it } from 'vitest'
import { isAdminIpcError, isIpcErrorEnvelope, restoreIpcError, serializeIpcError } from '../electron/ipc-error-contract.js'

describe('Electron IPC error contract', () => {
  it.each(['SESSION_INVALID', 'AUTH_REQUIRED', 'FORBIDDEN', 'INTERNAL_SERVER_ERROR'])('preserves backend code %s across serialization', (backendCode) => {
    const serviceError = Object.assign(new Error('Backend operation failed'), {
      code: backendCode === 'SESSION_INVALID' ? 'session-invalid' : 'server',
      backendCode,
      status: backendCode === 'FORBIDDEN' ? 403 : backendCode === 'INTERNAL_SERVER_ERROR' ? 500 : 401,
    })

    const envelope = serializeIpcError(serviceError)
    expect(isIpcErrorEnvelope(envelope)).toBe(true)
    const rendererError = restoreIpcError(envelope)
    expect(isAdminIpcError(rendererError)).toBe(true)
    expect(rendererError).toMatchObject({
      message: 'Backend operation failed',
      code: serviceError.code,
      backendCode,
      status: serviceError.status,
    })
  })
  it('preserves an explicit no-refund-submitted disposition across Electron IPC', () => {
    const envelope = serializeIpcError(Object.assign(new Error('Refund amount exceeds capacity'), {
      code: 'api', backendCode: 'REFUND_CAPACITY_EXCEEDED', status: 409,
      refundSubmissionDisposition: 'NOT_SUBMITTED',
    }))
    expect(restoreIpcError(envelope)).toMatchObject({ refundSubmissionDisposition: 'NOT_SUBMITTED' })
  })
})
