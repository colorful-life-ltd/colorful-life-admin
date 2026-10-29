import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectionManager, connectionFetcher, tunnelFailure, type ConnectionDependencies } from '../electron/connection-manager'
import { connectionConfig } from '../electron/connection-config'
import { AuthService } from '../electron/auth-service'
import type { OwnedTunnel } from '../electron/ssm-process'
const config = connectionConfig({ COLORFUL_LIFE_CONNECTION_MODE: 'remote-sandbox' })
const managers: ConnectionManager[] = []
afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.stop().catch(() => undefined))); vi.useRealTimers() })
function fixture(overrides: Partial<ConnectionDependencies> = {}) {
  let output: (s: string) => void = () => undefined, exit: () => void = () => undefined
  const transport: OwnedTunnel = { onOutput(f) { output = f; f('Port 3000 opened for sessionId synthetic-only') }, onExit(f) { exit = f }, stop: vi.fn().mockResolvedValue(undefined) }
  const deps = { discover: vi.fn().mockResolvedValue({ aws: 'aws.exe', env: { Path: 'plugin-dir' } }), portFree: vi.fn().mockResolvedValue(true), spawn: vi.fn().mockResolvedValue(transport), healthy: vi.fn().mockResolvedValue(true), monitorMs: 100000, ...overrides }
  const manager = new ConnectionManager(config, deps); managers.push(manager)
  return { manager, deps, transport, emit: (s: string) => output(s), exit: () => exit() }
}
describe('owned SSM connection', () => {
  it('starts once with explicit profile and safe argument array, and only connects after readiness', async () => {
    const f = fixture(); await Promise.all([f.manager.start(), f.manager.start(), f.manager.ensureReady()])
    expect(f.deps.spawn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(f.deps.spawn).mock.calls[0].slice(0, 2)).toEqual(['aws.exe', ['ssm','start-session','--profile','colorful-life-admin','--region','eu-west-2','--target','i-02b28336518077a8f','--document-name','AWS-StartPortForwardingSession','--parameters','portNumber=3001,localPortNumber=3000']])
    expect(f.manager.status().state).toBe('connected')
  })
  it('refuses an occupied port even if an unrelated HTTP service would be healthy', async () => {
    const f = fixture({ portFree: vi.fn().mockResolvedValue(false) })
    await expect(f.manager.ensureReady()).rejects.toThrow(/occupied/)
    expect(f.deps.spawn).not.toHaveBeenCalled(); expect(f.deps.healthy).not.toHaveBeenCalled()
  })
  it('keeps direct development independent of AWS and preserves explicit Backend URL', async () => {
    const f = fixture(); const manager = new ConnectionManager(connectionConfig({ COLORFUL_LIFE_BACKEND_URL: 'http://127.0.0.1:4567' }), f.deps); managers.push(manager)
    await manager.ensureReady(); expect(f.deps.discover).not.toHaveBeenCalled(); expect(manager.status().mode).toBe('direct')
  })
  it('rejects a remote mode configured for an unintended Backend', () => {
    for (const url of ['https://example.com','http://localhost:3001','http://localhost:3000/api']) expect(() => connectionConfig({ COLORFUL_LIFE_CONNECTION_MODE:'remote-sandbox', COLORFUL_LIFE_BACKEND_URL:url })).toThrow(/configuration/)
  })
  it('reports startup discovery failure without automatic retries', async () => {
    const f = fixture({ discover: vi.fn().mockRejectedValue(new Error('AWS CLI is missing.')) })
    await expect(f.manager.start()).rejects.toThrow(/missing/); await expect(f.manager.ensureReady()).rejects.toThrow(/missing/)
    expect(f.deps.discover).toHaveBeenCalledTimes(1)
  })
  it('requires the owned plugin port-open acknowledgement as well as HTTP readiness', async () => {
    let now = 0
    const transport = { onOutput: vi.fn(), onExit: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) }
    const f = fixture({ spawn: vi.fn().mockResolvedValue(transport), now: () => now, pause: async () => { now += 1000 }, startupMs: 1000 })
    await expect(f.manager.start()).rejects.toThrow(/did not become ready/)
    expect(f.deps.healthy).not.toHaveBeenCalled(); expect(transport.stop).toHaveBeenCalledTimes(1)
  })
  it('waits for Backend health before permitting the real auth service to send sign-in credentials', async () => {
    let complete!: (value: boolean) => void
    const ready = new Promise<boolean>(r => { complete = r })
    const f = fixture({ healthy: vi.fn().mockReturnValue(ready) })
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }))
    const auth = new AuthService(config.backendUrl, connectionFetcher(f.manager, fetcher))
    const login = auth.login({ email:'synthetic@example.invalid', password:'do-not-log' }).catch(() => undefined)
    await vi.waitFor(() => expect(f.deps.healthy).toHaveBeenCalled()); expect(fetcher).not.toHaveBeenCalled()
    complete(true); await login; expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('detects exit, stops only its owned transport and reconnects only on explicit retry', async () => {
    const f = fixture(); await f.manager.start(); f.exit()
    expect(f.manager.status().state).toBe('failed'); await expect(f.manager.ensureReady()).rejects.toThrow(/ended/)
    expect(f.deps.spawn).toHaveBeenCalledTimes(1); await f.manager.retry()
    expect(f.transport.stop).toHaveBeenCalledTimes(1); expect(f.deps.spawn).toHaveBeenCalledTimes(2)
  })
  it('deduplicates concurrent Retry clicks', async () => {
    const f = fixture({ portFree: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true) })
    await f.manager.start().catch(() => undefined); await Promise.all([f.manager.retry(), f.manager.retry()])
    expect(f.deps.spawn).toHaveBeenCalledTimes(1)
  })
  it('honours one retry requested while failed startup cleanup is still finishing', async () => {
    let finish!: () => void
    const f = fixture({ healthy: vi.fn().mockResolvedValue(false), pause: async () => { f.emit('AccessDenied') } })
    vi.mocked(f.transport.stop).mockImplementationOnce(() => new Promise<void>(r => { finish = r }))
    const initial = f.manager.start().catch(() => undefined)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    vi.mocked(f.deps.healthy).mockResolvedValue(true)
    const retries = [f.manager.retry(), f.manager.retry()]
    finish(); await initial; await Promise.all(retries)
    expect(f.deps.spawn).toHaveBeenCalledTimes(2)
    expect(f.manager.status().state).toBe('connected')
  })
  it('blocks respawn if owned process cleanup fails', async () => {
    const f = fixture(); await f.manager.start(); vi.mocked(f.transport.stop).mockRejectedValue(new Error('failure')); f.exit()
    await f.manager.retry(); expect(f.deps.spawn).toHaveBeenCalledTimes(1); expect(f.manager.status().message).toMatch(/cleanup/)
  })
  it('cleans up once on shutdown and disallows later requests', async () => {
    const f = fixture(); await f.manager.start(); await Promise.all([f.manager.stop(), f.manager.stop()])
    expect(f.transport.stop).toHaveBeenCalledTimes(1); await expect(f.manager.ensureReady()).rejects.toThrow(/closing/)
  })
  it('cancels startup on shutdown before allowing authentication', async () => {
    let finish!: (value: boolean) => void
    const f = fixture({ healthy: () => new Promise<boolean>(r => { finish = r }) })
    const start = f.manager.start().catch(() => undefined)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function')); const stopping = f.manager.stop(); finish(true)
    await Promise.all([start, stopping]); expect(f.manager.status().state).not.toBe('connected'); expect(f.transport.stop).toHaveBeenCalledTimes(1)
  })
  it.each([['ExpiredTokenException secret-token', /expired/], ['AccessDeniedException arn:secret', /denied/], ['TargetNotConnected i-sensitive', /unavailable/]])('sanitizes %s', async (text, expected) => {
    const f = fixture({ healthy: vi.fn().mockResolvedValue(false), pause: async () => { f.emit(text) } })
    await expect(f.manager.start()).rejects.toThrow(expected); expect(f.manager.status().message).not.toContain('secret'); expect(f.manager.status().message).not.toContain('sensitive')
  })
  it('classifies missing plugin without echoing provider output', () => { expect(tunnelFailure('SessionManagerPlugin is not found. private-path')).toMatch(/could not start/) })
})
