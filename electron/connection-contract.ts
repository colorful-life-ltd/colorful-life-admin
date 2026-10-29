export type ConnectionStatus = { mode: 'direct' | 'remote-sandbox'; state: 'connecting' | 'connected' | 'failed'; message: string }
export interface AdminConnectionApi {
  status(): Promise<ConnectionStatus>
  retry(): Promise<ConnectionStatus>
}
