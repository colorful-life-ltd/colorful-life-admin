import { isIpcErrorEnvelope, restoreIpcError } from '../electron/ipc-error-contract.js'

const isPromiseLike = (value: unknown): value is Promise<unknown> =>
  typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function'

function errorAwareBridge<Api extends object>(resolveApi: () => Api | undefined): Api {
  return new Proxy({} as Api, {
    get(_target, property) {
      const api = resolveApi()
      if (!api) return undefined
      const operation: unknown = Reflect.get(api, property, api)
      if (typeof operation !== 'function') return operation

      return (...args: unknown[]) => {
        const result: unknown = Reflect.apply(operation, api, args)
        if (isPromiseLike(result)) {
          return result.then((value) => {
            if (isIpcErrorEnvelope(value)) throw restoreIpcError(value)
            return value
          })
        }
        return result
      }
    },
  })
}

export const adminAuth = errorAwareBridge(() => window.adminAuth)
export const adminProducts = errorAwareBridge(() => window.adminProducts)
export const adminCategories = errorAwareBridge(() => window.adminCategories)
export const adminPurchases = errorAwareBridge(() => window.adminPurchases)

export const adminOrders = errorAwareBridge(() => window.adminOrders)

export const adminInventory = errorAwareBridge(() => window.adminInventory)

export const adminOperations = errorAwareBridge(() => window.adminOperations)

export const adminReturns=errorAwareBridge(()=>window.adminReturns)
