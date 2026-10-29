import { expect, it, vi } from 'vitest'
import { ReturnService } from '../electron/return-service'
import { registerReturnIpc } from '../electron/return-ipc'
import { returnCase, returnQueue } from './test-fixtures/returns'
it('uses authenticated main-process requests and validates response identity', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(returnCase)))
  const service = new ReturnService({ authenticatedFetch: fetch })
  expect((await service.get(41)).reference).toBe('BB-R-41')
  expect(fetch).toHaveBeenCalledWith('/admin/returns/41', {})
  fetch.mockResolvedValue(
    new Response(JSON.stringify({ ...returnCase, orderId: 42 })),
  )
  await expect(service.get(41)).rejects.toThrow('Invalid return data')
})
it('rejects invalid paths, actions and client-controlled operators before sending', async () => {
  const fetch = vi.fn(),
    service = new ReturnService({ authenticatedFetch: fetch })
  await expect(service.get(-1)).rejects.toThrow()
  await expect(
    service.action(41, 10, 'receive', {
      receivedAt: '2026-10-29T12:00:00Z',
      note: 'Test',
      receivedByUserId: 999,
    }),
  ).rejects.toThrow()
  await expect(
    service.action(41, 10, 'authorize', {
      shippingPayer: 'SELLER',
      postageInstructions: 'Test arrangement',
      instructions: 'Pack securely',
      rightsReviewed: false,
    }),
  ).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})
it('preserves queue filters and server errors without inventing empty success', async () => {
  const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(returnQueue))),
    service = new ReturnService({ authenticatedFetch: fetch })
  await service.list('REQUESTED', 1)
  expect(fetch).toHaveBeenCalledWith(
    '/admin/returns?page=1&status=REQUESTED',
    {},
  )
  fetch.mockResolvedValue(
    new Response(JSON.stringify({ error: 'RETURN_TRANSITION_REFUSED' }), {
      status: 409,
    }),
  )
  await expect(service.action(41, 10, 'complete', {})).rejects.toMatchObject({
    status: 409,
    backendCode: 'RETURN_TRANSITION_REFUSED',
  })
})
it('registers only the three return IPC operations with validated inputs', () => {
  const handlers = new Map<
      string,
      (_e: unknown, ...args: unknown[]) => unknown
    >(),
    service = { list: vi.fn(), get: vi.fn(), action: vi.fn() }
  registerReturnIpc((key, handler) => handlers.set(key, handler), service)
  expect([...handlers.keys()]).toEqual([
    'admin-returns:list',
    'admin-returns:get',
    'admin-returns:action',
  ])
  expect(() => handlers.get('admin-returns:get')!(null, '41')).toThrow()
  expect(() =>
    handlers.get('admin-returns:action')!(null, 41, 10, 'refund', {}),
  ).toThrow()
  handlers.get('admin-returns:get')!(null, 41)
  expect(service.get).toHaveBeenCalledWith(41)
})
