export type ConnectionMode = 'direct' | 'remote-sandbox' | 'remote-production'
/** `awaiting-confirmation` is used only by remote-production: no tunnel starts until the owner confirms in the window. */
export type ConnectionStatus = { mode: ConnectionMode; state: 'awaiting-confirmation' | 'connecting' | 'connected' | 'failed'; message: string; description?: string }
export interface AdminConnectionApi {
  status(): Promise<ConnectionStatus>
  retry(): Promise<ConnectionStatus>
  /** Explicit per-launch owner selection; a no-op outside remote-production. */
  confirmProduction(): Promise<ConnectionStatus>
}
