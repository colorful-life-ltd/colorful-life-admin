import type { BrowserWindowConstructorOptions } from 'electron'

// Matches the renderer's :root background so the hidden-then-shown window never flashes white.
export const MAIN_WINDOW_BACKGROUND = '#f4f1ea'

/**
 * Standard framed desktop window: native title bar and minimize/restore/close stay available,
 * and it is never kiosk or fullscreen. It is created hidden and shown once ready, so startup
 * has no default-size flash or visible jump to the maximized state.
 */
export function mainWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: MAIN_WINDOW_BACKGROUND,
  }
}

/** Windows starts maximized; other platforms open at the default size. */
export function startsMaximized(platform: NodeJS.Platform): boolean {
  return platform === 'win32'
}

export function showMainWindow(window: { maximize(): void; show(): void }, platform: NodeJS.Platform): void {
  if (startsMaximized(platform)) window.maximize()
  window.show()
}
