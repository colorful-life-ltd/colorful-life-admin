import type { AdminOperationsApi, InvestigationDecision, Operation } from './operations-contract.js'
import { operationSpec, validateOperationInput } from './operations-service.js'
export function registerOperationsIpc(handle: (channel: string, handler: (_event: unknown, ...args: unknown[]) => unknown) => void, service: AdminOperationsApi) {
  for (const method of ['read','execute','finish'] as const) handle(`admin-operations:${method}`, (_event, operation, input) => {
    operationSpec(operation)
    return service[method](operation as Operation, validateOperationInput(operation,input))
  })
  handle('admin-operations:resolve', (_event, operation, input, decision, note) => {
    operationSpec(operation)
    // The service revalidates decision and note before any I/O.
    return service.resolve(operation as Operation, validateOperationInput(operation,input), decision as InvestigationDecision, note as string)
  })
  handle('admin-operations:pending', () => service.pending())
}
