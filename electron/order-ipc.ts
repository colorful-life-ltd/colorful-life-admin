import type { AdminOrdersApi } from './order-contract.js'
import { validateDispatch, validateOrderId, validatePage, validateReason } from './order-service.js'

export type OrderIpcHandler = (_event: unknown, ...args: unknown[]) => unknown
export function registerOrderIpc(handle: (channel: string, handler: OrderIpcHandler) => void, service: AdminOrdersApi) {
  handle('admin-orders:list', (_event, page = 1, pageSize = 20) => service.list(validatePage(page, 10000), validatePage(pageSize, 50)))
  handle('admin-orders:financials', (_event, id) => service.financials(validateOrderId(id)))
  handle('admin-orders:get', (_event, id) => service.get(validateOrderId(id)))
  handle('admin-orders:preparing', (_event, id) => service.preparing(validateOrderId(id)))
  handle('admin-orders:dispatch', (_event, id, input) => service.dispatch(validateOrderId(id), validateDispatch(input)))
  handle('admin-orders:cancel', (_event, id, reason) => service.cancel(validateOrderId(id), validateReason(reason)))
}
