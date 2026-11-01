import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError, AuthService } from '../electron/auth-service.js'

const adminProfile = { id: 7, email: 'admin@example.com', role: 'ADMIN', createdAt: '2026-01-01', updatedAt: '2026-01-01' }
const expiry = (milliseconds = 60 * 60 * 1000) => new Date(Date.now() + milliseconds).toISOString()
const sessionPayload = (token = 'jwt-token', refreshToken = 'refresh-token', accessTokenExpiresAt = expiry()) => ({
  token,
  accessTokenExpiresAt,
  refreshToken,
  refreshExpiresAt: expiry(7 * 24 * 60 * 60 * 1000),
})
const response = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const backendError = (code: string, message = code) => ({ error: { code, message } })
const loginCalls = (fetcher: ReturnType<typeof vi.fn>) => {
  fetcher.mockResolvedValueOnce(response(sessionPayload())).mockResolvedValueOnce(response(adminProfile))
}

describe('AuthService renewable session lifecycle', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('fetches bootstrap availability and treats a network failure as unavailable, not empty', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ registrationAvailable: true }))
    const service = new AuthService('https://sandbox.test/api', fetcher)
    await expect(service.bootstrapStatus()).resolves.toEqual({ registrationAvailable: true })
    expect(fetcher).toHaveBeenCalledWith('https://sandbox.test/api/admin/bootstrap/status', expect.any(Object))
    await expect(new AuthService('https://sandbox.test/api', vi.fn().mockRejectedValue(new Error('offline'))).bootstrapStatus()).rejects.toMatchObject({ code: 'network' })
  })

  it('uses a short-lived owner authorization before first Admin registration', async () => {
    const authorization = 'x'.repeat(43)
    const fetcher = vi.fn().mockResolvedValueOnce(response({ authorization, expiresInSeconds: 300 })).mockResolvedValueOnce(response({ registered: true }, 201))
    await new AuthService('https://sandbox.test/api', fetcher).registerFirstAdmin({ email: 'owner@example.test', password: 'StrongPass1!' })
    expect(fetcher).toHaveBeenNthCalledWith(1, 'https://sandbox.test/api/admin/bootstrap/authorization', expect.objectContaining({ method: 'POST' }))
    expect(fetcher).toHaveBeenNthCalledWith(2, 'https://sandbox.test/api/admin/bootstrap/register', expect.objectContaining({ headers: expect.objectContaining({ 'X-Admin-Bootstrap-Authorization': authorization }) }))
  })

  it('stores the complete login contract in main and exposes only user plus access expiry', async () => {
    const fetcher = vi.fn()
    loginCalls(fetcher)
    fetcher.mockResolvedValueOnce(response(adminProfile))
    const service = new AuthService('http://backend.test', fetcher)

    await expect(service.login({ email: 'admin@example.com', password: 'secret' })).resolves.toEqual({
      user: adminProfile,
      accessTokenExpiresAt: expect.any(String),
    })
    const loginResult = await service.restore()
    expect(loginResult).toMatchObject({ user: adminProfile, accessTokenExpiresAt: expect.any(String) })
    expect(loginResult).not.toHaveProperty('token')
    expect(loginResult).not.toHaveProperty('refreshToken')
    expect(fetcher).toHaveBeenNthCalledWith(1, 'http://backend.test/auth/login', expect.objectContaining({ method: 'POST' }))
    expect(fetcher.mock.calls[1][0]).toBe('http://backend.test/profile')
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer jwt-token')
    expect(fetcher.mock.calls[2][0]).toBe('http://backend.test/profile')
    expect(new Headers(fetcher.mock.calls[2][1]?.headers).get('Authorization')).toBe('Bearer jwt-token')
  })

  it('preserves structured invalid-credential errors', async () => {
    const service = new AuthService('http://backend.test', vi.fn().mockResolvedValue(response(backendError('INVALID_CREDENTIALS'), 401)))
    await expect(service.login({ email: 'admin@example.com', password: 'wrong' })).rejects.toMatchObject({
      code: 'invalid-credentials', backendCode: 'INVALID_CREDENTIALS', status: 401,
    })
  })

  it('rejects malformed renewable-session metadata', async () => {
    const service = new AuthService('http://backend.test', vi.fn().mockResolvedValue(response({ token: 'jwt-only' })))
    await expect(service.login({ email: 'admin@example.com', password: 'secret' })).rejects.toBeInstanceOf(AuthError)
  })

  it('rejects a login whose verified profile is not an Admin', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(sessionPayload('customer-token'))).mockResolvedValueOnce(response({ ...adminProfile, role: 'CUSTOMER' }))
    const service = new AuthService('http://backend.test', fetcher)
    await expect(service.login({ email: 'customer@example.com', password: 'secret' })).rejects.toMatchObject({ code: 'not-authorized' })
    expect(await service.restore()).toBeNull()
    expect(fetcher).toHaveBeenCalledWith('http://backend.test/auth/logout', expect.objectContaining({ method: 'POST' }))
  })

  it('renews once, replaces both credentials, retries a rejected request with the new access token', async () => {
    const refreshed = sessionPayload('new-jwt', 'rotated-refresh', expiry(2 * 60 * 60 * 1000))
    const fetcher = vi.fn()
    loginCalls(fetcher)
    fetcher.mockResolvedValueOnce(response(backendError('SESSION_INVALID', 'expired'), 401))
    fetcher.mockResolvedValueOnce(response(refreshed))
    fetcher.mockResolvedValueOnce(response({ ok: true }))
    fetcher.mockResolvedValueOnce(response(sessionPayload('newer-jwt', 'newest-refresh')))
    const onSessionRenewed = vi.fn()
    const service = new AuthService('http://backend.test', fetcher, undefined, onSessionRenewed)
    await service.login({ email: 'admin@example.com', password: 'secret' })

    await expect(service.authenticatedFetch('/admin/work')).resolves.toMatchObject({ status: 200 })
    expect(fetcher).toHaveBeenNthCalledWith(4, 'http://backend.test/auth/refresh', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ refreshToken: 'refresh-token' }),
    }))
    expect(fetcher.mock.calls[4][0]).toBe('http://backend.test/admin/work')
    expect(new Headers(fetcher.mock.calls[4][1]?.headers).get('Authorization')).toBe('Bearer new-jwt')

    await service.renewSession()
    expect(fetcher).toHaveBeenNthCalledWith(6, 'http://backend.test/auth/refresh', expect.objectContaining({
      body: JSON.stringify({ refreshToken: 'rotated-refresh' }),
    }))
    expect(onSessionRenewed).toHaveBeenNthCalledWith(1, refreshed.accessTokenExpiresAt)
    expect(onSessionRenewed).toHaveBeenNthCalledWith(2, expect.any(String))
  })

  it('renews an already expired access token before issuing a protected request', async () => {
    const expired = sessionPayload('expired-jwt', 'refresh-token', new Date(Date.now() - 1).toISOString())
    const renewed = sessionPayload('new-jwt', 'rotated-refresh')
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(expired))
      .mockResolvedValueOnce(response(adminProfile))
      .mockResolvedValueOnce(response(renewed))
      .mockResolvedValueOnce(response({ ok: true }))
    const service = new AuthService('http://backend.test', fetcher)
    await service.login({ email: 'admin@example.com', password: 'secret' })

    await expect(service.authenticatedFetch('/admin/work')).resolves.toMatchObject({ status: 200 })
    expect(fetcher.mock.calls[2][0]).toBe('http://backend.test/auth/refresh')
    expect(fetcher.mock.calls[3][0]).toBe('http://backend.test/admin/work')
    expect(new Headers(fetcher.mock.calls[3][1]?.headers).get('Authorization')).toBe('Bearer new-jwt')
  })

  it('coalesces simultaneous renewal calls into one refresh request', async () => {
    const fetcher = vi.fn()
    loginCalls(fetcher)
    let resolveRefresh: (value: Response) => void = () => undefined
    fetcher.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveRefresh = resolve }))
    const service = new AuthService('http://backend.test', fetcher)
    await service.login({ email: 'admin@example.com', password: 'secret' })

    const first = service.renewSession()
    const second = service.renewSession()
    expect(fetcher.mock.calls.filter(([url]) => url === 'http://backend.test/auth/refresh')).toHaveLength(1)
    resolveRefresh(response(sessionPayload('new-jwt', 'new-refresh')))
    await expect(Promise.all([first, second])).resolves.toEqual([
      { accessTokenExpiresAt: expect.any(String) },
      { accessTokenExpiresAt: expect.any(String) },
    ])
  })

  it('ends the session once when the refresh credential is invalid', async () => {
    const onSessionEnded = vi.fn()
    const fetcher = vi.fn()
    loginCalls(fetcher)
    fetcher.mockResolvedValueOnce(response(backendError('SESSION_INVALID'), 401))
    fetcher.mockResolvedValueOnce(response(backendError('SESSION_INVALID'), 401))
    fetcher.mockResolvedValueOnce(response(null, 204))
    const service = new AuthService('http://backend.test', fetcher, onSessionEnded)
    await service.login({ email: 'admin@example.com', password: 'secret' })

    await expect(service.authenticatedFetch('/admin/work')).rejects.toMatchObject({ backendCode: 'SESSION_INVALID' })
    expect(onSessionEnded).toHaveBeenCalledOnce()
    expect(onSessionEnded).toHaveBeenCalledWith(expect.objectContaining({ code: 'SESSION_INVALID' }))
    await expect(service.restore()).resolves.toBeNull()
  })

  it('coalesces simultaneous SESSION_INVALID responses into one recovery flow', async () => {
    const onSessionEnded = vi.fn()
    const fetcher = vi.fn()
    loginCalls(fetcher)
    fetcher.mockResolvedValueOnce(response(backendError('SESSION_INVALID'), 401))
    fetcher.mockResolvedValueOnce(response(backendError('SESSION_INVALID'), 401))
    let resolveRefresh: (value: Response) => void = () => undefined
    fetcher.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveRefresh = resolve }))
    fetcher.mockResolvedValueOnce(response(null, 204))
    const service = new AuthService('http://backend.test', fetcher, onSessionEnded)
    await service.login({ email: 'admin@example.com', password: 'secret' })

    const first = service.authenticatedFetch('/admin/first')
    const second = service.authenticatedFetch('/admin/second')
    await vi.waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url === 'http://backend.test/auth/refresh')).toHaveLength(1))
    resolveRefresh(response(backendError('SESSION_INVALID'), 401))
    const results = await Promise.allSettled([first, second])
    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    expect(onSessionEnded).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls.filter(([url]) => url === 'http://backend.test/auth/logout')).toHaveLength(1)
  })

  it('ends a protected Admin session for structured AUTH_REQUIRED', async () => {
    const onSessionEnded = vi.fn()
    const fetcher = vi.fn()
    loginCalls(fetcher)
    fetcher.mockResolvedValueOnce(response(backendError('AUTH_REQUIRED'), 401))
    fetcher.mockResolvedValueOnce(response(null, 204))
    const service = new AuthService('http://backend.test', fetcher, onSessionEnded)
    await service.login({ email: 'admin@example.com', password: 'secret' })

    await expect(service.authenticatedFetch('/admin/work')).rejects.toMatchObject({ code: 'auth-required', backendCode: 'AUTH_REQUIRED' })
    expect(onSessionEnded).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTH_REQUIRED' }))
    await expect(service.restore()).resolves.toBeNull()
  })

  it('does not treat an unstructured 401, FORBIDDEN, or INTERNAL_SERVER_ERROR as session expiry', async () => {
    const onSessionEnded = vi.fn()
    const fetcher = vi.fn()
    loginCalls(fetcher)
    fetcher.mockResolvedValueOnce(response({ error: { message: 'unauthorized' } }, 401))
    fetcher.mockResolvedValueOnce(response(backendError('FORBIDDEN'), 403))
    fetcher.mockResolvedValueOnce(response(backendError('INTERNAL_SERVER_ERROR'), 500))
    const service = new AuthService('http://backend.test', fetcher, onSessionEnded)
    await service.login({ email: 'admin@example.com', password: 'secret' })

    await expect(service.authenticatedFetch('/admin/unknown-401')).resolves.toMatchObject({ status: 401 })
    await expect(service.authenticatedFetch('/admin/forbidden')).resolves.toMatchObject({ status: 403 })
    await expect(service.authenticatedFetch('/admin/failure')).resolves.toMatchObject({ status: 500 })
    expect(onSessionEnded).not.toHaveBeenCalled()
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe('http://backend.test/admin/failure')
    expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).get('Authorization')).toBe('Bearer jwt-token')
  })

  it('does not restore a stale refresh response after logout', async () => {
    const fetcher = vi.fn()
    loginCalls(fetcher)
    let resolveRefresh: (value: Response) => void = () => undefined
    fetcher.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveRefresh = resolve }))
    fetcher.mockResolvedValueOnce(response(null, 204))
    const service = new AuthService('http://backend.test', fetcher)
    await service.login({ email: 'admin@example.com', password: 'secret' })

    const pendingRenewal = service.renewSession()
    await service.logout()
    resolveRefresh(response(sessionPayload('stale-jwt', 'stale-refresh')))
    await expect(pendingRenewal).rejects.toMatchObject({ code: 'session-invalid' })
    await expect(service.restore()).resolves.toBeNull()
    expect(fetcher).toHaveBeenCalledWith('http://backend.test/auth/logout', expect.objectContaining({
      body: JSON.stringify({ refreshToken: 'refresh-token' }),
    }))
  })

  it('completes local logout when backend revocation fails', async () => {
    const fetcher = vi.fn()
    loginCalls(fetcher)
    fetcher.mockRejectedValueOnce(new Error('offline'))
    const service = new AuthService('http://backend.test', fetcher)
    await service.login({ email: 'admin@example.com', password: 'secret' })

    await expect(service.logout()).resolves.toBeUndefined()
    await expect(service.restore()).resolves.toBeNull()
    expect(fetcher).toHaveBeenCalledWith('http://backend.test/auth/logout', expect.objectContaining({
      body: JSON.stringify({ refreshToken: 'refresh-token' }),
    }))
  })

  it('does not retry an old refresh token after a network-ambiguous rotation failure', async () => {
    const fetcher = vi.fn()
    loginCalls(fetcher)
    fetcher.mockRejectedValueOnce(new Error('connection lost'))
    fetcher.mockResolvedValueOnce(response({ ok: true }))
    const service = new AuthService('http://backend.test', fetcher)
    await service.login({ email: 'admin@example.com', password: 'secret' })

    await expect(service.renewSession()).rejects.toMatchObject({ code: 'renewal-unavailable' })
    await expect(service.renewSession()).rejects.toMatchObject({ code: 'renewal-unavailable' })
    await service.authenticatedFetch('/admin/work')
    expect(fetcher.mock.calls.filter(([url]) => url === 'http://backend.test/auth/refresh')).toHaveLength(1)
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe('http://backend.test/admin/work')
    expect(new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers).get('Authorization')).toBe('Bearer jwt-token')
  })

  it('keeps credentials after a structured internal refresh failure', async () => {
    const fetcher = vi.fn()
    loginCalls(fetcher)
    fetcher.mockResolvedValueOnce(response(backendError('INTERNAL_SERVER_ERROR'), 500))
    fetcher.mockResolvedValueOnce(response(sessionPayload('retry-jwt', 'retry-refresh')))
    const service = new AuthService('http://backend.test', fetcher)
    await service.login({ email: 'admin@example.com', password: 'secret' })

    await expect(service.renewSession()).rejects.toMatchObject({ code: 'server', backendCode: 'INTERNAL_SERVER_ERROR' })
    await expect(service.renewSession()).resolves.toMatchObject({ accessTokenExpiresAt: expect.any(String) })
    expect(fetcher).toHaveBeenLastCalledWith('http://backend.test/auth/refresh', expect.objectContaining({
      body: JSON.stringify({ refreshToken: 'refresh-token' }),
    }))
  })
})
