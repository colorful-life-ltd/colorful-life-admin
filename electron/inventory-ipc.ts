import type { AdminInventoryApi } from './inventory-contract.js'
import { inventoryId, inventoryPage, shipmentKey, validateShipment } from './inventory-service.js'
export function registerInventoryIpc(handle: (channel: string, handler: (_event: unknown, ...args: unknown[]) => unknown) => void, service: AdminInventoryApi) {
  handle('admin-inventory:list', (_event, page = 1) => service.list(inventoryPage(page)))
  handle('admin-inventory:movements', (_event, id) => service.movements(inventoryId(id)))
  handle('admin-inventory:get-outbound', (_event, id) => service.getOutbound(inventoryId(id)))
  handle('admin-inventory:pending', () => service.pending())
  handle('admin-inventory:prepare', (_event, input) => service.prepare(validateShipment(input)))
  handle('admin-inventory:submit', (_event, key) => service.submit(shipmentKey(key)))
  handle('admin-inventory:finish', (_event, key) => service.finish(shipmentKey(key)))
}
