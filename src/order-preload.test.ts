import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import type { AdminOrdersApi } from '../electron/order-contract'
it('executes the preload and forwards only typed order operations across IPC', async () => {
  const invoke = vi.fn().mockResolvedValue({ ok: true })
  const exposeInMainWorld = vi.fn()
  const source = readFileSync('electron/preload.cts', 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText
  runInNewContext(compiled, { exports: {}, require: (name: string) => {
    if (name !== 'electron') throw new Error('Unexpected preload dependency')
    return { contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke } }
  } })
  const api = exposeInMainWorld.mock.calls.find(c => c[0] === 'adminOrders')![1] as AdminOrdersApi
  expect(Object.keys(api)).toEqual(['list', 'get', 'preparing', 'dispatch', 'cancel'])
  await api.list(2, 20); await api.get(41); await api.preparing(41)
  const input = { carrier: 'ROYAL_MAIL' as const, trackingNumber: 'AB123456789GB', actualShippingCost: 3 }
  await api.dispatch(41, input); await api.cancel(41, 'OTHER')
  expect(invoke.mock.calls).toEqual([['admin-orders:list', 2, 20], ['admin-orders:get', 41], ['admin-orders:preparing', 41], ['admin-orders:dispatch', 41, input], ['admin-orders:cancel', 41, 'OTHER']])
})
