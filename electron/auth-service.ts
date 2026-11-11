import type { AdminSessionEndedNotice, AdminSessionView, AdminUser, BootstrapStatus, FirstAdminRegistration, LoginCredentials } from './auth-contract.js'
import { readBackendError } from './backend-error.js'

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

export type AuthErrorCode =
  | 'invalid-credentials'
  | 'validation'
  | 'not-authorized'
  | 'forbidden'
  | 'auth-required'
  | 'network'
  | 'server'
  | 'malformed-response'
  | 'session-invalid'
  | 'renewal-unavailable'

export class AuthError extends Error {
  readonly code: AuthErrorCode
  readonly backendCode: string | null
  readonly status: number | null

  constructor(code: AuthErrorCode, message: string, backendCode: string | null = null, status: number | null = null) {
    super(message)
    this.code = code
    this.backendCode = backendCode
    this.status = status
    this.name = 'AuthError'
  }
}

interface AuthSessionPayload {
  token: string
  accessTokenExpiresAt: string
  refreshToken: string
  refreshExpiresAt: string
}

interface StoredSession {
  token: string
  accessTokenExpiresAt: string
  user: AdminUser
  refreshToken: string | null
  refreshExpiresAt: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const parseJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json()
  } catch {
    throw new AuthError('malformed-response', 'The server returned an unreadable response.')
  }
}

const isDateString = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))

const parseSessionPayload = (value: unknown): AuthSessionPayload => {
  if (!isRecord(value) || typeof value.token !== 'string' || value.token.trim() === '' ||
    !isDateString(value.accessTokenExpiresAt) || typeof value.refreshToken !== 'string' ||
    value.refreshToken.trim() === '' || !isDateString(value.refreshExpiresAt)) {
    throw new AuthError('malformed-response', 'The server returned an invalid sign-in response.')
  }
  return {
    token: value.token,
    accessTokenExpiresAt: value.accessTokenExpiresAt,
    refreshToken: value.refreshToken,
    refreshExpiresAt: value.refreshExpiresAt,
  }
}

const parseProfileResponse = (value: unknown): AdminUser => {
  if (!isRecord(value) || typeof value.id !== 'number' || typeof value.email !== 'string' ||
    typeof value.role !== 'string' || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') {
    throw new AuthError('malformed-response', 'The server returned an invalid profile response.')
  }

  if (value.role !== 'ADMIN') {
    throw new AuthError('not-authorized', 'This account does not have administrator access.')
  }

  return {
    id: value.id,
    email: value.email,
    role: 'ADMIN',
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

const errorForResponse = async (response: Response, operation: 'login' | 'profile' | 'refresh'): Promise<AuthError> => {
  const details = await readBackendError(response, 'The Colorful Life service could not complete the request.')
  if (operation === 'login' && details.code === 'INVALID_CREDENTIALS') {
    return new AuthError('invalid-credentials', 'The email or password is incorrect.', details.code, response.status)
  }
  if (operation === 'login' && response.status === 401 && details.code === null) {
    return new AuthError('invalid-credentials', 'The email or password is incorrect.', null, response.status)
  }
  if (operation === 'login' && response.status === 400) {
    return new AuthError('validation', 'Enter a valid email address and password.', details.code, response.status)
  }
  if (details.code === 'SESSION_INVALID') {
    return new AuthError('session-invalid', 'Your session has expired. Please sign in again.', details.code, response.status)
  }
  if (details.code === 'AUTH_REQUIRED') {
    return new AuthError('auth-required', 'Sign in is required to continue.', details.code, response.status)
  }
  if (details.code === 'FORBIDDEN') {
    return new AuthError('forbidden', 'This account is not authorized to access the Admin workspace.', details.code, response.status)
  }
  if (response.status >= 500 || details.code === 'INTERNAL_SERVER_ERROR') {
    return new AuthError('server', 'The Colorful Life service is unavailable right now.', details.code, response.status)
  }
  return new AuthError('server', details.message, details.code, response.status)
}

const sessionView = (session: StoredSession): AdminSessionView => ({
  user: session.user,
  accessTokenExpiresAt: session.accessTokenExpiresAt,
})

export class AuthService {
  private session: StoredSession | null = null
  private generation = 0
  private refreshInFlight: Promise<StoredSession> | null = null
  private readonly backendUrl: string
  private readonly fetcher: Fetcher
  private readonly onSessionEnded: (notice: AdminSessionEndedNotice) => void
  private readonly onSessionRenewed: (accessTokenExpiresAt: string) => void

  constructor(
    backendUrl: string,
    fetcher: Fetcher,
    onSessionEnded: (notice: AdminSessionEndedNotice) => void = () => undefined,
    onSessionRenewed: (accessTokenExpiresAt: string) => void = () => undefined,
  ) {
    this.backendUrl = backendUrl
    this.fetcher = fetcher
    this.onSessionEnded = onSessionEnded
    this.onSessionRenewed = onSessionRenewed
  }

  async login(credentials: LoginCredentials): Promise<AdminSessionView> {
    const generation = this.resetSession()
    let loginResponse: Response
    try {
      loginResponse = await this.fetcher(`${this.backendUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      })
    } catch {
      throw new AuthError('network', 'Unable to reach the Colorful Life service.')
    }

    if (!loginResponse.ok) throw await errorForResponse(loginResponse, 'login')

    const payload = parseSessionPayload(await parseJson(loginResponse))

    let user: AdminUser
    try {
      user = await this.fetchProfileWithToken(payload.token)
    } catch (error) {
      void this.revokeRefreshToken(payload.refreshToken)
      throw error
    }

    if (generation !== this.generation) {
      void this.revokeRefreshToken(payload.refreshToken)
      throw new AuthError('session-invalid', 'Sign in was cancelled.')
    }

    this.session = { ...payload, user }
    return sessionView(this.session)
  }

  async bootstrapStatus(): Promise<BootstrapStatus> {
    let response: Response
    try { response = await this.fetcher(`${this.backendUrl}/admin/bootstrap/status`, { headers: { Accept: 'application/json' } }) }
    catch { throw new AuthError('network', 'Unable to reach the Colorful Life service.') }
    const body = await parseJson(response)
    if (!response.ok || !isRecord(body) || typeof body.registrationAvailable !== 'boolean') {
      throw new AuthError('server', 'Administrator setup status is unavailable.', null, response.status)
    }
    return { registrationAvailable: body.registrationAvailable }
  }

  async registerFirstAdmin(credentials: LoginCredentials): Promise<FirstAdminRegistration> {
    let authorizationResponse: Response
    try { authorizationResponse = await this.fetcher(`${this.backendUrl}/admin/bootstrap/authorization`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }) }
    catch { throw new AuthError('network', 'Unable to reach the Colorful Life service.') }
    if (!authorizationResponse.ok) throw new AuthError('server', 'First-time registration is unavailable. Confirm owner access and try again.', null, authorizationResponse.status)
    const authorizationBody = await parseJson(authorizationResponse)
    if (!isRecord(authorizationBody) || typeof authorizationBody.authorization !== 'string') throw new AuthError('malformed-response', 'The server returned an invalid setup authorization.')
    let response: Response
    try {
      response = await this.fetcher(`${this.backendUrl}/admin/bootstrap/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Bootstrap-Authorization': authorizationBody.authorization },
        body: JSON.stringify(credentials),
      })
    } catch { throw new AuthError('network', 'Unable to reach the Colorful Life service.') }
    if (!response.ok) {
      const details = await readBackendError(response, 'Administrator registration failed.')
      if (details.code === 'BOOTSTRAP_CLOSED') throw new AuthError('forbidden', 'Administrator setup is already complete. Sign in or use password recovery.', details.code, response.status)
      if (details.code === 'BOOTSTRAP_AUTHORIZATION_INVALID') throw new AuthError('forbidden', 'Setup authorization expired. Start registration again.', details.code, response.status)
      if (response.status === 400) throw new AuthError('validation', 'Enter a valid email and a strong password.', details.code, response.status)
      throw new AuthError('server', details.message, details.code, response.status)
    }
    // Only an explicit `false` skips email verification; any other or missing value keeps the verification step.
    const body = await parseJson(response)
    return { verificationRequired: !(isRecord(body) && body.verificationRequired === false) }
  }

  async requestPasswordReset(email: string): Promise<void> {
    let response: Response
    try { response = await this.fetcher(`${this.backendUrl}/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }) }
    catch { throw new AuthError('network', 'Unable to reach the Colorful Life service.') }
    if (!response.ok) throw new AuthError('server', 'Password recovery is temporarily unavailable.')
  }

  async restore(): Promise<AdminSessionView | null> {
    const session = this.session
    if (!session) return null
    try {
      const response = await this.authenticatedFetch('/profile')
      const user = parseProfileResponse(await parseJson(response))
      if (this.session) this.session = { ...this.session, user }
      return this.session ? sessionView(this.session) : null
    } catch (error) {
      if (this.session && error instanceof AuthError &&
        (error.code === 'server' || error.code === 'network' || error.code === 'forbidden' || error.code === 'renewal-unavailable')) {
        // A transient backend failure must not discard a previously verified Admin session.
        return sessionView(this.session)
      }
      throw error
    }
  }

  async renewSession(): Promise<{ accessTokenExpiresAt: string }> {
    const renewed = await this.refreshSession()
    return { accessTokenExpiresAt: renewed.accessTokenExpiresAt }
  }

  async logout(): Promise<void> {
    const refreshToken = this.session?.refreshToken ?? null
    this.resetSession()
    if (refreshToken) await this.revokeRefreshToken(refreshToken)
  }

  async authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    let current = this.session
    if (!current) throw new AuthError('session-invalid', 'Your session has expired. Please sign in again.', 'SESSION_INVALID', 401)

    if (Date.parse(current.accessTokenExpiresAt) <= Date.now()) {
      current = await this.refreshSession()
      if (Date.parse(current.accessTokenExpiresAt) <= Date.now()) {
        this.endSession('SESSION_INVALID', 'Your session has expired. Please sign in again.')
        throw new AuthError('session-invalid', 'Your session has expired. Please sign in again.', 'SESSION_INVALID', 401)
      }
    }

    const response = await this.fetchWithToken(path, init, current.token)
    if (response.status !== 401) return response

    const details = await readBackendError(response, 'The authenticated request was rejected.')
    if (details.code === 'AUTH_REQUIRED') {
      this.endSession('AUTH_REQUIRED', 'Sign in is required to continue.')
      throw new AuthError('auth-required', 'Sign in is required to continue.', details.code, response.status)
    }
    if (details.code !== 'SESSION_INVALID') return response

    const renewed = await this.refreshSession()
    const retried = await this.fetchWithToken(path, init, renewed.token)
    if (retried.status === 401) {
      const retryDetails = await readBackendError(retried, 'The authenticated request was rejected.')
      if (retryDetails.code === 'SESSION_INVALID') {
        this.endSession('SESSION_INVALID', 'Your session has expired. Please sign in again.')
        throw new AuthError('session-invalid', 'Your session has expired. Please sign in again.', retryDetails.code, retried.status)
      }
      if (retryDetails.code === 'AUTH_REQUIRED') {
        this.endSession('AUTH_REQUIRED', 'Sign in is required to continue.')
        throw new AuthError('auth-required', 'Sign in is required to continue.', retryDetails.code, retried.status)
      }
    }
    return retried
  }

  private async fetchWithToken(path: string, init: RequestInit, token: string): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    try {
      return await this.fetcher(`${this.backendUrl}${path}`, { ...init, headers })
    } catch {
      throw new AuthError('network', 'Unable to reach the Colorful Life service.')
    }
  }

  private async fetchProfileWithToken(token: string): Promise<AdminUser> {
    let response: Response
    try {
      response = await this.fetcher(`${this.backendUrl}/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {
      throw new AuthError('network', 'Unable to reach the Colorful Life service.')
    }
    if (!response.ok) throw await errorForResponse(response, 'profile')
    return parseProfileResponse(await parseJson(response))
  }

  private refreshSession(): Promise<StoredSession> {
    if (this.refreshInFlight) return this.refreshInFlight
    const current = this.session
    if (!current) return Promise.reject(new AuthError('session-invalid', 'Your session has expired. Please sign in again.', 'SESSION_INVALID', 401))
    if (!current.refreshToken) return Promise.reject(new AuthError('renewal-unavailable', 'This session cannot be safely renewed. Please sign in again.'))

    const generation = this.generation
    const request = this.performRefresh(current, generation)
    this.refreshInFlight = request
    const clearRequest = () => {
      if (this.refreshInFlight === request) this.refreshInFlight = null
    }
    void request.then(clearRequest, clearRequest)
    return request
  }

  private async performRefresh(current: StoredSession, generation: number): Promise<StoredSession> {
    let response: Response
    try {
      response = await this.fetcher(`${this.backendUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      })
    } catch {
      this.markRefreshUnavailable(current, generation)
      throw new AuthError('renewal-unavailable', 'The renewal response could not be confirmed. Your session will end at its expiry.')
    }

    if (!response.ok) {
      const error = await errorForResponse(response, 'refresh')
      if (error.backendCode === 'SESSION_INVALID' || error.backendCode === 'AUTH_REQUIRED') {
        const code = error.backendCode
        this.endSession(code, code === 'SESSION_INVALID' ? 'Your session has expired. Please sign in again.' : 'Sign in is required to continue.')
      }
      throw error
    }

    let payload: AuthSessionPayload
    try {
      payload = parseSessionPayload(await parseJson(response))
    } catch {
      this.markRefreshUnavailable(current, generation)
      throw new AuthError('renewal-unavailable', 'The renewal response could not be confirmed. Your session will end at its expiry.')
    }

    if (generation !== this.generation || this.session !== current) {
      throw new AuthError('session-invalid', 'The session changed before renewal completed.', 'SESSION_INVALID')
    }

    const renewed: StoredSession = { ...current, ...payload }
    this.session = renewed
    this.onSessionRenewed(renewed.accessTokenExpiresAt)
    return renewed
  }

  private markRefreshUnavailable(current: StoredSession, generation: number): void {
    if (generation === this.generation && this.session === current) {
      this.session = { ...current, refreshToken: null }
    }
  }

  private endSession(code: 'SESSION_INVALID' | 'AUTH_REQUIRED', message: string): void {
    const refreshToken = this.session?.refreshToken ?? null
    const hadSession = this.session !== null
    this.resetSession()
    if (refreshToken) void this.revokeRefreshToken(refreshToken)
    if (hadSession) this.onSessionEnded({ code, message })
  }

  private resetSession(): number {
    this.generation += 1
    this.session = null
    this.refreshInFlight = null
    return this.generation
  }

  private async revokeRefreshToken(refreshToken: string): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    try {
      await this.fetcher(`${this.backendUrl}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        signal: controller.signal,
      })
    } catch {
      // Local logout is authoritative for this process even when revocation cannot reach the backend.
    } finally {
      clearTimeout(timeout)
    }
  }
}
