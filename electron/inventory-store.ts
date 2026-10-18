import * as fs from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { PendingShipment } from './inventory-contract.js'

export interface ShipmentStore { read(scope: string): unknown; write(scope: string, value: PendingShipment | null): void }
type JournalIO = Pick<typeof fs, 'mkdirSync' | 'readFileSync' | 'renameSync' | 'writeFileSync' | 'existsSync' | 'openSync' | 'fsyncSync' | 'closeSync'>
/** Main-only retry journal. Durability depends on filesystem/platform flush support. */
export class FileShipmentStore implements ShipmentStore {
  private readonly directory: string
  private readonly claimWriter: () => boolean
  private readonly io: JournalIO
  private readonly platform: string
  constructor(directory: string, claimWriter: () => boolean = () => true, options: { io?: JournalIO; platform?: string } = {}) {
    this.directory = directory; this.claimWriter = claimWriter; this.io = options.io ?? fs; this.platform = options.platform ?? process.platform
  }
  private path(scope: string) { return join(this.directory, createHash('sha256').update(scope).digest('hex') + '.json') }
  read(scope: string): unknown {
    const file = this.path(scope)
    if (!this.io.existsSync(file)) return null
    const data = this.io.readFileSync(file, 'utf8')
    if (data.length > 100_000) throw new Error('Invalid shipment journal size')
    return JSON.parse(data)
  }
  private flushDirectory(directory: string) {
    let fd: number | undefined
    try { fd = this.io.openSync(directory, 'r'); this.io.fsyncSync(fd) }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      // Windows commonly denies directory handles/flushes; never suppress disk I/O failures.
      if (!(this.platform === 'win32' && ['EPERM', 'EACCES', 'EISDIR', 'EINVAL', 'ENOTSUP', 'EBADF'].includes(code ?? ''))) throw error
    } finally { if (fd !== undefined) this.io.closeSync(fd) }
  }
  write(scope: string, value: PendingShipment | null) {
    if (!this.claimWriter()) throw Object.assign(new Error('Another Admin process owns the shipment journal'), { code: 'INVENTORY_INSTANCE_BUSY' })
    const created = !this.io.existsSync(this.directory)
    this.io.mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    // Also persist creation of the journal directory within the existing userData directory.
    if (created) this.flushDirectory(join(this.directory, '..'))
    const file = this.path(scope), temporary = file + '.' + randomUUID() + '.tmp'
    const fd = this.io.openSync(temporary, 'wx', 0o600)
    try { this.io.writeFileSync(fd, JSON.stringify(value)); this.io.fsyncSync(fd) }
    finally { this.io.closeSync(fd) }
    this.io.renameSync(temporary, file)
    this.flushDirectory(this.directory)
    // Null is an atomic tombstone. Avoid an unflushed unlink resurrecting a prior state.
    // Failures leave the old/new journal and possibly temporary evidence; never auto-recover it.
  }
}
