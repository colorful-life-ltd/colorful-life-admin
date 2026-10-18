import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { secureIpcHandler } from '../electron/renderer-security'
import { expect, it, vi } from 'vitest'
import { registerOrderIpc } from '../electron/order-ipc'
import type { OrderIpcHandler } from '../electron/order-ipc'
import { serializeIpcError } from '../electron/ipc-error-contract'
import { adminOrders } from './admin-api'
import type { AdminOrdersApi } from '../electron/order-contract'
it('validates every order IPC operation before forwarding to the authenticated service', async () => {
  const handlers = new Map<string, OrderIpcHandler>()
  const service = { financials: vi.fn(), list: vi.fn(), get: vi.fn(), preparing: vi.fn(), dispatch: vi.fn(), cancel: vi.fn() }
  registerOrderIpc((name, handler) => handlers.set(name, handler), service)
  expect(handlers.size).toBe(6)
  handlers.get('admin-orders:list')!({}, 2, 20)
  expect(service.list).toHaveBeenCalledWith(2, 20)
  handlers.get('admin-orders:get')!({}, 41); handlers.get('admin-orders:preparing')!({}, 41)
  handlers.get('admin-orders:financials')!({}, 41)
  expect(service.financials).toHaveBeenCalledWith(41)
  expect(service.get).toHaveBeenCalledWith(41); expect(service.preparing).toHaveBeenCalledWith(41)
  handlers.get('admin-orders:dispatch')!({}, 41, { carrier: 'ROYAL_MAIL', trackingNumber: 'ab 123456789 gb', actualShippingCost: 0 })
  expect(service.dispatch).toHaveBeenCalledWith(41, { carrier: 'ROYAL_MAIL', trackingNumber: 'AB123456789GB', actualShippingCost: 0 })
  handlers.get('admin-orders:cancel')!({}, 41, 'OTHER')
  expect(service.cancel).toHaveBeenCalledWith(41, 'OTHER')
  for (const name of ['financials', 'get', 'preparing', 'dispatch', 'cancel']) expect(() => handlers.get(`admin-orders:${name}`)!({}, '41')).toThrow()
  expect(() => handlers.get('admin-orders:list')!({}, 1, 100)).toThrow()
  expect(() => handlers.get('admin-orders:dispatch')!({}, 41, { carrier: 'OTHER' })).toThrow()
  expect(() => handlers.get('admin-orders:cancel')!({}, 41, 'CHANGED_MIND')).toThrow()
})
it('restores order conflicts across the preload/renderer error boundary', async () => {
  const original = window.adminOrders
  window.adminOrders = { dispatch: vi.fn().mockResolvedValue(serializeIpcError(Object.assign(new Error('Payment not eligible'), { status: 409, backendCode: 'ORDER_PAYMENT_NOT_VERIFIED', code: 'api' }))) } as unknown as AdminOrdersApi
  try { await expect(adminOrders.dispatch(41, { carrier: 'ROYAL_MAIL', trackingNumber: 'AB123456789GB', actualShippingCost: 0 })).rejects.toMatchObject({ status: 409, backendCode: 'ORDER_PAYMENT_NOT_VERIFIED' }) }
  finally { window.adminOrders = original }
})

it('rejects spoofed senders and child frames before the financial read handler', async () => {
  const frame = { url: 'file:///app/index.html' }
  const contents = { mainFrame: frame, getURL: () => frame.url, isDestroyed: () => false }
  const window = { webContents: contents, isDestroyed: () => false } as unknown as BrowserWindow
  const financials = vi.fn().mockResolvedValue({ ready: true })
  const handlers = new Map<string, ReturnType<typeof secureIpcHandler>>()
  registerOrderIpc((name, handler) => handlers.set(name, secureIpcHandler(() => window, frame.url, handler)), { list: vi.fn(), get: vi.fn(), preparing: vi.fn(), dispatch: vi.fn(), cancel: vi.fn(), financials })
  const handler = handlers.get('admin-orders:financials')!
  for (const event of [
    { sender: contents, senderFrame: null },
    { sender: contents, senderFrame: { url: frame.url } },
    { sender: { ...contents }, senderFrame: frame },
  ]) {
    expect(await handler(event as unknown as IpcMainInvokeEvent, 41)).toMatchObject({ __colorfulLifeAdminIpcError: { backendCode: 'FORBIDDEN', status: 403 } })
  }
  expect(financials).not.toHaveBeenCalled()
  await handler({ sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent, 41)
  expect(financials).toHaveBeenCalledExactlyOnceWith(41)
})
