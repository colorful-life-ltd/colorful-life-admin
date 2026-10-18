import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { PendingShipment } from './inventory-contract.js'

export interface ShipmentStore { read(scope: string): unknown; write(scope: string, value: PendingShipment | null): void }
/** Main-only durable retry journal. No credentials; each Backend/account has its own file. */
export class FileShipmentStore implements ShipmentStore {
  private readonly directory: string
  private readonly claimWriter: () => boolean
  constructor(directory: string, claimWriter: () => boolean = () => true) { this.directory = directory; this.claimWriter = claimWriter }
  private path(scope: string) { return join(this.directory, createHash('sha256').update(scope).digest('hex') + '.json') }
  read(scope: string): unknown {
    const file = this.path(scope)
    if (!existsSync(file)) return null
    const data = readFileSync(file, 'utf8')
    if (data.length > 100_000) throw new Error('Invalid shipment journal size')
    return JSON.parse(data)
  }
  write(scope: string, value: PendingShipment | null) {
    if (!this.claimWriter()) throw Object.assign(new Error('Another Admin process owns the shipment journal'), { code: 'INVENTORY_INSTANCE_BUSY' })
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const file = this.path(scope)
    if (value === null) { if (existsSync(file)) unlinkSync(file); return }
    writeFileSync(file + '.tmp', JSON.stringify(value), { mode: 0o600 })
    renameSync(file + '.tmp', file)
  }
}
