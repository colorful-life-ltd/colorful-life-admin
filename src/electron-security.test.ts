import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { validateBackendUrl } from '../electron/backend-url'
import { assertTrustedSender, guardRendererNavigation, isTrustedRenderer, secureIpcHandler, trustedRendererUrl } from '../electron/renderer-security'
import { rendererCsp } from '../electron/content-security-policy'

describe('Backend URL policy', () => {
  it.each(['https://api.example.com', 'https://api.example.com:8443/api', 'https://127.0.0.1:3443', 'http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000'])('accepts %s', value => {
    expect(validateBackendUrl(value)).toBe(value)
  })
  it('normalizes a trailing slash while retaining HTTPS explicit ports and base paths', () => {
    expect(validateBackendUrl('https://api.example.com:8443/api/')).toBe('https://api.example.com:8443/api')
  })
  it.each(['', 'not a url', '//api.example.com', 'https:api.example.com', 'https:///api.example.com', 'ftp://api.example.com', 'file:///tmp/api', 'javascript:alert(1)', 'http://api.example.com', 'http://localhost.evil.test', 'http://127.0.0.2', 'http://127.1', 'http://2130706433', 'http://0177.0.0.1', 'http://[::ffff:127.0.0.1]', 'http://localhost.', 'https://user:secret@api.example.com', 'https://@api.example.com', 'https://api.example.com?secret=x', 'https://api.example.com#fragment', 'https://api.example.com?', 'https://api.example.com:', 'https://api.example.com:0', 'https://api.example.com:65536', ' https://api.example.com', 'https://api.example.com\n', 'https://api.example.com\\evil'])('rejects unsafe %s without leaking configuration', value => {
    expect(() => validateBackendUrl(value)).toThrow('Invalid COLORFUL_LIFE_BACKEND_URL')
    try { validateBackendUrl(value) } catch (error) { expect(String(error)).not.toContain('secret') }
  })
})

const trusted = 'file:///app/dist/index.html'
describe('renderer document trust', () => {
  it('allows the packaged entry, reloads and fragment navigation', () => {
    expect(trustedRendererUrl('/app/dist/index.html', undefined, true)).toBe(trusted)
    expect(trustedRendererUrl('/app/dist/index.html', trusted, false)).toBe(trusted)
    expect(isTrustedRenderer(trusted, trusted)).toBe(true)
    expect(isTrustedRenderer(`${trusted}#orders`, trusted)).toBe(true)
    expect(isTrustedRenderer('http://127.0.0.1:5173/#orders', 'http://127.0.0.1:5173/')).toBe(true)
  })
  it.each(['http://127.0.0.1:5173', 'http://localhost:5173', 'http://[::1]:5173', 'https://localhost:5173/'])('allows explicit local development %s', url => {
    expect(trustedRendererUrl('/app/dist/index.html', url, false)).toBe(new URL(url).href)
    expect(() => trustedRendererUrl('/app/dist/index.html', url, true)).toThrow()
  })
  it.each(['https://evil.test', 'http://127.0.0.1.evil.test', 'http://user@localhost:5173', 'file:///tmp/evil.html', 'http://localhost:5173/evil', 'http://localhost:5173/?x=1'])('rejects unsafe renderer configuration %s', url => {
    expect(() => trustedRendererUrl('/app/dist/index.html', url, false)).toThrow()
  })
  it.each(['https://evil.test', 'file:///app/dist/evil.html', `${trusted}?evil=1`, 'data:text/html,evil', 'javascript:alert(1)', 'blob:file:///evil', 'not a url'])('does not trust %s', url => {
    expect(isTrustedRenderer(url, trusted)).toBe(false)
  })
  it('guards navigation, dropped file/URL destinations, redirects, subframes and webviews', () => {
    const handlers = new Map<string, (event: { url: string; isMainFrame: boolean; preventDefault: () => void }) => void>()
    const window = { webContents: { on: (name: string, fn: typeof handlers extends Map<string, infer Handler> ? Handler : never) => handlers.set(name, fn) } } as unknown as BrowserWindow
    guardRendererNavigation(window, trusted)
    for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
      for (const url of ['https://evil.test', 'file:///tmp/dropped.html', 'data:text/html,evil']) {
        const event = { url, isMainFrame: true, preventDefault: vi.fn() }
        handlers.get(name)!(event); expect(event.preventDefault).toHaveBeenCalledOnce()
      }
      const allowed = { url: `${trusted}#orders`, isMainFrame: true, preventDefault: vi.fn() }
      handlers.get(name)!(allowed); expect(allowed.preventDefault).not.toHaveBeenCalled()
    }
    const child = { url: trusted, isMainFrame: false, preventDefault: vi.fn() }
    handlers.get('will-frame-navigate')!(child); expect(child.preventDefault).toHaveBeenCalledOnce()
    handlers.get('will-attach-webview')!(child); expect(child.preventDefault).toHaveBeenCalledTimes(2)
  })
})

describe('privileged IPC identity', () => {
  const fixture = () => {
    const frame = { url: trusted }
    const contents = { mainFrame: frame, getURL: () => trusted, isDestroyed: () => false }
    const window = { webContents: contents, isDestroyed: () => false } as unknown as BrowserWindow
    const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent
    return { window, event }
  }
  it('allows the current trusted main frame and preserves arguments/results', async () => {
    const { window, event } = fixture()
    const handler = vi.fn((_event, value: string) => value)
    await expect(secureIpcHandler(() => window, trusted, handler)(event, 'ok')).resolves.toBe('ok')
    expect(handler).toHaveBeenCalledWith(event, 'ok')
  })
  it.each(['missing-window', 'closed-window', 'other-window', 'child-frame', 'missing-frame', 'untrusted-frame-url', 'untrusted-document', 'destroyed-sender'])('forbids %s before executing any handler', async attack => {
    const { window, event } = fixture()
    if (attack === 'closed-window') window.isDestroyed = () => true
    if (attack === 'other-window') Object.assign(event, { sender: { ...event.sender } })
    if (attack === 'child-frame') Object.assign(event, { senderFrame: { url: trusted } })
    if (attack === 'missing-frame') Object.assign(event, { senderFrame: null })
    if (attack === 'untrusted-frame-url') Object.assign(event.senderFrame!, { url: 'https://evil.test' })
    if (attack === 'untrusted-document') event.sender.getURL = () => 'https://evil.test'
    if (attack === 'destroyed-sender') event.sender.isDestroyed = () => true
    const handler = vi.fn()
    const result = await secureIpcHandler(() => attack === 'missing-window' ? null : window, trusted, handler)(event)
    expect(result).toMatchObject({ __colorfulLifeAdminIpcError: { code: 'forbidden', backendCode: 'FORBIDDEN', status: 403 } })
    expect(handler).not.toHaveBeenCalled()
    expect(() => assertTrustedSender(event, attack === 'missing-window' ? null : window, trusted)).toThrow()
  })
})

describe('renderer CSP', () => {
  it('limits packaged scripts and connections while allowing Cloudinary and previews', () => {
    const csp = rendererCsp()
    expect(csp).toContain("script-src 'self';")
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain('img-src \'self\' https://res.cloudinary.com blob: data:')
    for (const unsafe of ['unsafe-inline', 'unsafe-eval', 'https://*', 'http:']) expect(csp).not.toContain(unsafe)
    for (const rule of ["frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) expect(csp).toContain(rule)
  })
  it('allows only the development origin, HMR and explicitly hashed preamble scripts', () => {
    const csp = rendererCsp('http://127.0.0.1:5173', ['preamble-hash'])
    expect(csp).toContain("script-src 'self' 'sha256-preamble-hash'")
    expect(csp).toContain('connect-src http://127.0.0.1:5173 ws://127.0.0.1:5173')
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(csp).not.toContain('unsafe-eval')
  })
})
