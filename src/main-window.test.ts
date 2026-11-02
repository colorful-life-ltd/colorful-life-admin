import { describe, expect, it, vi } from 'vitest'
import { MAIN_WINDOW_BACKGROUND, mainWindowOptions, showMainWindow, startsMaximized } from '../electron/main-window'

describe('main window startup', () => {
  it('is a standard framed, resizable window created hidden with the page background', () => {
    const options = mainWindowOptions()
    expect(options).toMatchObject({ show: false, backgroundColor: MAIN_WINDOW_BACKGROUND, minWidth: 960, minHeight: 640 })
    expect(options.width).toBeGreaterThanOrEqual(options.minWidth!)
    expect(options.height).toBeGreaterThanOrEqual(options.minHeight!)
    for (const key of ['kiosk', 'fullscreen', 'frame', 'titleBarStyle', 'resizable', 'minimizable', 'maximizable', 'closable'] as const) {
      expect(options).not.toHaveProperty(key)
    }
  })

  it('maximizes before the first show on Windows only', () => {
    expect(startsMaximized('win32')).toBe(true)
    expect(startsMaximized('linux')).toBe(false)
    expect(startsMaximized('darwin')).toBe(false)
    const calls: string[] = []
    const window = { maximize: vi.fn(() => calls.push('maximize')), show: vi.fn(() => calls.push('show')) }
    showMainWindow(window, 'win32')
    expect(calls).toEqual(['maximize', 'show'])
    calls.length = 0
    showMainWindow(window, 'linux')
    expect(calls).toEqual(['show'])
  })
})
