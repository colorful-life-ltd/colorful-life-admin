import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { AuthError, type Fetcher } from './auth-service.js'
import { describeConnection, type ConnectionConfig } from './connection-config.js'
import type { ConnectionStatus } from './connection-contract.js'
import { discoverTools, spawnOwnedTunnel, type OwnedTunnel } from './ssm-process.js'

export function tunnelFailure(text: string): string | null {
  if (/ExpiredToken|RequestExpired|security token.*expired|SSO.*expired|Unable to locate credentials|InvalidClientTokenId|Error loading SSO Token|Token has expired/i.test(text)) return 'AWS credentials are missing or expired. Refresh the configured AWS profile credentials, then retry.'
  if (/AccessDenied|not authorized to perform|UnauthorizedOperation/i.test(text)) return 'AWS SSM access was denied. Check access for the configured AWS profile, then retry.'
  if (/TargetNotConnected|InvalidInstanceId|not in a valid state/i.test(text)) return 'The configured EC2 instance is unavailable to Session Manager. Retry when it is connected.'
  if (/SessionManagerPlugin.*not found|session-manager-plugin.*not recognized/i.test(text)) return 'Session Manager Plugin could not start. Check its installation, then retry.'
  if (/address already in use|Only one usage of each socket|bind:.*(denied|in use)/i.test(text)) return 'The local tunnel port is occupied. Close the existing listener or configure another local port, then retry.'
  return null
}
async function portFree(port: number) {
  for (const host of ['127.0.0.1', '::1']) {
    const available = await new Promise<boolean>(resolve => {
      const server = createServer()
      server.once('error', (error: NodeJS.ErrnoException) => resolve(host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code ?? '')))
      server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)))
    })
    if (!available) return false
  }
  return true
}
async function healthy(url: string, signal: AbortSignal) {
  try {
    for (const path of ['/health', '/ready']) {
      const r = await fetch(url + path, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]) })
      await r.body?.cancel()
      if (!r.ok) return false
    }
    return true
  } catch { return false }
}
export type ConnectionDependencies = {
  discover: typeof discoverTools; portFree: (port: number) => Promise<boolean>;
  spawn: typeof spawnOwnedTunnel; healthy: typeof healthy;
  pause: (ms: number, signal: AbortSignal) => Promise<unknown>; now: () => number;
  startupMs: number; monitorMs: number;
  /** Credential-free diagnostics sink (mode, target, state and reason only). */
  log: (line: string) => void;
}
const defaults: ConnectionDependencies = { discover: discoverTools, portFree, spawn: spawnOwnedTunnel, healthy, pause: (ms, signal) => delay(ms, undefined, { signal }), now: Date.now, startupMs: 60000, monitorMs: 5000, log: (line) => console.info(line) }
export class ConnectionManager {
  private view: ConnectionStatus
  private attempt?: Promise<void>
  private controller?: AbortController
  private transport?: OwnedTunnel
  private cleaning?: Promise<void>
  private monitor?: ReturnType<typeof setTimeout>
  private retrying?: Promise<ConnectionStatus>
  private stopped = false
  /** Production waits for an explicit owner selection in the window; other modes need none. */
  private confirmed: boolean
  private readonly deps: ConnectionDependencies
  private readonly config: ConnectionConfig
  constructor(config: ConnectionConfig, dependencies: Partial<ConnectionDependencies> = {}) {
    this.config = config
    this.deps = { ...defaults, ...dependencies }
    this.confirmed = config.mode !== 'remote-production'
    this.view = !this.confirmed
      ? { mode: config.mode, state: 'awaiting-confirmation', message: 'Confirm the Production connection to continue.' }
      : { mode: config.mode, state: config.mode === 'direct' ? 'connected' : 'connecting', message: config.mode === 'direct' ? 'Direct Backend connection configured.' : 'Connecting securely to the Backend…' }
    this.deps.log(`[Admin connection] ${describeConnection(config)}`)
  }
  status(): ConnectionStatus { return { ...this.view, description: describeConnection(this.config) } }
  private fail(message: string) {
    if (this.view.state !== 'failed' || this.view.message !== message) this.deps.log(`[Admin connection] failed: ${message}`)
    this.view = { mode: this.config.mode, state: 'failed', message }
  }
  private clearMonitor() { if (this.monitor) clearTimeout(this.monitor); this.monitor = undefined }
  private async cleanup() {
    this.clearMonitor()
    if (this.cleaning) return this.cleaning
    const transport = this.transport
    if (!transport) return
    this.cleaning = transport.stop().then(() => { if (this.transport === transport) this.transport = undefined }).finally(() => { this.cleaning = undefined })
    return this.cleaning
  }
  start(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error('Admin is closing.'))
    if (!this.confirmed) return Promise.reject(new Error(this.view.message))
    if (this.config.mode === 'direct' || this.view.state === 'connected') return Promise.resolve()
    if (this.attempt) return this.attempt
    if (this.view.state === 'failed') return Promise.reject(new Error(this.view.message))
    const controller = new AbortController(); this.controller = controller
    this.attempt = this.connect(controller).finally(() => { this.attempt = undefined })
    return this.attempt
  }
  private async connect(controller: AbortController) {
    let diagnostic: string | null = null, opened = false, output = '', exited = false
    const check = () => { if (controller.signal.aborted || this.stopped) throw new Error(diagnostic ?? 'The tunnel stopped before the Backend became ready. Retry Connection to reconnect.') }
    try {
      await this.cleanup(); check()
      const tools = await this.deps.discover(this.config); check()
      if (!await this.deps.portFree(this.config.localPort)) throw new Error('The local tunnel port is occupied. Close the existing listener or configure another local port, then retry.')
      check()
      const args = ['ssm', 'start-session', '--profile', this.config.profile, '--region', this.config.region, '--target', this.config.instance, '--document-name', 'AWS-StartPortForwardingSession', '--parameters', `portNumber=${this.config.remotePort},localPortNumber=${this.config.localPort}`]
      this.transport = await this.deps.spawn(tools.aws, args, tools.env)
      this.transport.onOutput(text => {
        output = (output + text).slice(-8192)
        diagnostic = tunnelFailure(output) ?? diagnostic
        if (output.includes(`Port ${this.config.localPort} opened for sessionId`)) opened = true
        if (diagnostic) {
          controller.abort()
          if (!this.stopped && this.view.state === 'connected') {
            this.fail(diagnostic); void this.cleanup().catch(() => this.fail('Tunnel cleanup failed. Close Admin before reconnecting.'))
          }
        }
      })
      this.transport.onExit(() => {
        exited = true; controller.abort()
        if (!this.stopped && this.view.state === 'connected') {
          this.fail(diagnostic ?? 'The secure tunnel ended unexpectedly. Retry Connection to reconnect.')
          void this.cleanup().catch(() => this.fail('Tunnel cleanup failed. Close Admin before reconnecting.'))
        }
      })
      const deadline = this.deps.now() + this.deps.startupMs
      while (this.deps.now() < deadline) {
        check()
        if (opened && !exited && await this.deps.healthy(this.config.backendUrl, controller.signal)) {
          check(); this.view = { mode: this.config.mode, state: 'connected', message: 'Secure Backend connection is ready.' }
          this.deps.log(`[Admin connection] connected: tunnel port ${this.config.localPort} open and Backend /health and /ready OK`)
          output = ''; this.scheduleMonitor(controller); return
        }
        await this.deps.pause(250, controller.signal)
      }
      throw new Error('The tunnel did not become ready. Check AWS connectivity and Backend health, then retry.')
    } catch (error) {
      controller.abort()
      const message = diagnostic ?? (error instanceof Error && error.name !== 'AbortError' ? error.message : 'Connection was interrupted. Retry Connection to reconnect.')
      this.fail(message)
      try { await this.cleanup() } catch { this.fail('Tunnel cleanup failed. Close Admin before reconnecting.') }
      throw new Error(this.view.message, { cause: error })
    }
  }
  private scheduleMonitor(controller: AbortController) {
    this.monitor = setTimeout(() => {
      void (async () => {
        if (controller.signal.aborted || this.stopped) return
        if (!await this.deps.healthy(this.config.backendUrl, controller.signal)) {
          if (controller.signal.aborted || this.stopped) return
          this.fail('The Backend connection was lost. Retry Connection to reconnect.'); controller.abort()
          await this.cleanup(); return
        }
        if (!controller.signal.aborted && !this.stopped) this.scheduleMonitor(controller)
      })().catch(() => this.fail('Tunnel cleanup failed. Close Admin before reconnecting.'))
    }, this.deps.monitorMs)
    this.monitor.unref?.()
  }
  async ensureReady() {
    await this.start()
    if (this.stopped || this.view.state !== 'connected') throw new Error(this.view.message)
  }
  /** The only way a remote-production manager starts its tunnel. The mode never changes afterwards. */
  confirmProduction(): Promise<ConnectionStatus> {
    if (this.config.mode !== 'remote-production' || this.confirmed || this.stopped) return Promise.resolve(this.status())
    this.confirmed = true
    this.deps.log('[Admin connection] Production connection confirmed by the owner')
    this.view = { mode: this.config.mode, state: 'connecting', message: 'Connecting securely to the Backend…' }
    void this.start().catch(() => undefined)
    return Promise.resolve(this.status())
  }
  retry(): Promise<ConnectionStatus> {
    if (!this.confirmed) return Promise.resolve(this.status())
    if (this.retrying) return this.retrying
    return this.retrying = this.retryOnce().finally(() => { this.retrying = undefined })
  }
  private async retryOnce(): Promise<ConnectionStatus> {
    if (this.stopped) return this.status()
    if (this.attempt) {
      const alreadyFailed = this.view.state === 'failed'
      await this.attempt.catch(() => undefined)
      if (!alreadyFailed || this.stopped) return this.status()
    }
    if (this.view.state === 'connected') return this.status()
    try { await this.cleanup() } catch { this.fail('Tunnel cleanup failed. Close Admin before reconnecting.'); return this.status() }
    if (this.stopped) return this.status()
    this.view = { mode: this.config.mode, state: 'connecting', message: 'Connecting securely to the Backend…' }
    await this.start().catch(() => undefined)
    return this.status()
  }
  async stop() {
    this.stopped = true; this.controller?.abort(); this.clearMonitor()
    await this.attempt?.catch(() => undefined)
    await this.cleanup()
  }
}
/** One credential-free line per Backend response: method, path without query, status and content type.
 *  An HTML 404 means the request never reached the Backend (for example the public Nginx catch-all). */
export function apiResponseLine(method: string | undefined, url: string, status: number, contentType: string | null): string {
  const path = URL.canParse(url) ? `${new URL(url).origin}${new URL(url).pathname}` : url.split('?')[0]
  return `[Admin API] ${(method ?? 'GET').toUpperCase()} ${path} -> ${status} ${(contentType ?? 'no content-type').split(';')[0]}`
}

export function diagnosticFetcher(fetcher: Fetcher, log: (line: string) => void = (line) => console.info(line)): Fetcher {
  return async (input, init) => {
    let response: Response
    try { response = await fetcher(input, init) }
    catch (error) {
      log(`${apiResponseLine(init?.method, String(input), 0, null).replace(/ -> 0 no content-type$/, '')} -> request failed (${error instanceof Error ? error.name : 'error'})`)
      throw error
    }
    log(apiResponseLine(init?.method, String(input), response.status, response.headers.get('content-type')))
    return response
  }
}

export function connectionFetcher(manager: Pick<ConnectionManager, 'ensureReady'>, fetcher: Fetcher): Fetcher {
  return async (input, init) => {
    try { await manager.ensureReady() } catch { throw new AuthError('network', 'Backend connection is unavailable. Use Retry Connection, then try again.') }
    return fetcher(input, init)
  }
}
