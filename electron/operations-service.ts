import { createHash, randomUUID } from 'node:crypto'
import type { AuthService } from './auth-service.js'
import { AuthError } from './auth-service.js'
import { readBackendError } from './backend-error.js'
import { operations, type AdminOperationsApi, type InvestigationDecision, type Operation, type OperationSpec, type OperatorInput, type RefundStatusCheck, type SafeValue, type SavedOperation } from './operations-contract.js'
/** Version 2 holds independent intents; a version 1 journal held one SavedOperation. */
export type OperationJournal = { version: 2; intents: SavedOperation[] }
export interface OperationStore { read(scope: string): unknown; write(scope: string, value: OperationJournal | SavedOperation | null): void }
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
const visible = new Set('evidence reviewEvidence reviewDetails correlations parentReference reference providerEventId paymentIntentId paypalOrderId captureId receivedAt processedAt resourceStatus invalidFields listing movement audit type quantityChange sourceProductListingId targetProductListingId buckets challenges auditId corroborationId cancellation activeRequestId eligible id orderId paymentId refundId receiptId requestId actorId performedByUserId status state kind amount currency refundedAmount reservedRefundAmount reviewRequired reviewRevision revision resolutionCode reason reasonNote note createdAt updatedAt paidAt requestedAt authorizedAt receivedAt inspectedAt completedAt cancelledAt reviewedAt processingError eventType provider handled processed replayed requested active withdrawn cancelled updated count removed pruned details history refund refunds orderItems returns quantity restockQuantity condition inspectionNote productListing legoProduct title setNumber productListingId currentStock reservedStock availableStock originalPrice salePrice isPublished availabilityState active discrepancies shortfall appliedQuantity shipmentReference items pagination page pageSize totalItems totalPages policies reviews counts providerOutcomes providerBudgets environmentEnabled enabled capacity releasedAt receiptIds evidenceReferences source key requestId intentFingerprint evidenceId successReceiptId attemptId confirmed preparingAt dispatchedAt completedAt fulfilment stage shipments carrierName trackingNumber trackingUrl tracking progress deliveredAt'.split(' '))
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
  REFUND_CAPACITY_EXCEEDED: 'Refund amount exceeds the remaining refundable balance.',
  REFUND_UNRESOLVED: 'Another refund for this payment is pending or needs review. Review it before starting another refund.',
}
const MAX_INTENTS = 50
function amountCents(value: unknown): bigint | null {
  const text = typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : value
  if (typeof text !== 'string' || !/^(0|[1-9]\d{0,9})\.\d{2}$/.test(text)) return null
  const [whole, fraction] = text.split('.')
  return BigInt(whole) * 100n + BigInt(fraction)
}
/** Sorted-key JSON; must match the Backend's canonical intent fingerprint. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(value)
}
export const intentFingerprint = (operation: Operation, intent: OperatorInput) => createHash('sha256').update(canonicalJson({ operation, intent })).digest('hex')
// The identity an operation acts on. Unrelated orders and operations never share a slot.
// paymentId is deliberately not part of a refund slot: the Backend enforces one Payment per
// Order (unique Payment.orderId) and refunds only that order's payment, so the order already
// identifies the payment. Refund intents for one order therefore serialize.
const targetFields = ['orderId', 'refundId', 'returnId', 'receiptId', 'productListingId', 'productId', 'sourceProductListingId', 'provider'] as const
export function intentSlot(op: Operation, input: OperatorInput) {
  return JSON.stringify([op, ...targetFields.filter(k => input[k] !== undefined).map(k => [k, input[k]])])
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
  private checked(v: unknown): SavedOperation {
    if (!record(v) || !['uncertain','confirmed','rejected'].includes(String(v.state)) || typeof v.key !== 'string' || !/^[a-f0-9-]{36}$/.test(v.key)) return invalid('Saved operator request is unreadable. Preserve the journal and investigate; no replacement request was sent.')
    validateOperationInput(v.operation,v.input)
    return v as unknown as SavedOperation
  }
  private load(scope: string): SavedOperation[] {
    const v = this.store.read(scope)
    if (v === null) return []
    // A version 1 journal holds exactly one intent; keep it, never drop it.
    const intents = record(v) && v.version === 2 && Array.isArray(v.intents) ? v.intents.map(i => this.checked(i)) : [this.checked(v)]
    if (new Set(intents.map(i => intentSlot(i.operation, i.input))).size !== intents.length || intents.length > MAX_INTENTS) return invalid('Saved operator journal is inconsistent. Preserve it and investigate; no request was sent.')
    return intents
  }
  private save(scope: string, intents: SavedOperation[]) { this.store.write(scope, intents.length ? { version: 2, intents } : null) }
  private exclusive<T>(work: () => Promise<T>) {
    if (this.busy) return invalid('An operator action is already pending.')
    this.busy = true
    return work().finally(() => { this.busy = false })
  }
  async pending() { return this.load(await this.scope()) }
  async finish(op: Operation, raw: OperatorInput) {
    const input = validateOperationInput(op, raw)
    return this.exclusive(async () => {
      const scope = await this.scope(), intents = this.load(scope), slot = intentSlot(op, input)
      const saved = intents.find(i => intentSlot(i.operation, i.input) === slot)
      if (!saved) return
      if (saved.state === 'uncertain') return invalid('An uncertain request cannot be discarded. Inspect authoritative history and reconcile the saved intent.')
      this.save(scope, intents.filter(i => i !== saved))
    })
  }
  private async request(op: Operation, input: OperatorInput, key?: string) {
    const spec = operationSpec(op), body = { ...input }
    const path = spec.path.replace(/:([A-Za-z]+)/g, (_, name: string) => { const v = body[name]; delete body[name]; return encodeURIComponent(String(v)) })
    return this.send(path, spec.method, body, key)
  }
  private async send(path: string, method: OperationSpec['method'], body: Record<string, unknown>, key?: string) {
    const response = await this.auth.authenticatedFetch(path, { method, ...(method === 'GET' ? {} : { headers: { 'Content-Type':'application/json', 'Idempotency-Key':key! }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) })
    if (!response.ok) {
      const error = await readBackendError(response, 'Operator request failed. Refresh authoritative state.')
      const friendly = error.code === 'REFUND_CAPACITY_EXCEEDED' && error.availableRefundAmount
        ? `The remaining refundable balance is £${error.availableRefundAmount}. Lower the amount and review again.`
        : messages[error.code ?? ''] ?? error.message
      throw Object.assign(new Error(friendly), { code:'api',backendCode:error.code,status:response.status,
        refundSubmissionDisposition:error.refundSubmissionDisposition, refundRequestKey:error.refundRequestKey,
        availableRefundAmount:error.availableRefundAmount, blockingRefundId:error.blockingRefundId, blockingRefundStatus:error.blockingRefundStatus })
    }
    return safeOperationResult(await response.json())
  }
  private async queryRefundStatus(input: OperatorInput, key: string): Promise<RefundStatusCheck> {
    const path = `/orders/${input.orderId}/payments/${input.paymentId}/refund-request-status`
    const response = await this.auth.authenticatedFetch(path, { method: 'GET', headers: { 'Idempotency-Key': key }, signal: AbortSignal.timeout(15000) })
    if (!response.ok) {
      const error = await readBackendError(response, 'Saved refund status could not be verified. Keep the request and try again later.')
      throw Object.assign(new Error(error.message), { code: 'api', backendCode: error.code, status: response.status })
    }
    const body: unknown = await response.json()
    if (!record(body)) return invalid('Saved refund status was not recognized. Keep the request; no refund was submitted by this check.')
    if (body.state === 'RETIRED') {
      if (body.requestKey !== key || ['refundId','status','resolutionCode','refund'].some(k => k in body)) return invalid('Saved refund retirement did not match the original request. Keep it for review.')
      return { state: 'RETIRED' }
    }
    if (body.state === 'NOT_SUBMITTED') {
      if (body.requestKey !== key || ['refundId','status','resolutionCode','refund'].some(k => k in body)) return invalid('Saved refund status did not match the original request. Keep it for review.')
      return { state: 'NOT_SUBMITTED' }
    }
    if (body.state !== 'RECORDED' || body.requestKey !== key || !record(body.refund)
      || !Number.isSafeInteger(body.refund.refundId) || Number(body.refund.refundId) <= 0
      || !['SUCCEEDED','FAILED','PROCESSING'].includes(String(body.refund.status))
      || typeof body.refund.amount !== 'string' || body.refund.currency !== 'GBP' || body.refund.provider !== 'STRIPE') {
      return invalid('Saved refund status did not match the original request. Keep it for review.')
    }
    const expectedCents = amountCents(input.amount), actualCents = amountCents(body.refund.amount)
    if (expectedCents === null || actualCents !== expectedCents) return invalid('The recorded refund amount does not match this saved request. Keep it for review.')
    return { state: 'RECORDED', refund: {
      refundId: Number(body.refund.refundId), status: body.refund.status as 'SUCCEEDED' | 'FAILED' | 'PROCESSING',
      amount: body.refund.amount, currency: 'GBP', provider: 'STRIPE',
      ...(typeof body.refund.resolutionCode === 'string' ? { resolutionCode: body.refund.resolutionCode } : {}),
      ...(typeof body.refund.reviewRequired === 'boolean' ? { reviewRequired: body.refund.reviewRequired } : {}),
    } }
  }
  async checkRefundStatus(raw: OperatorInput, key: string): Promise<RefundStatusCheck> {
    const input = validateOperationInput('refund', raw)
    if (!/^[a-f0-9-]{36}$/.test(key)) return invalid('The saved refund request key is unreadable. Keep the request for review.')
    return this.exclusive(async () => {
      const scope = await this.scope(), intents = this.load(scope), slot = intentSlot('refund', input)
      const saved = intents.find(i => intentSlot(i.operation, i.input) === slot)
      if (!saved || saved.operation !== 'refund' || saved.key !== key || JSON.stringify(saved.input) !== JSON.stringify(input)) return invalid('The saved refund does not match the status check. No request was sent.')
      const result = await this.queryRefundStatus(input, key)
      if (result.state === 'RECORDED') this.save(scope, intents.map(i => i === saved ? { ...saved, state: 'confirmed' } : i))
      return result
    })
  }
  async finishUnsubmittedRefund(raw: OperatorInput, key: string): Promise<void> {
    const input = validateOperationInput('refund', raw)
    if (!/^[a-f0-9-]{36}$/.test(key)) return invalid('The saved refund request key is unreadable. Keep the request for review.')
    return this.exclusive(async () => {
      const scope = await this.scope(), intents = this.load(scope), slot = intentSlot('refund', input)
      const saved = intents.find(i => intentSlot(i.operation, i.input) === slot)
      if (!saved || saved.operation !== 'refund' || saved.key !== key || JSON.stringify(saved.input) !== JSON.stringify(input)) return invalid('The saved refund does not match the request being finished.')
      if (saved.state !== 'uncertain') return invalid('Only an uncertain refund request can be retired. Confirmed or rejected history is preserved.')
      const path = `/orders/${input.orderId}/payments/${input.paymentId}/refund-request-retirement`
      const response = await this.auth.authenticatedFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: '{}', signal: AbortSignal.timeout(15000) })
      if (!response.ok) {
        const error = await readBackendError(response, 'The saved refund request could not be safely retired. Keep it and refresh its status.')
        throw new Error(error.message)
      }
      const body: unknown = await response.json()
      if (!record(body) || body.state !== 'RETIRED' || body.requestKey !== key
        || ['refundId','status','resolutionCode','refund'].some(k => k in body)) {
        return invalid('The Backend did not confirm retirement of this exact request key. Keep the saved request and refresh its status.')
      }
      this.save(scope, intents.filter(i => i !== saved))
    })
  }
  async read(op: Operation, raw: OperatorInput) {
    if (operationSpec(op).method !== 'GET') return invalid()
    const input = validateOperationInput(op,raw); await this.scope()
    return this.request(op,input)
  }
  async execute(op: Operation, raw: OperatorInput) {
    const spec = operationSpec(op)
    if(spec.retired)return invalid('Use the Returns workspace for return actions. Existing saved return intents are preserved for investigation; no request was sent.')
    const input = validateOperationInput(op,raw)
    if (spec.method === 'GET') return invalid()
    return this.exclusive(async () => {
      const scope = await this.scope(), intents = this.load(scope), slot = intentSlot(op, input)
      const previous = intents.find(i => intentSlot(i.operation, i.input) === slot)
      if (previous && JSON.stringify(previous.input) !== JSON.stringify(input)) return invalid('A saved intent exists for this operation and target. Resolve it before editing the payload.')
      // A confirmed intent is never submitted again (including refunds): the journal, key and
      // confirmed state stay unchanged and no Backend or Stripe request is made.
      if (previous?.state === 'confirmed') return invalid(op === 'refund'
        ? 'This refund was already recorded by the Backend. Check its saved status instead; a confirmed refund is never submitted again.'
        : 'This intent already succeeded. Refresh history and finish the saved action before starting another.')
      if (previous?.state === 'uncertain' && !spec.replaySafe) return invalid('The outcome is uncertain and this endpoint does not guarantee replay. Do not resubmit. Investigate authoritative history, then record the investigated outcome.')
      if (!previous && intents.length >= MAX_INTENTS) return invalid('Too many saved operator intents. Finish or resolve existing intents first.')
      const saved: SavedOperation = previous ?? { operation:op,input,key:randomUUID(),state:'uncertain' }
      const others = intents.filter(i => i !== previous)
      this.save(scope,[...others,{...saved,state:'uncertain'}]) // Flush before outbound I/O.
      try {
        const result = await this.request(op,input,saved.key)
        this.save(scope,[...others,{...saved,state:'confirmed'}])
        return result
      } catch (e) {
        if (op === 'refund' && e instanceof AuthError && e.code !== 'network') {
          this.save(scope, previous ? [...others, previous] : others)
          const message = previous
            ? `Admin authentication failed before this retry was sent. The earlier ${previous.state} refund record and its original request key are unchanged; its outcome has not been reclassified. Sign in again before continuing.`
            : 'Admin authentication failed before refund processing. No refund was sent to Stripe; sign in again, then review and confirm the refund.'
          throw Object.assign(new Error(message), { code: 'local-validation', requestSent: false })
        }
        // A pre-submission refusal describes this HTTP attempt only. Retain the
        // key until the Backend durably retires it under the same key lock used
        // by refund creation; a delayed duplicate POST must not create a refund.
        if (op === 'refund' && record(e) && e.refundSubmissionDisposition === 'NOT_SUBMITTED'
          && e.refundRequestKey === saved.key && e.backendCode !== 'IDEMPOTENCY_CONFLICT') {
          this.save(scope,[...others,{...saved,state:'uncertain'}])
          throw e
        }
        // A definitive 4xx refusal never applied; a later error cannot erase an earlier uncertain write.
        if (op !== 'refund' && previous?.state !== 'uncertain' && record(e) && typeof e.status === 'number' && e.status >= 400 && e.status < 500 && e.backendCode !== 'IDEMPOTENCY_CONFLICT') this.save(scope,[...others,{...saved,state:'rejected'}])
        throw e
      }
    })
  }
  async resolve(op: Operation, raw: OperatorInput, decision: InvestigationDecision, note: string) {
    const spec = operationSpec(op), input = validateOperationInput(op, raw)
    if (!['APPLIED','NOT_APPLIED'].includes(decision) || typeof note !== 'string' || note.includes('\0') || note.trim().length < 10 || note.length > 1000) return invalid('Record what authoritative history showed (10–1000 characters) and whether the action was applied.')
    // Replay-safe (financial) intents are settled by retrying the same key, never by an operator decision.
    if (spec.replaySafe) return invalid('This operation is settled by retrying its saved key. An investigated decision cannot replace its financial outcome.')
    return this.exclusive(async () => {
      const scope = await this.scope(), intents = this.load(scope), slot = intentSlot(op, input)
      const saved = intents.find(i => intentSlot(i.operation, i.input) === slot)
      if (!saved || saved.state !== 'uncertain' || JSON.stringify(saved.input) !== JSON.stringify(input)) return invalid('Only a saved uncertain intent can be resolved after investigation.')
      const target: OperatorInput = {}
      for (const k of ['orderId','productId','productListingId','receiptId'] as const) if (typeof input[k] === 'number') target[k] = input[k]
      // Immutable Backend audit first, keyed by the original intent and bound to its exact payload.
      // The local slot clears only after the recorded fingerprint matches this intent.
      const result = await this.send('/admin/operator-intents/resolutions', 'POST', { operation: op, decision, note: note.trim(), intent: input, ...target }, saved.key)
      if (!record(result) || result.intentFingerprint !== intentFingerprint(op, input)) return invalid('The recorded investigation does not match this saved intent. The intent was kept; inspect the order audit before retrying.')
      this.save(scope, intents.filter(i => i !== saved))
      return result
    })
  }
}
