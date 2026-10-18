import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'node:url'
import { serializeIpcError } from './ipc-error-contract.js'

export function trustedRendererUrl(indexPath: string, override: string | undefined, packaged: boolean): string {
  const local = pathToFileURL(indexPath).href
  if (override === undefined) return local
  if (packaged) throw new Error('ELECTRON_RENDERER_URL is unavailable in packaged applications.')
  // Local compiled-renderer runtime checks may name the exact application entry file.
  if (override === local) return local
  let url: URL
  try { url = new URL(override) } catch { throw new Error('Invalid ELECTRON_RENDERER_URL.') }
  if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/i.test(override) || url.username || url.password) {
    throw new Error('ELECTRON_RENDERER_URL must be a loopback development server origin.')
  }
  return url.href
}

/** Current UI uses component state; only fragment changes are legitimate document navigation. */
export function isTrustedRenderer(value: string, trusted: string): boolean {
  try {
    const url = new URL(value)
    url.hash = ''
    return url.href === trusted
  } catch { return false }
}

export function assertTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow | null, trusted: string): void {
  if (!window || window.isDestroyed() || event.sender !== window.webContents || event.sender.isDestroyed() ||
    !event.senderFrame || event.senderFrame !== window.webContents.mainFrame ||
    !isTrustedRenderer(event.senderFrame.url, trusted) || !isTrustedRenderer(event.sender.getURL(), trusted)) {
    throw Object.assign(new Error('This request is not allowed from this window or frame.'), { code: 'forbidden', backendCode: 'FORBIDDEN', status: 403 })
  }
}

export function secureIpcHandler<Arguments extends unknown[], Result>(
  getWindow: () => BrowserWindow | null,
  trusted: string,
  handler: (event: IpcMainInvokeEvent, ...args: Arguments) => Result | Promise<Result>,
) {
  return async (event: IpcMainInvokeEvent, ...args: Arguments) => {
    try {
      assertTrustedSender(event, getWindow(), trusted)
      return await handler(event, ...args)
    } catch (error) { return serializeIpcError(error) }
  }
}

export function guardRendererNavigation(window: BrowserWindow, trusted: string): void {
  window.webContents.on('will-navigate', event => {
    if (!isTrustedRenderer(event.url, trusted)) event.preventDefault()
  })
  window.webContents.on('will-frame-navigate', event => {
    if (!event.isMainFrame || !isTrustedRenderer(event.url, trusted)) event.preventDefault()
  })
  window.webContents.on('will-redirect', event => {
    if (!event.isMainFrame || !isTrustedRenderer(event.url, trusted)) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', event => event.preventDefault())
}
