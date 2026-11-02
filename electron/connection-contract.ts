export type ConnectionStatus = { mode: 'direct' | 'remote-sandbox'; state: 'connecting' | 'connected' | 'failed'; message: string; description?: string }
export interface AdminConnectionApi {
  status(): Promise<ConnectionStatus>
  retry(): Promise<ConnectionStatus>
}
