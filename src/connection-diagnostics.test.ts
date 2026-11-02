import { describe, expect, it, vi } from 'vitest'
import { connectionConfig, describeConnection } from '../electron/connection-config'
import { apiResponseLine, ConnectionManager, diagnosticFetcher } from '../electron/connection-manager'

describe('connection diagnostics', () => {
  it('names the effective mode, target and the setting that chose it', () => {
    expect(describeConnection(connectionConfig({}))).toBe('mode=remote-sandbox target=http://localhost:3000 -> SSM i-02b28336518077a8f:3001 (profile colorful-life-admin, eu-west-2) chosen by default (no override)')
    expect(describeConnection(connectionConfig({ COLORFUL_LIFE_BACKEND_URL: 'https://build-and-bloom.co.uk/api' }))).toBe('mode=direct target=https://build-and-bloom.co.uk/api chosen by COLORFUL_LIFE_BACKEND_URL')
    expect(describeConnection(connectionConfig({ COLORFUL_LIFE_CONNECTION_MODE: 'direct' }))).toContain('chosen by COLORFUL_LIFE_CONNECTION_MODE')
  })

  it('logs the configuration at startup and exposes it in status', () => {
    const log = vi.fn()
    const manager = new ConnectionManager(connectionConfig({ COLORFUL_LIFE_CONNECTION_MODE: 'direct' }), { log })
    expect(log).toHaveBeenCalledWith('[Admin connection] mode=direct target=https://build-and-bloom.co.uk/api chosen by COLORFUL_LIFE_CONNECTION_MODE')
    expect(manager.status().description).toContain('mode=direct')
  })

  it('logs one response line without query strings, headers, bodies or tokens', async () => {
    expect(apiResponseLine('get', 'http://localhost:3000/purchases/7/review/products?q=secret-search', 200, 'application/json; charset=utf-8'))
      .toBe('[Admin API] GET http://localhost:3000/purchases/7/review/products -> 200 application/json')
    const log = vi.fn()
    const response = new Response('<html>404</html>', { status: 404, headers: { 'content-type': 'text/html' } })
    const fetcher = diagnosticFetcher(vi.fn().mockResolvedValue(response), log)
    await expect(fetcher('https://build-and-bloom.co.uk/api/admin/categories?page=1', { method: 'GET', headers: { Authorization: 'Bearer token-must-not-leak' } })).resolves.toBe(response)
    expect(log).toHaveBeenCalledWith('[Admin API] GET https://build-and-bloom.co.uk/api/admin/categories -> 404 text/html')
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/token-must-not-leak|Bearer|page=1/)
    const failing = diagnosticFetcher(vi.fn().mockRejectedValue(new TypeError('fetch failed')), log)
    await expect(failing('http://localhost:3000/admin/categories', { method: 'GET' })).rejects.toThrow('fetch failed')
    expect(log).toHaveBeenLastCalledWith('[Admin API] GET http://localhost:3000/admin/categories -> request failed (TypeError)')
  })
})
