import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { FileShipmentStore } from '../electron/inventory-store'
import type { PendingShipment } from '../electron/inventory-contract'
const roots: string[] = []
afterEach(() => roots.splice(0).forEach(p => fs.rmSync(p, { recursive: true, force: true })))
const value: PendingShipment = { state: 'uncertain', request: { productListingId: 1, quantity: 1, shipmentReference: 'FBA', note: 'Test', idempotencyKey: 'saved-key' } }
function root() { const p = fs.mkdtempSync(join(tmpdir(), 'inventory-durability-')); roots.push(p); return p }
it('flushes a same-directory exclusive temporary file before rename and directory flush, including tombstone deletion', () => {
  const directory = root(), events: string[] = []
  const io = { ...fs, writeFileSync: ((...args: Parameters<typeof fs.writeFileSync>) => { events.push('write'); fs.writeFileSync(...args) }) as typeof fs.writeFileSync,
    fsyncSync: (fd: number) => { events.push(fs.fstatSync(fd).isDirectory() ? 'directory flush' : 'file flush'); fs.fsyncSync(fd) },
    renameSync: (a: fs.PathLike, b: fs.PathLike) => { expect(String(a)).toMatch(/\.tmp$/); expect(String(a).startsWith(directory)).toBe(true); events.push('rename'); fs.renameSync(a, b) } }
  const store = new FileShipmentStore(directory, () => true, { io, platform: 'linux' })
  store.write('scope', value); expect(events).toEqual(['write', 'file flush', 'rename', 'directory flush']); expect(store.read('scope')).toEqual(value)
  events.length = 0; store.write('scope', null); expect(events).toEqual(['write', 'file flush', 'rename', 'directory flush']); expect(store.read('scope')).toBeNull()
  expect(fs.readdirSync(directory)).toHaveLength(1)
})
it.each(['file flush', 'rename', 'directory flush'])('propagates %s failure and preserves a readable state or evidence', phase => {
  const directory = root(); const original = new FileShipmentStore(directory); original.write('scope', value)
  const io = { ...fs, fsyncSync: (fd: number) => { if ((fs.fstatSync(fd).isDirectory() ? 'directory flush' : 'file flush') === phase) throw Object.assign(new Error('I/O failure'), { code: 'EIO' }); fs.fsyncSync(fd) },
    renameSync: (a: fs.PathLike, b: fs.PathLike) => { if (phase === 'rename') throw new Error('rename failure'); fs.renameSync(a, b) } }
  const store = new FileShipmentStore(directory, () => true, { io })
  expect(() => store.write('scope', { ...value, state: 'confirmed' })).toThrow()
  // No fallback to an absent journal or automatic deletion after failures.
  expect(original.read('scope')).not.toBeNull(); expect(fs.readdirSync(directory).length).toBeGreaterThanOrEqual(1)
})
it('tolerates Windows directory-handle limitations while still flushing files, and rejects real I/O failures', () => {
  const directory = root(); let filesFlushed = 0
  const io = { ...fs, fsyncSync: (fd: number) => { if (fs.fstatSync(fd).isDirectory()) throw Object.assign(new Error('Unsupported directory flush'), { code: 'EPERM' }); filesFlushed++; fs.fsyncSync(fd) } }
  const store = new FileShipmentStore(directory, () => true, { io, platform: 'win32' }); store.write('scope', value); expect(filesFlushed).toBe(1)
  const broken = new FileShipmentStore(directory, () => true, { io: { ...io, fsyncSync: () => { throw Object.assign(new Error('disk failure'), { code: 'EIO' }) } }, platform: 'win32' })
  expect(() => broken.write('scope', value)).toThrow('disk failure')
})
it('does not suppress unsupported directory operations on POSIX or corrupt journal contents', () => {
  const directory = root()
  const io = { ...fs, fsyncSync: (fd: number) => { if (fs.fstatSync(fd).isDirectory()) throw Object.assign(new Error('Unsupported'), { code: 'EINVAL' }); fs.fsyncSync(fd) } }
  expect(() => new FileShipmentStore(directory, () => true, { io, platform: 'linux' }).write('scope', value)).toThrow('Unsupported')
  const file = fs.readdirSync(directory).find(p => p.endsWith('.json'))!; fs.writeFileSync(join(directory, file), '{')
  expect(() => new FileShipmentStore(directory).read('scope')).toThrow()
})
it('flushes the existing parent after creating the journal directory', () => {
  const parent = root(), directory = join(parent, 'shipments'), directories: string[] = []
  const io = { ...fs, openSync: ((path: fs.PathLike, flags: string | number, mode?: fs.Mode) => { if (flags === 'r') directories.push(String(path)); return fs.openSync(path, flags, mode) }) as typeof fs.openSync }
  new FileShipmentStore(directory, () => true, { io }).write('scope', value)
  expect(directories).toEqual([parent, directory])
})
it('exposes a tombstone after post-rename directory-sync failure, allowing an idempotent finish retry', async () => {
  const { InventoryService } = await import('../electron/inventory-service')
  const directory = root(), store = new FileShipmentStore(directory)
  const auth = { restore: async () => ({ user: { id: 1, role: 'ADMIN' as const, email: 'test@example.test', createdAt: '2026-10-18', updatedAt: '2026-10-18' }, accessTokenExpiresAt: '2099-01-01' }), authenticatedFetch: async () => { throw new Error('No outbound I/O allowed') } }
  const normal = new InventoryService(auth, store, 'backend')
  const saved = await normal.prepare({ productListingId: 1, quantity: 1, shipmentReference: 'FBA', note: 'Test' })
  const failing = new FileShipmentStore(directory, () => true, { io: { ...fs, fsyncSync: fd => { if (fs.fstatSync(fd).isDirectory()) throw Object.assign(new Error('Directory sync failed'), { code: 'EIO' }); fs.fsyncSync(fd) } }, platform: 'linux' })
  const service = new InventoryService(auth, failing, 'backend')
  await expect(service.finish(saved.request.idempotencyKey)).rejects.toMatchObject({ code: 'journal' })
  expect(await service.pending()).toBeNull()
  await expect(service.finish(saved.request.idempotencyKey)).resolves.toBeUndefined()
  expect(await normal.pending()).toBeNull()
})
