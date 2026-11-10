import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectionConfig, describeConnection, PRODUCTION_LOCAL_PORT, PRODUCTION_REMOTE_PORT } from '../electron/connection-config'
import { ConnectionManager, connectionFetcher, type ConnectionDependencies } from '../electron/connection-manager'
import { AuthError } from '../electron/auth-service'
import type { ConnectionStatus } from '../electron/connection-contract'
import type { OwnedTunnel } from '../electron/ssm-process'
import ConnectionPanel from './ConnectionPanel'
import { liveConnectionBlockMessage, parseConnectionMode, stripeEnvironmentMismatch } from './refund-ux'

const PRODUCTION = { COLORFUL_LIFE_CONNECTION_MODE: 'remote-production' }
const invalid = /Invalid Admin connection configuration/

describe('environment selection and port enforcement', () => {
  it('never selects Production by default or from any other setting', () => {
    expect(connectionConfig({}).mode).toBe('remote-sandbox')
    expect(connectionConfig({ COLORFUL_LIFE_BACKEND_URL: 'http://localhost:3000' }).mode).toBe('direct')
    expect(connectionConfig({ COLORFUL_LIFE_SSM_REMOTE_PORT: '3005' }).mode).toBe('remote-sandbox')
    for (const mode of ['production', 'Remote-Production', 'remote_production', 'remote-production ']) expect(() => connectionConfig({ COLORFUL_LIFE_CONNECTION_MODE: mode })).toThrow(invalid)
  })
  it('explicit Production mode tunnels local 3002 to remote 3002 on the existing instance and profile', () => {
    const config = connectionConfig(PRODUCTION)
    expect(config).toMatchObject({ mode: 'remote-production', backendUrl: 'http://localhost:3002', localPort: PRODUCTION_LOCAL_PORT, remotePort: PRODUCTION_REMOTE_PORT, instance: 'i-02b28336518077a8f', profile: 'colorful-life-admin', modeSource: 'COLORFUL_LIFE_CONNECTION_MODE' })
    expect(describeConnection(config)).toBe('mode=remote-production target=http://localhost:3002 -> SSM i-02b28336518077a8f:3002 (profile colorful-life-admin, eu-west-2) chosen by COLORFUL_LIFE_CONNECTION_MODE')
    expect(connectionConfig({ ...PRODUCTION, COLORFUL_LIFE_SSM_REMOTE_PORT: '3002', COLORFUL_LIFE_SSM_LOCAL_PORT: '3002', COLORFUL_LIFE_BACKEND_URL: 'http://127.0.0.1:3002' }).backendUrl).toBe('http://127.0.0.1:3002')
  })
  it('Production refuses the Sandbox port and any unexpected port or Backend URL', () => {
    for (const port of ['3001', '3000', '3003', '443', '0', 'abc']) {
      expect(() => connectionConfig({ ...PRODUCTION, COLORFUL_LIFE_SSM_REMOTE_PORT: port })).toThrow(invalid)
      expect(() => connectionConfig({ ...PRODUCTION, COLORFUL_LIFE_SSM_LOCAL_PORT: port })).toThrow(invalid)
    }
    for (const url of ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002/api', 'https://build-and-bloom.co.uk/api', 'https://example.com'])
      expect(() => connectionConfig({ ...PRODUCTION, COLORFUL_LIFE_BACKEND_URL: url })).toThrow(invalid)
  })
  it('Sandbox stays on 3001 and refuses the Production port; direct mode cannot use it either', () => {
    expect(connectionConfig({ COLORFUL_LIFE_CONNECTION_MODE: 'remote-sandbox' })).toMatchObject({ backendUrl: 'http://localhost:3000', localPort: 3000, remotePort: 3001 })
    expect(() => connectionConfig({ COLORFUL_LIFE_SSM_REMOTE_PORT: '3002' })).toThrow(invalid)
    expect(() => connectionConfig({ COLORFUL_LIFE_CONNECTION_MODE: 'remote-sandbox', COLORFUL_LIFE_SSM_REMOTE_PORT: '3002' })).toThrow(invalid)
    expect(() => connectionConfig({ COLORFUL_LIFE_SSM_LOCAL_PORT: '3002', COLORFUL_LIFE_BACKEND_URL: 'http://localhost:3002', COLORFUL_LIFE_CONNECTION_MODE: 'remote-sandbox' })).toThrow(invalid)
    expect(() => connectionConfig({ COLORFUL_LIFE_BACKEND_URL: 'http://localhost:3002' })).toThrow(invalid)
    expect(() => connectionConfig({ COLORFUL_LIFE_CONNECTION_MODE: 'direct', COLORFUL_LIFE_BACKEND_URL: 'http://127.0.0.1:3002/api' })).toThrow(invalid)
  })
})

function productionFixture(overrides: Partial<ConnectionDependencies> = {}) {
  let output: (s: string) => void = () => undefined
  const transport: OwnedTunnel = { onOutput(f) { output = f; f('Port 3002 opened for sessionId synthetic-only') }, onExit: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) }
  const deps = { discover: vi.fn().mockResolvedValue({ aws: 'aws.exe', env: {} }), portFree: vi.fn().mockResolvedValue(true), spawn: vi.fn().mockResolvedValue(transport), healthy: vi.fn().mockResolvedValue(true), monitorMs: 100000, log: vi.fn(), ...overrides }
  const manager = new ConnectionManager(connectionConfig(PRODUCTION), deps)
  return { manager, deps, transport, emit: (s: string) => output(s) }
}
const managers: ConnectionManager[] = []
const track = <T extends { manager: ConnectionManager }>(f: T) => { managers.push(f.manager); return f }
afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.stop().catch(() => undefined))) })

describe('Production connection manager', () => {
  it('starts nothing and sends no request until the owner confirms', async () => {
    const f = track(productionFixture())
    expect(f.manager.status()).toMatchObject({ mode: 'remote-production', state: 'awaiting-confirmation' })
    await expect(f.manager.start()).rejects.toThrow(/Confirm the Production connection/)
    await expect(f.manager.ensureReady()).rejects.toThrow(/Confirm the Production connection/)
    expect(await f.manager.retry()).toMatchObject({ state: 'awaiting-confirmation' })
    const fetcher = vi.fn()
    await expect(connectionFetcher(f.manager, fetcher)('http://localhost:3002/auth/login', { method: 'POST' })).rejects.toBeInstanceOf(AuthError)
    expect(fetcher).not.toHaveBeenCalled()
    expect(f.deps.discover).not.toHaveBeenCalled(); expect(f.deps.spawn).not.toHaveBeenCalled()
  })
  it('after confirmation tunnels only to remote port 3002 and reports Production', async () => {
    const f = track(productionFixture())
    expect((await f.manager.confirmProduction()).state).toBe('connecting')
    await f.manager.ensureReady()
    expect(f.deps.spawn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(f.deps.spawn).mock.calls[0][1]).toContain('portNumber=3002,localPortNumber=3002')
    expect(f.deps.healthy).toHaveBeenCalledWith('http://localhost:3002', expect.anything())
    expect(f.manager.status()).toMatchObject({ mode: 'remote-production', state: 'connected' })
    await f.manager.confirmProduction()
    expect(f.deps.spawn).toHaveBeenCalledTimes(1)
  })
  it('a failure stays a Production failure and retry reconnects to Production only', async () => {
    const transport: OwnedTunnel = { onOutput(f) { f('An error occurred (AccessDenied) when calling the StartSession operation') }, onExit: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) }
    const f = track(productionFixture({ spawn: vi.fn().mockResolvedValue(transport) }))
    await f.manager.confirmProduction()
    await vi.waitFor(() => expect(f.manager.status().state).toBe('failed'))
    expect(f.manager.status()).toMatchObject({ mode: 'remote-production', message: expect.stringMatching(/SSM access was denied/) })
    await f.manager.retry()
    expect(f.manager.status()).toMatchObject({ mode: 'remote-production', state: 'failed' })
    expect(f.deps.spawn).toHaveBeenCalledTimes(2)
    for (const call of vi.mocked(f.deps.spawn).mock.calls) expect(call[1]).toContain('portNumber=3002,localPortNumber=3002')
  })
  it('an unhealthy Production Backend fails closed instead of connecting', async () => {
    let now = 0
    const f = track(productionFixture({ healthy: vi.fn().mockResolvedValue(false), now: () => now, pause: async () => { now += 1000 }, startupMs: 2000 }))
    await f.manager.confirmProduction()
    await vi.waitFor(() => expect(f.manager.status().state).toBe('failed'))
    expect(f.manager.status().mode).toBe('remote-production')
    expect(f.transport.stop).toHaveBeenCalled()
  })
  it('confirmation is a no-op outside Production', async () => {
    const spawn = vi.fn()
    const manager = new ConnectionManager(connectionConfig({ COLORFUL_LIFE_BACKEND_URL: 'http://127.0.0.1:4567' }), { spawn, log: vi.fn() }); managers.push(manager)
    expect(await manager.confirmProduction()).toMatchObject({ mode: 'direct', state: 'connected' })
    expect(spawn).not.toHaveBeenCalled()
  })
})

describe('visible Production identification', () => {
  afterEach(() => { cleanup(); delete window.adminConnection; document.title = 'colorful-life-admin' })
  const production = (state: ConnectionStatus['state'], message = 'Secure Backend connection is ready.'): ConnectionStatus => ({ mode: 'remote-production', state, message })

  it('requires an explicit click before connecting, then keeps the PRODUCTION banner while connected', async () => {
    const ready = vi.fn()
    const status = vi.fn().mockResolvedValue(production('awaiting-confirmation', 'Confirm the Production connection to continue.'))
    const confirmProduction = vi.fn().mockResolvedValue(production('connecting'))
    window.adminConnection = { status, retry: vi.fn(), confirmProduction }
    render(<ConnectionPanel onReady={ready} />)
    expect(await screen.findByLabelText('Production environment')).toHaveTextContent('PRODUCTION')
    expect(confirmProduction).not.toHaveBeenCalled()
    expect(ready).not.toHaveBeenCalledWith(true)
    await waitFor(() => expect(document.title).toBe('PRODUCTION — Build & Bloom Admin'))
    status.mockResolvedValue(production('connected'))
    fireEvent.click(screen.getByRole('button', { name: 'Connect to Production' }))
    expect(confirmProduction).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(ready).toHaveBeenCalledWith(true))
    expect(screen.getByLabelText('Production environment')).toHaveTextContent('PRODUCTION')
    expect(screen.queryByRole('button', { name: 'Connect to Production' })).not.toBeInTheDocument()
  })
  it('keeps the banner with a failure and Retry, and keeps it if status becomes unavailable', async () => {
    const ready = vi.fn()
    const status = vi.fn().mockResolvedValue(production('failed', 'AWS SSM access was denied.'))
    window.adminConnection = { status, retry: vi.fn(), confirmProduction: vi.fn() }
    render(<ConnectionPanel onReady={ready} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection Failed. AWS SSM access was denied.')
    expect(screen.getByLabelText('Production environment')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry Connection' })).toBeInTheDocument()
    status.mockRejectedValue(new Error('ipc unavailable'))
    expect(await screen.findByText(/Connection status is unavailable/, {}, { timeout: 2500 })).toBeInTheDocument()
    expect(screen.getByLabelText('Production environment')).toBeInTheDocument()
    expect(ready).toHaveBeenLastCalledWith(false)
  })
  it('never shows the Production banner or title for Sandbox or direct connections', async () => {
    for (const mode of ['remote-sandbox', 'direct'] as const) {
      const ready = vi.fn()
      window.adminConnection = { status: vi.fn().mockResolvedValue({ mode, state: 'connected', message: 'Secure Backend connection is ready.' }), retry: vi.fn(), confirmProduction: vi.fn() }
      const { unmount } = render(<ConnectionPanel onReady={ready} />)
      await waitFor(() => expect(ready).toHaveBeenCalledWith(true))
      expect(screen.queryByLabelText('Production environment')).not.toBeInTheDocument()
      expect(document.title).toBe('colorful-life-admin')
      unmount()
    }
  })
  it('a status failure before any mode is known shows a neutral failure, not Sandbox or Production', async () => {
    window.adminConnection = { status: vi.fn().mockRejectedValue(new Error('ipc unavailable')), retry: vi.fn(), confirmProduction: vi.fn() }
    render(<ConnectionPanel onReady={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection status is unavailable')
    expect(screen.queryByLabelText('Production environment')).not.toBeInTheDocument()
  })
})

describe('refund gating for the Production connection', () => {
  it('Production permits LIVE, blocks a TEST misconfiguration, and Sandbox still blocks LIVE', () => {
    expect(parseConnectionMode({ mode: 'remote-production', state: 'connected', message: 'ok' })).toBe('remote-production')
    expect(parseConnectionMode({ mode: 'remote-production', state: 'awaiting-confirmation', message: 'ok' })).toBeNull()
    expect(stripeEnvironmentMismatch('LIVE', 'remote-production')).toBe(false)
    expect(stripeEnvironmentMismatch('TEST', 'remote-production')).toBe(true)
    expect(stripeEnvironmentMismatch('LIVE', 'remote-sandbox')).toBe(true)
    expect(stripeEnvironmentMismatch('LIVE', null)).toBe(true)
    expect(liveConnectionBlockMessage('remote-production')).toMatch(/Production is reporting a TEST Stripe environment/)
  })
})
