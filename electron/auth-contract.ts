export interface AdminUser {
  id: number
  email: string
  role: 'ADMIN'
  createdAt: string
  updatedAt: string
}

export interface LoginCredentials {
  email: string
  password: string
}

export interface BootstrapStatus { registrationAvailable: boolean }

export interface AdminSessionView {
  user: AdminUser
  accessTokenExpiresAt: string
}

export interface AdminSessionEndedNotice {
  code: 'SESSION_INVALID' | 'AUTH_REQUIRED'
  message: string
}

export interface AdminAuthApi {
  bootstrapStatus(): Promise<BootstrapStatus>
  registerFirstAdmin(credentials: LoginCredentials): Promise<void>
  requestPasswordReset(email: string): Promise<void>
  login(credentials: LoginCredentials): Promise<AdminSessionView>
  restore(): Promise<AdminSessionView | null>
  renewSession(): Promise<{ accessTokenExpiresAt: string }>
  onSessionRenewed(listener: (accessTokenExpiresAt: string) => void): () => void
  onSessionEnded(listener: (notice: AdminSessionEndedNotice) => void): () => void
  logout(): Promise<void>
}
