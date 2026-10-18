import { randomUUID } from 'node:crypto'
import type { AuthService } from './auth-service.js'
import { readBackendError } from './backend-error.js'
import type { AdminInventoryApi, InventoryListing, InventoryMovement, InventoryPage, OutboundAudit, OutboundResult, PendingShipment, ShipmentInput, StockQuantities } from './inventory-contract.js'
import type { ShipmentStore } from './inventory-store.js'

export class InventoryError extends Error {
  readonly backendCode: string | null
  readonly status: number | null
  readonly code: string
  constructor(code: string, message: string, backendCode: string | null = null, status: number | null = null) { super(message); this.name = 'InventoryError'; this.code = code; this.backendCode = backendCode; this.status = status }
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const text = (v: unknown): v is string => typeof v === 'string'
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 2147483647
const positive = (v: unknown): v is number => integer(v) && v > 0
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v))
const invalid = () => new InventoryError('validation', 'Enter a listing, positive whole quantity, shipment reference (up to 200 characters) and note (up to 2,000 characters).')
const malformed = () => new InventoryError('malformed-response', 'The service returned inconsistent inventory data. Refresh before proceeding; keep the existing shipment key for retries.')
export function inventoryId(v: unknown): number { if (!positive(v)) throw invalid(); return v }
export function inventoryPage(v: unknown): number { if (!positive(v) || v > 10000) throw invalid(); return v }
export function shipmentKey(v: unknown): string { if (!text(v) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v)) throw invalid(); return v }
export function validateShipment(v: unknown): ShipmentInput {
  if (!record(v) || Object.keys(v).some(k => !['productListingId', 'quantity', 'shipmentReference', 'note'].includes(k)) || !positive(v.productListingId) || !positive(v.quantity) || !text(v.shipmentReference) || !text(v.note)) throw invalid()
  const shipmentReference = v.shipmentReference.trim(), note = v.note.trim()
  if (!shipmentReference || shipmentReference.length > 200 || [...shipmentReference].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || !note || note.length > 2000 || note.includes('\0')) throw invalid()
  return { productListingId: v.productListingId, quantity: v.quantity, shipmentReference, note }
}
function quantities(v: unknown): StockQuantities {
  if (!record(v) || !positive(v.productListingId) || !integer(v.currentStock) || !integer(v.reservedStock) || !integer(v.availableStock) || v.currentStock - v.reservedStock !== v.availableStock) throw malformed()
  return v as unknown as StockQuantities
}
function movement(v: unknown): InventoryMovement {
  if (!record(v) || !positive(v.id) || !positive(v.listingId) || typeof v.quantityChange !== 'number' || !Number.isInteger(v.quantityChange) || Math.abs(v.quantityChange) > 2147483647 || !text(v.type) || !text(v.note) || !positive(v.performedByUserId) || !date(v.createdAt)) throw malformed()
  if (v.fbaOutbound !== undefined && v.fbaOutbound !== null && (!record(v.fbaOutbound) || !positive(v.fbaOutbound.id) || !text(v.fbaOutbound.shipmentReference) || !text(v.fbaOutbound.idempotencyKey))) throw malformed()
  return v as unknown as InventoryMovement
}
export function parseOutbound(v: unknown): OutboundAudit {
  if (!record(v) || !record(v.outbound) || !positive(v.outbound.id) || !positive(v.outbound.performedByUserId) || !date(v.outbound.createdAt)) throw malformed()
  const o = v.outbound
  validateShipment({ productListingId: o.productListingId, quantity: o.quantity, shipmentReference: o.shipmentReference, note: o.note }); shipmentKey(o.idempotencyKey)
  const m = movement(o.movement), q = quantities(v.inventory)
  if (m.type !== 'FBA_OUTBOUND' || m.quantityChange !== -Number(o.quantity) || m.listingId !== o.productListingId || m.performedByUserId !== o.performedByUserId || m.note !== o.note || m.createdAt !== o.createdAt || q.productListingId !== o.productListingId) throw malformed()
  return { outbound: o as unknown as OutboundAudit['outbound'], inventory: q }
}
function parsePending(v: unknown): PendingShipment | null {
  if (v === null) return null
  if (!record(v) || !record(v.request) || !['prepared', 'uncertain', 'rejected', 'confirmed'].includes(String(v.state))) throw malformed()
  const { idempotencyKey, ...input } = v.request
  validateShipment(input); shipmentKey(idempotencyKey)
  if (v.state === 'confirmed') {
    const audit = parseOutbound(v.result)
    if (!record(v.result) || typeof v.result.replayed !== 'boolean' || !matches(audit, v.request)) throw malformed()
  } else if (v.result !== undefined) throw malformed()
  return v as unknown as PendingShipment
}
function matches(audit: OutboundAudit, request: Record<string, unknown>) { return ['productListingId', 'quantity', 'shipmentReference', 'note', 'idempotencyKey'].every(k => audit.outbound[k as keyof typeof audit.outbound] === request[k]) }

export class InventoryService implements AdminInventoryApi {
  private busy = false
  private readonly auth: Pick<AuthService, 'authenticatedFetch' | 'restore'>
  private readonly store: ShipmentStore
  private readonly backend: string
  constructor(auth: Pick<AuthService, 'authenticatedFetch' | 'restore'>, store: ShipmentStore, backend: string) { this.auth = auth; this.store = store; this.backend = backend }
  private async scope() {
    const session = await this.auth.restore()
    if (!session || session.user.role !== 'ADMIN') throw new InventoryError('auth', 'Sign in as an Admin to manage inventory.', 'AUTH_REQUIRED', 401)
    return { scope: `${this.backend}|${session.user.id}`, actor: session.user.id }
  }
  private read(scope: string) {
    try { return parsePending(this.store.read(scope)) }
    catch { throw new InventoryError('journal', 'The saved shipment could not be read. Do not submit a new shipment for the same goods; inspect the movement ledger and recover the saved journal.') }
  }
  private write(scope: string, value: PendingShipment | null) {
    try { this.store.write(scope, value) }
    catch (error) {
      if (record(error) && error.code === 'INVENTORY_INSTANCE_BUSY') throw new InventoryError('busy', 'Inventory writes are active in another Admin process. Use that window or close it before retrying the saved shipment.')
      throw new InventoryError('journal', 'The shipment could not be saved safely. No new shipment key will be created. Recover the saved journal before proceeding.') }
  }
  private async exclusive<T>(operation: () => Promise<T>) {
    if (this.busy) throw new InventoryError('busy', 'A shipment operation is already in progress. Wait for its outcome.')
    this.busy = true
    try { return await operation() } finally { this.busy = false }
  }
  private async request(path: string): Promise<unknown> {
    const response = await this.auth.authenticatedFetch(path)
    if (!response.ok) throw await this.apiError(response)
    try { return await response.json() } catch { throw malformed() }
  }
  private async apiError(response: Response) {
    const details = await readBackendError(response, 'The inventory request could not be completed.')
    const messages: Record<number, string> = { 400: 'Check the shipment fields and try again.', 401: 'Your session is unavailable. Sign in again with the same Admin account.', 403: 'This account cannot manage inventory.', 404: 'The listing or outbound record no longer exists.' }
    const codes: Record<string, string> = { INSUFFICIENT_AVAILABLE_STOCK: 'Not enough available local stock. Website reservations cannot be used for Amazon shipments.', IDEMPOTENCY_CONFLICT: 'This key conflicts with a recorded shipment. Do not create a new key for these goods. Check the movement ledger.', USED_OFFER_NOT_SUPPORTED: 'Individually documented Used offers cannot be shipped through this operation.' }
    return new InventoryError('api', codes[details.code ?? ''] ?? messages[response.status] ?? (response.status >= 500 ? 'The service could not confirm the shipment. Retry the saved shipment with the same key.' : details.message), details.code, response.status)
  }
  async list(page = 1): Promise<InventoryPage> {
    const value = await this.request(`/admin/product-listings?page=${inventoryPage(page)}&pageSize=20`)
    if (!record(value) || !Array.isArray(value.items) || !record(value.pagination)) throw malformed()
    const p = value.pagination
    if (p.page !== page || p.pageSize !== 20 || !integer(p.totalItems) || !integer(p.totalPages) || p.totalPages !== Math.ceil(p.totalItems / 20) || value.items.length > 20) throw malformed()
    const items: InventoryListing[] = value.items.map(v => {
      if (!record(v) || !positive(v.id) || !integer(v.currentStock) || !integer(v.availableStock) || v.availableStock > v.currentStock || !['NEW', 'USED_LIKE_NEW'].includes(String(v.condition)) || typeof v.active !== 'boolean' || !record(v.legoProduct) || !positive(v.legoProduct.id) || !text(v.legoProduct.setNumber) || !text(v.legoProduct.title)) throw malformed()
      return { productListingId: v.id, productId: v.legoProduct.id, setNumber: v.legoProduct.setNumber, title: v.legoProduct.title, condition: v.condition as InventoryListing['condition'], active: v.active, currentStock: v.currentStock, availableStock: v.availableStock, reservedStock: v.currentStock - v.availableStock }
    })
    return { items, pagination: p as unknown as InventoryPage['pagination'] }
  }
  async movements(id: number) {
    const v = await this.request(`/products/${inventoryId(id)}/inventory-movements`)
    if (!record(v) || v.listingId !== id || !Array.isArray(v.movements)) throw malformed()
    return v.movements.map(m => { const parsed = movement(m); if (parsed.listingId !== id) throw malformed(); return parsed })
  }
  async getOutbound(id: number) { const result = parseOutbound(await this.request(`/inventory/fba-outbounds/${inventoryId(id)}`)); if (result.outbound.id !== id) throw malformed(); return result }
  async pending() { const { scope } = await this.scope(); return this.read(scope) }
  async prepare(raw: ShipmentInput) { return this.exclusive(async () => {
    const input = validateShipment(raw), { scope } = await this.scope(), current = this.read(scope)
    if (current) {
      if (!Object.entries(input).every(([k, v]) => current.request[k as keyof ShipmentInput] === v)) throw new InventoryError('conflict', 'A saved shipment already exists. Resolve it before changing the payload or starting another shipment.')
      return current
    }
    const pending: PendingShipment = { request: { ...input, idempotencyKey: randomUUID() }, state: 'prepared' }
    this.write(scope, pending); return pending
  }) }
  async submit(rawKey: string) { return this.exclusive(async () => {
    const key = shipmentKey(rawKey), { scope, actor } = await this.scope(), current = this.read(scope)
    if (!current || current.request.idempotencyKey !== key) throw new InventoryError('conflict', 'The saved shipment key does not match. Reload the saved shipment.')
    if (current.state === 'confirmed') return current
    // Persist uncertainty BEFORE any outbound I/O; a crash or timeout cannot mint a new key.
    this.write(scope, { request: current.request, state: 'uncertain' })
    let response: Response
    try { response = await this.auth.authenticatedFetch('/inventory/fba-outbounds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(current.request), signal: AbortSignal.timeout(20000) }) }
    catch { throw new InventoryError('uncertain', 'Shipment outcome is not confirmed. The key and payload are saved. Sign in with the same account if needed, then retry this shipment; do not create another for the same goods.') }
    if (!response.ok) {
      const error = await this.apiError(response)
      const definite = [400, 403, 404, 409].includes(response.status) && error.backendCode !== 'IDEMPOTENCY_CONFLICT'
      // Backend checks persistent idempotency before these exact status/code pairs.
      const conclusive = (response.status === 409 && ['INSUFFICIENT_AVAILABLE_STOCK', 'USED_OFFER_NOT_SUPPORTED'].includes(error.backendCode ?? '')) || (response.status === 404 && error.backendCode === 'LISTING_NOT_FOUND')
      if (conclusive || (current.state !== 'uncertain' && definite)) this.write(scope, { request: current.request, state: 'rejected' })
      throw error
    }
    const value: unknown = await response.json().catch(() => { throw malformed() })
    const audit = parseOutbound(value)
    if (![200, 201].includes(response.status) || !record(value) || typeof value.replayed !== 'boolean' || value.replayed !== (response.status === 200) || !matches(audit, current.request as unknown as Record<string, unknown>) || audit.outbound.performedByUserId !== actor) throw malformed()
    const result: OutboundResult = { ...audit, replayed: value.replayed }
    const pending: PendingShipment = { request: current.request, state: 'confirmed', result }
    this.write(scope, pending); return pending
  }) }
  async finish(rawKey: string) { return this.exclusive(async () => {
    const key = shipmentKey(rawKey), { scope } = await this.scope(), current = this.read(scope)
    if (!current) return // A prior tombstone may have committed before its directory flush failed.
    if (current.request.idempotencyKey !== key || current.state === 'uncertain') throw new InventoryError('conflict', 'An uncertain shipment cannot be discarded. Retry with its saved key or resolve it through the ledger.')
    this.write(scope, null)
  }) }
}
