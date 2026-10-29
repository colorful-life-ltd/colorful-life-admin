import type { AdminReturnsApi } from './return-service.js'
import { validateReturnAction } from './return-service.js'
import { validateOrderId, validatePage } from './order-service.js'
import { returnStatuses, type ReturnStatus } from './return-contract.js'
import type { OrderIpcHandler } from './order-ipc.js'
export function registerReturnIpc(
  handle: (channel: string, handler: OrderIpcHandler) => void,
  service: AdminReturnsApi,
) {
  handle('admin-returns:list', (_e, status, page = 1) => {
    if (
      status !== undefined &&
      !returnStatuses.includes(status as ReturnStatus)
    )
      throw Error('Invalid return filter')
    return service.list(
      status as ReturnStatus | undefined,
      validatePage(page, 100000),
    )
  })
  handle('admin-returns:get', (_e, id) => service.get(validateOrderId(id)))
  handle('admin-returns:action', (_e, id, lineId, action, body) => {
    const input = validateReturnAction(action, body)
    return service.action(
      validateOrderId(id),
      validateOrderId(lineId),
      input.action,
      input.body,
    )
  })
}
