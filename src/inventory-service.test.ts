import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InventoryService, validateShipment } from '../electron/inventory-service'
import { FileShipmentStore } from '../electron/inventory-store'
import { registerInventoryIpc } from '../electron/inventory-ipc'
import type { ShipmentRequest } from '../electron/inventory-contract'

const timestamp = '2026-10-18T12:00:00Z'
const input = { productListingId: 4, quantity: 2, shipmentReference: 'FBA-1', note: 'Home stock shipment' }
const dirs: string[] = []
afterEach(() => { dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })) })
function audit(request: ShipmentRequest, replayed = false) {
  return { replayed, outbound: { ...request, id: 9, performedByUserId: 1, createdAt: timestamp, movement: { id: 8, listingId: request.productListingId, quantityChange: -request.quantity, type: 'FBA_OUTBOUND', note: request.note, performedByUserId: 1, createdAt: timestamp } }, inventory: { productListingId: request.productListingId, currentStock: 8, reservedStock: 3, availableStock: 5 } }
}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'admin-inventory-test-')); dirs.push(directory)
  const restore = vi.fn().mockResolvedValue({ user: { id: 1, role: 'ADMIN' } })
  const authenticatedFetch = vi.fn().mockImplementation(async (_url, init) => new Response(JSON.stringify(audit(JSON.parse(init.body))), { status: 201 }))
  const store = new FileShipmentStore(directory)
  return { directory, restore, authenticatedFetch, store, service: new InventoryService({ restore, authenticatedFetch }, store, 'https://backend.test') }
}
async function prepare(f: ReturnType<typeof fixture>) { return f.service.prepare(input) }

describe('inventory service and persistent retry journal', () => {
  it('deducts through the narrow authenticated API, parses audit data and requires explicit completion', async () => {
    const f = fixture(); const saved = await prepare(f)
    expect(saved.request.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/)
    const result = await f.service.submit(saved.request.idempotencyKey)
    expect(result.state).toBe('confirmed'); expect(result.result?.inventory.reservedStock).toBe(3)
    expect(f.authenticatedFetch.mock.calls[0][0]).toBe('/inventory/fba-outbounds')
    expect(JSON.parse(f.authenticatedFetch.mock.calls[0][1].body)).toEqual(saved.request)
    await f.service.submit(saved.request.idempotencyKey)
    expect(f.authenticatedFetch).toHaveBeenCalledTimes(1)
    expect(await f.service.pending()).toEqual(result)
    await f.service.finish(saved.request.idempotencyKey); expect(await f.service.pending()).toBeNull()
    expect((await prepare(f)).request.idempotencyKey).not.toBe(saved.request.idempotencyKey)
  })
  it('retains key and immutable payload after a lost response and process/service restart, then accepts HTTP 200 replay', async () => {
    const f = fixture(); const saved = await prepare(f)
    f.authenticatedFetch.mockRejectedValueOnce(new TypeError('response lost'))
    await expect(f.service.submit(saved.request.idempotencyKey)).rejects.toMatchObject({ code: 'uncertain' })
    const restarted = new InventoryService({ restore: f.restore, authenticatedFetch: f.authenticatedFetch }, new FileShipmentStore(f.directory), 'https://backend.test')
    expect(await restarted.pending()).toMatchObject({ request: saved.request, state: 'uncertain' })
    await expect(restarted.finish(saved.request.idempotencyKey)).rejects.toMatchObject({ code: 'conflict' })
    await expect(restarted.prepare({ ...input, quantity: 3 })).rejects.toMatchObject({ code: 'conflict' })
    f.authenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify(audit(saved.request, true)), { status: 200 }))
    expect(await restarted.submit(saved.request.idempotencyKey)).toMatchObject({ state: 'confirmed', result: { replayed: true } })
    expect(f.authenticatedFetch.mock.calls.map(c => JSON.parse(c[1].body))).toEqual([saved.request, saved.request])
    const disk = readFileSync(join(f.directory, readdirSync(f.directory)[0]), 'utf8')
    expect(disk).not.toMatch(/Authorization|Bearer|password|accessToken|refreshToken/)
  })
  it.each([400, 401, 403, 404, 409, 500])('handles HTTP %s and preserves the saved payload', async status => {
    const f = fixture(); const saved = await prepare(f)
    f.authenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: status === 409 ? 'INSUFFICIENT_AVAILABLE_STOCK' : 'ERROR', message: 'Rejected' } }), { status }))
    await expect(f.service.submit(saved.request.idempotencyKey)).rejects.toMatchObject({ status, code: 'api' })
    expect((await f.service.pending())?.request).toEqual(saved.request)
  })
  it('does not discard an uncertain shipment even if a later retry is rejected', async () => {
    const f = fixture(); const saved = await prepare(f)
    f.authenticatedFetch.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'INSUFFICIENT_AVAILABLE_STOCK', message: 'No stock' } }), { status: 409 }))
    await expect(f.service.submit(saved.request.idempotencyKey)).rejects.toThrow()
    await expect(f.service.submit(saved.request.idempotencyKey)).rejects.toThrow('Not enough available')
    expect((await f.service.pending())?.state).toBe('uncertain')
    await expect(f.service.finish(saved.request.idempotencyKey)).rejects.toThrow('cannot be discarded')
  })
  it('treats idempotency conflicts as unresolved rather than allowing a fresh key', async () => {
    const f = fixture(); const saved = await prepare(f)
    f.authenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Conflict' } }), { status: 409 }))
    await expect(f.service.submit(saved.request.idempotencyKey)).rejects.toThrow('Do not create a new key')
    expect((await f.service.pending())?.state).toBe('uncertain')
  })
  it('prevents concurrent preparations and duplicate submits', async () => {
    const f = fixture()
    const preparing = prepare(f)
    await expect(prepare(f)).rejects.toMatchObject({ code: 'busy' })
    const saved = await preparing
    let resolve!: (v: Response) => void
    f.authenticatedFetch.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const submitting = f.service.submit(saved.request.idempotencyKey)
    await vi.waitFor(() => expect(f.authenticatedFetch).toHaveBeenCalledTimes(1))
    await expect(f.service.submit(saved.request.idempotencyKey)).rejects.toMatchObject({ code: 'busy' })
    resolve(new Response(JSON.stringify(audit(saved.request)), { status: 201 })); await submitting
  })
  it('scopes journal by Backend and authenticated actor', async () => {
    const f = fixture(); await prepare(f)
    f.restore.mockResolvedValue({ user: { id: 2, role: 'ADMIN' } })
    expect(await f.service.pending()).toBeNull()
    f.restore.mockResolvedValue({ user: { id: 1, role: 'ADMIN' } })
    const other = new InventoryService({ restore: f.restore, authenticatedFetch: f.authenticatedFetch }, f.store, 'https://other.test')
    expect(await other.pending()).toBeNull()
    f.restore.mockResolvedValue(null); await expect(f.service.pending()).rejects.toMatchObject({ status: 401 })
  })
  it('fails closed on unreadable or unwritable journals before sending', async () => {
    const f = fixture(); await prepare(f)
    writeFileSync(join(f.directory, readdirSync(f.directory)[0]), 'invalid json')
    await expect(f.service.prepare(input)).rejects.toMatchObject({ code: 'journal' })
    expect(f.authenticatedFetch).not.toHaveBeenCalled()
    const failing = new InventoryService({ restore: f.restore, authenticatedFetch: f.authenticatedFetch }, { read: () => null, write: () => { throw new Error('disk full') } }, 'test')
    await expect(failing.prepare(input)).rejects.toMatchObject({ code: 'journal' })
    expect(f.authenticatedFetch).not.toHaveBeenCalled()
  })
  it.each(['wrong-key', 'wrong-listing', 'bad-json', 'bad-status'])('keeps malformed successful response %s unresolved', async variant => {
    const f = fixture(); const saved = await prepare(f); const result = audit(saved.request)
    if (variant === 'wrong-key') result.outbound.idempotencyKey = 'different'
    if (variant === 'wrong-listing') result.inventory.productListingId = 99
    f.authenticatedFetch.mockResolvedValueOnce(new Response(variant === 'bad-json' ? '?' : JSON.stringify(result), { status: variant === 'bad-status' ? 200 : 201 }))
    await expect(f.service.submit(saved.request.idempotencyKey)).rejects.toThrow()
    expect((await f.service.pending())?.state).toBe('uncertain')
  })
  it('derives reserved stock from the actual listing contract and checks inconsistent quantities', async () => {
    const f = fixture(); const payload = { items: [{ id: 4, condition: 'NEW', active: true, currentStock: 10, availableStock: 6, legoProduct: { id: 2, setNumber: '123', title: 'Car' } }], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } }
    f.authenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify(payload)))
    expect((await f.service.list()).items[0]).toMatchObject({ currentStock: 10, reservedStock: 4, availableStock: 6 })
    expect(f.authenticatedFetch.mock.calls[0][0]).toBe('/admin/product-listings?page=1&pageSize=20')
    payload.items[0].availableStock = 11
    f.authenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify(payload)))
    await expect(f.service.list()).rejects.toMatchObject({ code: 'malformed-response' })
  })
  it('validates movement identities and retrieves outbound audit records', async () => {
    const f = fixture(); const saved = await prepare(f), result = audit(saved.request)
    f.authenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify({ listingId: 4, movements: [{ ...result.outbound.movement, fbaOutbound: { id: 9, shipmentReference: 'FBA-1', idempotencyKey: saved.request.idempotencyKey } }] })))
    expect((await f.service.movements(4))[0].fbaOutbound?.shipmentReference).toBe('FBA-1')
    f.authenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify(result)))
    expect((await f.service.getOutbound(9)).outbound.id).toBe(9)
    f.authenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify({ listingId: 4, movements: [{ ...result.outbound.movement, listingId: 7 }] })))
    await expect(f.service.movements(4)).rejects.toThrow()
  })
})
it.each([0, -1, 1.5, NaN, Infinity, '2'])('rejects invalid quantity %s and extra key/actor fields', quantity => {
  expect(() => validateShipment({ ...input, quantity })).toThrow()
  expect(() => validateShipment({ ...input, idempotencyKey: 'renderer-key' })).toThrow()
  expect(() => validateShipment({ ...input, performedByUserId: 99 })).toThrow()
})
it('validates all inventory IPC arguments before privileged service calls', () => {
  const handlers = new Map<string, (_event: unknown, ...args: unknown[]) => unknown>()
  const service = { list: vi.fn(), movements: vi.fn(), getOutbound: vi.fn(), pending: vi.fn(), prepare: vi.fn(), submit: vi.fn(), finish: vi.fn() }
  registerInventoryIpc((name, handler) => handlers.set(name, handler), service)
  for (const [name, value] of [['list', 10001], ['movements', '../'], ['get-outbound', -1], ['prepare', { ...input, quantity: 0 }], ['submit', { key: 'bad' }], ['finish', 'space key']] as const) expect(() => handlers.get('admin-inventory:' + name)!(null, value)).toThrow()
  Object.values(service).forEach(fn => expect(fn).not.toHaveBeenCalled())
  handlers.get('admin-inventory:prepare')!(null, input); expect(service.prepare).toHaveBeenCalledWith(input)
})
it('permits explicit replacement only after a definitively rejected first request', async () => {
  const f = fixture(); const saved = await prepare(f)
  f.authenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'INSUFFICIENT_AVAILABLE_STOCK', message: 'No stock' } }), { status: 409 }))
  await expect(f.service.submit(saved.request.idempotencyKey)).rejects.toThrow()
  expect((await f.service.pending())?.state).toBe('rejected')
  await f.service.finish(saved.request.idempotencyKey)
  expect((await prepare(f)).request.idempotencyKey).not.toBe(saved.request.idempotencyKey)
  expect(f.authenticatedFetch).toHaveBeenCalledTimes(1)
})
it('retains uncertainty when a successful response cannot be persisted', async () => {
  const f = fixture(); const saved = await prepare(f)
  const service = new InventoryService({ restore: f.restore, authenticatedFetch: f.authenticatedFetch }, {
    read: scope => f.store.read(scope),
    write: (scope, value) => { if (value?.state === 'confirmed') throw new Error('disk full'); f.store.write(scope, value) },
  }, 'https://backend.test')
  await expect(service.submit(saved.request.idempotencyKey)).rejects.toMatchObject({ code: 'journal' })
  expect((await service.pending())?.state).toBe('uncertain')
  await expect(service.finish(saved.request.idempotencyKey)).rejects.toThrow('cannot be discarded')
  expect(f.authenticatedFetch).toHaveBeenCalledTimes(1)
})
it('blocks a second process writer before changing the journal or sending a shipment', async () => {
  const f = fixture(); const saved = await prepare(f)
  const blockedStore = new FileShipmentStore(f.directory, () => false)
  const second = new InventoryService({ restore: f.restore, authenticatedFetch: f.authenticatedFetch }, blockedStore, 'https://backend.test')
  expect((await second.pending())?.request).toEqual(saved.request)
  await expect(second.submit(saved.request.idempotencyKey)).rejects.toMatchObject({ code: 'busy' })
  expect((await f.service.pending())?.state).toBe('prepared')
  expect(f.authenticatedFetch).not.toHaveBeenCalled()
})
