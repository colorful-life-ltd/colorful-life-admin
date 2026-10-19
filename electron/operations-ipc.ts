import type { AdminOperationsApi, Operation } from './operations-contract.js'
import { operationSpec, validateOperationInput } from './operations-service.js'
export function registerOperationsIpc(handle: (channel: string, handler: (_event: unknown, ...args: unknown[]) => unknown) => void, service: AdminOperationsApi) {
  for (const method of ['read','execute'] as const) handle(`admin-operations:${method}`, (_event, operation, input) => {
    operationSpec(operation)
    return service[method](operation as Operation, validateOperationInput(operation,input))
  })
  handle('admin-operations:pending', () => service.pending())
  handle('admin-operations:finish', () => service.finish())
}
