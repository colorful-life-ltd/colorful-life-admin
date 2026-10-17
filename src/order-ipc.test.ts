import { expect, it, vi } from 'vitest'
import { registerOrderIpc } from '../electron/order-ipc'
import type { OrderIpcHandler } from '../electron/order-ipc'
import { serializeIpcError } from '../electron/ipc-error-contract'
import { adminOrders } from './admin-api'
import type { AdminOrdersApi } from '../electron/order-contract'
it('validates every order IPC operation before forwarding to the authenticated service', async () => {
  const handlers = new Map<string, OrderIpcHandler>()
  const service = { list: vi.fn(), get: vi.fn(), preparing: vi.fn(), dispatch: vi.fn(), cancel: vi.fn() }
  registerOrderIpc((name, handler) => handlers.set(name, handler), service)
  expect(handlers.size).toBe(5)
  handlers.get('admin-orders:list')!({}, 2, 20)
  expect(service.list).toHaveBeenCalledWith(2, 20)
  handlers.get('admin-orders:get')!({}, 41); handlers.get('admin-orders:preparing')!({}, 41)
  expect(service.get).toHaveBeenCalledWith(41); expect(service.preparing).toHaveBeenCalledWith(41)
  handlers.get('admin-orders:dispatch')!({}, 41, { carrier: 'ROYAL_MAIL', trackingNumber: 'ab 123456789 gb', actualShippingCost: 0 })
  expect(service.dispatch).toHaveBeenCalledWith(41, { carrier: 'ROYAL_MAIL', trackingNumber: 'AB123456789GB', actualShippingCost: 0 })
  handlers.get('admin-orders:cancel')!({}, 41, 'OTHER')
  expect(service.cancel).toHaveBeenCalledWith(41, 'OTHER')
  for (const name of ['get', 'preparing', 'dispatch', 'cancel']) expect(() => handlers.get(`admin-orders:${name}`)!({}, '41')).toThrow()
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
