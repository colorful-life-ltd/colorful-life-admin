import { randomUUID } from 'node:crypto'
import type { AuthService } from './auth-service.js'
import { readBackendError } from './backend-error.js'
import { operations, type AdminOperationsApi, type Operation, type OperationSpec, type OperatorInput, type SafeValue, type SavedOperation } from './operations-contract.js'
export interface OperationStore { read(scope: string): unknown; write(scope: string, value: SavedOperation | null): void }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function invalid(message = 'Invalid operator input. No request was sent.'): never { throw new Error(message) }
export function operationSpec(op: unknown): OperationSpec {
  if (typeof op !== 'string' || !Object.hasOwn(operations, op)) return invalid()
  return operations[op as Operation]
}
export function validateOperationInput(op: unknown, value: unknown): OperatorInput {
  const spec = operationSpec(op)
  if (!record(value) || Object.keys(value).some(k => !spec.fields.some(f => f.name === k))) return invalid()
  const input: OperatorInput = {}
  for (const field of spec.fields) {
    const v = value[field.name]
    if (field.optional && (v === undefined || v === '' || v === null)) { if (field.name === 'salePrice' || field.name === 'capacity') input[field.name] = null; continue }
    if (field.type === 'id' || field.type === 'integer') {
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < (field.type === 'id' ? 1 : 0) || v > 2147483647) return invalid()
    } else if (field.type === 'money') {
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 99999999.99 || Math.abs(v * 100 - Math.round(v * 100)) > 0.000001) return invalid()
    } else if (field.type === 'boolean') { if (typeof v !== 'boolean') return invalid() }
    else if (field.type === 'references') { if (!Array.isArray(v) || v.length < 1 || v.length > 10 || !v.every(s => typeof s === 'string' && s.length > 0 && s.length <= 128)) return invalid() }
    else {
      if (typeof v !== 'string' || v.includes('\0') || v.trim().length < (field.type === 'reason' ? 10 : 1) || v.length > (op === 'replay' || op === 'securityReview' ? 500 : 1000)) return invalid()
      if (field.type === 'requestId' && (!/^[1-9][0-9]{0,18}$/.test(v) || BigInt(v) > 9223372036854775807n)) return invalid()
      if (field.options && !field.options.includes(v)) return invalid()
    }
    input[field.name] = typeof v === 'string' ? v.trim() : v as OperatorInput[string]
  }
  if (op === 'adjust' && (input.action === 'CONDITION_ADJUSTMENT' ? input.targetProductListingId === undefined : input.targetProductListingId !== undefined)) return invalid('Only a condition adjustment requires a target listing.')
  return input
}
// Explicit DTO allowlist: never forward raw provider outcomes, keys or credentials.
const visible = new Set('evidence reviewEvidence reviewDetails correlations parentReference reference providerEventId paymentIntentId paypalOrderId captureId receivedAt processedAt resourceStatus invalidFields listing movement audit type quantityChange sourceProductListingId targetProductListingId buckets challenges auditId corroborationId cancellation activeRequestId eligible id orderId paymentId refundId receiptId requestId actorId performedByUserId status state kind amount currency refundedAmount reservedRefundAmount reviewRequired reviewRevision revision resolutionCode reason reasonNote note createdAt updatedAt paidAt requestedAt authorizedAt receivedAt inspectedAt completedAt cancelledAt reviewedAt processingError eventType provider handled processed replayed requested active withdrawn cancelled updated count removed pruned details history refund refunds orderItems returns quantity restockQuantity condition inspectionNote productListing legoProduct title setNumber productListingId currentStock reservedStock availableStock originalPrice salePrice isPublished availabilityState active discrepancies shortfall appliedQuantity shipmentReference items pagination page pageSize totalItems totalPages policies reviews counts providerOutcomes providerBudgets environmentEnabled enabled capacity releasedAt receiptIds evidenceReferences source key requestId evidenceId successReceiptId attemptId confirmed preparingAt dispatchedAt completedAt fulfilment stage shipments carrierName trackingNumber trackingUrl tracking progress deliveredAt'.split(' '))
export function safeOperationResult(value: unknown, depth = 0): SafeValue {
  if (depth > 12) return invalid('Operator response is too deeply nested.')
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(v => safeOperationResult(v, depth + 1))
  if (!record(value)) return invalid('Invalid operator response. Refresh authoritative history before proceeding.')
  return Object.fromEntries(Object.entries(value).filter(([k]) => visible.has(k)).map(([k,v]) => [k, safeOperationResult(v, depth + 1)]))
}
const messages: Record<string,string> = {
  CANCELLATION_VERSION_CONFLICT: 'The cancellation request changed. Refresh audit history and use the exact active request ID; the previous request was not withdrawn.',
  REFUND_ALREADY_INITIATED: 'A refund has already been initiated. Withdrawal is unavailable; follow refund reconciliation and staged cancellation.',
  IDEMPOTENCY_CONFLICT: 'This saved key belongs to a different intent. Do not create a replacement until its outcome has been investigated.',
  REVIEW_VERSION_CONFLICT: 'The review revision changed. Reload the review and evidence before deciding again.',
  REFUND_REVIEW_REQUIRED: 'Refund evidence requires review. Reconcile and investigate the retained evidence.',
  DISCREPANCY_STOCKTAKE_REASON_REQUIRED: 'An open stock discrepancy needs a physical count and a reason of at least 10 characters.',
}
export class OperationsService implements AdminOperationsApi {
  private busy = false
  private auth: Pick<AuthService,'authenticatedFetch'|'restore'>
  private store: OperationStore
  private backend: string
  constructor(auth: Pick<AuthService,'authenticatedFetch'|'restore'>, store: OperationStore, backend: string) { this.auth=auth; this.store=store; this.backend=backend }
  private async scope() {
    const session = await this.auth.restore()
    if (!session || session.user.role !== 'ADMIN') throw new Error('Sign in as an active ADMIN to use operator controls.')
    return `${this.backend}|${session.user.id}`
  }
  private saved(scope: string): SavedOperation | null {
    const v = this.store.read(scope)
    if (v === null) return null
    if (!record(v) || !['uncertain','confirmed','rejected'].includes(String(v.state)) || typeof v.key !== 'string' || !/^[a-f0-9-]{36}$/.test(v.key)) return invalid('Saved operator request is unreadable. Preserve the journal and investigate; no replacement request was sent.')
    validateOperationInput(v.operation,v.input)
    return v as unknown as SavedOperation
  }
  async pending() { return this.saved(await this.scope()) }
  async finish() {
    if (this.busy) return invalid('Wait for the current operation.')
    const scope = await this.scope(), saved = this.saved(scope)
    if (saved?.state === 'uncertain') return invalid('An uncertain request cannot be discarded. Inspect authoritative history and reconcile the saved intent.')
    this.store.write(scope,null)
  }
  private async request(op: Operation, input: OperatorInput, key?: string) {
    const spec = operationSpec(op), body = { ...input }
    const path = spec.path.replace(/:([A-Za-z]+)/g, (_, name: string) => { const v = body[name]; delete body[name]; return encodeURIComponent(String(v)) })
    const response = await this.auth.authenticatedFetch(path, { method: spec.method, ...(spec.method === 'GET' ? {} : { headers: { 'Content-Type':'application/json', 'Idempotency-Key':key! }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) })
    if (!response.ok) {
      const error = await readBackendError(response, 'Operator request failed. Refresh authoritative state.')
      throw Object.assign(new Error(messages[error.code ?? ''] ?? error.message), { code:'api',backendCode:error.code,status:response.status })
    }
    return safeOperationResult(await response.json())
  }
  async read(op: Operation, raw: OperatorInput) {
    if (operationSpec(op).method !== 'GET') return invalid()
    const input = validateOperationInput(op,raw); await this.scope()
    return this.request(op,input)
  }
  async execute(op: Operation, raw: OperatorInput) {
    if (this.busy) return invalid('An operator action is already pending.')
    const spec = operationSpec(op), input = validateOperationInput(op,raw)
    if (spec.method === 'GET') return invalid()
    this.busy = true
    try {
      const scope = await this.scope(), previous = this.saved(scope)
      if (previous && (previous.operation !== op || JSON.stringify(previous.input) !== JSON.stringify(input))) return invalid('A saved intent exists. Resolve it before editing the payload or starting another action.')
      if (previous?.state === 'confirmed') return invalid('This intent already succeeded. Refresh history and finish the saved action before starting another.')
      if (previous?.state === 'uncertain' && !spec.replaySafe) return invalid('The outcome is uncertain and this endpoint does not guarantee replay. Do not resubmit. Investigate authoritative history; keep the journal for recovery.')
      const saved: SavedOperation = previous ?? { operation:op,input,key:randomUUID(),state:'uncertain' }
      this.store.write(scope,{...saved,state:'uncertain'}) // Flush before outbound I/O.
      try {
        const result = await this.request(op,input,saved.key)
        this.store.write(scope,{...saved,state:'confirmed'})
        return result
      } catch (e) {
        // A later validation/authorization error cannot erase an earlier uncertain write.
        if (previous?.state !== 'uncertain' && record(e) && typeof e.status === 'number' && e.status >= 400 && e.status < 500 && e.backendCode !== 'IDEMPOTENCY_CONFLICT') this.store.write(scope,{...saved,state:'rejected'})
        throw e
      }
    } finally { this.busy = false }
  }
}
