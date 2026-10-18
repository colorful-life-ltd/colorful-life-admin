import { hasValidListingPrices, priceValidationMessage } from './listing-price.js'
import { AuthError } from './auth-service.js'
import type { AuthService } from './auth-service.js'
import type { AdminPurchasesApi, ManualPurchaseCreated, ManualPurchaseInput, ManualPurchaseSupplierOptions, Purchase, PurchaseAnalyticsSummary, PurchaseDocument, PurchaseImportResult, PurchaseItem, PurchasePage, SupplierMonthlyPurchaseAnalytics } from './purchase-contract.js'
import type { PurchaseReview, ReviewGroup, PurchaseAmendment, ReviewProduct, ReviewListingCreation, InventoryDispositionInput } from './purchase-contract.js'
import { parseProduct } from './product-service.js'
import { readBackendError } from './backend-error.js'

export type PurchaseErrorCode = 'validation' | 'duplicate' | 'conflict' | 'forbidden' | 'not-found' | 'server' | 'session-invalid' | 'malformed-response' | 'invalid-supplier-key' | 'analytics-supplier-not-found'

export class PurchaseError extends Error {
  readonly code: PurchaseErrorCode
  readonly status: number | null
  readonly backendCode: string | null
  constructor(code: PurchaseErrorCode, message: string, status: number | null = null, backendCode: string | null = null) { super(message); this.name = 'PurchaseError'; this.code = code; this.status = status; this.backendCode = backendCode }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isString = (value: unknown): value is string => typeof value === 'string'
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isNullableString = (value: unknown): value is string | null => isString(value) || value === null
const decimal = (value: unknown): string | null => isString(value) ? value : isNumber(value) ? value.toFixed(2) : null

const responseError = async (response: Response, importing = false): Promise<PurchaseError> => {
  const details = await readBackendError(response, 'The purchase operation could not be completed.')
  const { message, code } = details
  if (response.status === 400) return new PurchaseError('validation', message, response.status, code)
  if (code === 'SESSION_INVALID') return new PurchaseError('session-invalid', 'Your session has expired. Please sign in again.', response.status, code)
  if (code === 'AUTH_REQUIRED') return new PurchaseError('session-invalid', 'Sign in is required to continue.', response.status, code)
  if (response.status === 403 || code === 'FORBIDDEN') return new PurchaseError('forbidden', 'This account cannot manage purchase documents.', response.status, code)
  if (response.status === 404) return new PurchaseError('not-found', 'The purchase could not be found.', response.status, code)
  if (response.status === 409) {
    // The current import endpoint identifies hash duplicates with this domain error.
    // A generic conflict must never be presented as a confirmed duplicate.
    const duplicate = importing && /^Duplicate import hash: [a-f0-9]{64}$/.test(message)
    return new PurchaseError(duplicate ? 'duplicate' : 'conflict', duplicate ? 'This invoice has already been imported. No duplicate was created.' : message, response.status, code)
  }
  return new PurchaseError('server', response.status >= 500 || code === 'INTERNAL_SERVER_ERROR' ? 'The Colorful Life service is unavailable right now.' : message, response.status, code)
}

const analyticsResponseError = async (response: Response): Promise<PurchaseError> => {
  const details = await readBackendError(response, 'Purchase analytics could not be retrieved.')
  if (details.code === 'INVALID_SUPPLIER_KEY') {
    return new PurchaseError('invalid-supplier-key', 'This supplier selection is invalid. Return to the summary and choose a supplier again.', response.status, details.code)
  }
  if (details.code === 'PURCHASE_ANALYTICS_SUPPLIER_NOT_FOUND') {
    return new PurchaseError('analytics-supplier-not-found', 'This supplier is no longer available in purchase analytics.', response.status, details.code)
  }
  if (details.code === 'FORBIDDEN' || response.status === 403) {
    return new PurchaseError('forbidden', 'This account cannot access purchase analytics.', response.status, details.code)
  }
  if (response.status >= 500 || details.code === 'INTERNAL_SERVER_ERROR') {
    return new PurchaseError('server', 'The Colorful Life service is unavailable right now.', response.status, details.code)
  }
  return new PurchaseError('server', details.message, response.status, details.code)
}

const parseManualPurchaseSupplierOptions = (value: unknown): ManualPurchaseSupplierOptions => {
  if (!isRecord(value) || !Array.isArray(value.canonicalSuppliers) ||
    !value.canonicalSuppliers.every((supplier) => isString(supplier) && supplier.trim().length > 0) ||
    !isString(value.customSupplierOption) || value.customSupplierOption.trim().length === 0 ||
    value.canonicalSuppliers.includes(value.customSupplierOption)) {
    throw new PurchaseError('malformed-response', 'The server returned invalid manual purchase supplier options.')
  }
  return {
    canonicalSuppliers: [...value.canonicalSuppliers],
    customSupplierOption: value.customSupplierOption,
  }
}

const isMoneyString = (value: unknown): value is string => typeof value === 'string' && /^\d+\.\d{2}$/.test(value)

const parsePurchaseAnalyticsSummary = (value: unknown): PurchaseAnalyticsSummary => {
  if (!isRecord(value) || !isNumber(value.totalQuantity) || !Number.isSafeInteger(value.totalQuantity) || value.totalQuantity < 0 ||
    !isMoneyString(value.totalAmount) || !Array.isArray(value.suppliers)) {
    throw new PurchaseError('malformed-response', 'The server returned invalid purchase analytics.')
  }
  const suppliers = value.suppliers.map((supplier: unknown) => {
    if (!isRecord(supplier) || !isString(supplier.supplierKey) || !isString(supplier.supplierName) || !isMoneyString(supplier.totalAmount)) {
      throw new PurchaseError('malformed-response', 'The server returned invalid supplier analytics.')
    }
    return { supplierKey: supplier.supplierKey, supplierName: supplier.supplierName, totalAmount: supplier.totalAmount }
  })
  return { totalQuantity: value.totalQuantity, totalAmount: value.totalAmount, suppliers }
}

const parseSupplierMonthlyAnalytics = (value: unknown): SupplierMonthlyPurchaseAnalytics => {
  if (!isRecord(value) || !isString(value.supplierKey) || !isString(value.supplierName) || !Array.isArray(value.months) || !isMoneyString(value.undatedTotalAmount)) {
    throw new PurchaseError('malformed-response', 'The server returned invalid supplier monthly analytics.')
  }
  const months = value.months.map((row: unknown) => {
    if (!isRecord(row) || !isString(row.month) || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(row.month) || !isMoneyString(row.totalAmount)) {
      throw new PurchaseError('malformed-response', 'The server returned invalid supplier monthly analytics.')
    }
    return { month: row.month, totalAmount: row.totalAmount }
  })
  return { supplierKey: value.supplierKey, supplierName: value.supplierName, months, undatedTotalAmount: value.undatedTotalAmount }
}

const parseItem = (value: unknown): PurchaseItem => {
  if (!isRecord(value) || !isNumber(value.id) || (!isNumber(value.productListingId) && value.productListingId !== null) || !['INVENTORY', 'NON_INVENTORY'].includes(String(value.inventoryDisposition)) || !isNullableString(value.externalProductId) || !isString(value.sourceDescription) || !isNullableString(value.sourceSetNumber) || (!isNumber(value.sourceLineNumber) && value.sourceLineNumber !== null) || !isNumber(value.quantity)) throw new PurchaseError('malformed-response', 'The server returned an invalid purchase item.')
  const money = ['originalGrossUnitCost', 'originalGrossLineTotal', 'allocatedShipping', 'allocatedDiscount', 'finalLineCost', 'finalUnitCost']
  const values = Object.fromEntries(money.map((field) => [field, decimal(value[field])]))
  if (Object.values(values).some((entry) => entry === null) || (!isNullableString(value.receivedAt)) || (!isNullableString(value.returnedAt))) throw new PurchaseError('malformed-response', 'The server returned an invalid purchase item.')
  return { id: value.id, productListingId: value.productListingId, inventoryDisposition: value.inventoryDisposition as PurchaseItem['inventoryDisposition'], externalProductId: value.externalProductId, sourceDescription: value.sourceDescription, sourceSetNumber: value.sourceSetNumber, sourceLineNumber: value.sourceLineNumber, quantity: value.quantity, originalGrossUnitCost: values.originalGrossUnitCost!, originalGrossLineTotal: values.originalGrossLineTotal!, allocatedShipping: values.allocatedShipping!, allocatedDiscount: values.allocatedDiscount!, finalLineCost: values.finalLineCost!, finalUnitCost: values.finalUnitCost!, receivedAt: value.receivedAt, returnedAt: value.returnedAt }
}

const parseDocument = (value: unknown, requireItems = false): PurchaseDocument => {
  if (!isRecord(value) || !isNumber(value.id) || !isNumber(value.purchaseId) || !isNumber(value.partNumber) || !isNullableString(value.sourceInvoiceReference) || !isString(value.importHash) || !isNullableString(value.sourceDocumentDate) || !isNumber(value.importedByUserId) || !isString(value.createdAt) || !isString(value.updatedAt) || (requireItems && !Array.isArray(value.purchaseItems)) || (value.purchaseItems !== undefined && !Array.isArray(value.purchaseItems))) throw new PurchaseError('malformed-response', 'The server returned an invalid purchase document.')
  const money = ['originalGrossMerchandiseTotal', 'shippingTotal', 'discountTotal', 'finalTotalPaid']
  const values = Object.fromEntries(money.map((field) => [field, decimal(value[field])]))
  if (Object.values(values).some((entry) => entry === null)) throw new PurchaseError('malformed-response', 'The server returned an invalid purchase document.')
  return { id: value.id, purchaseId: value.purchaseId, partNumber: value.partNumber, sourceInvoiceReference: value.sourceInvoiceReference, importHash: value.importHash, sourceDocumentDate: value.sourceDocumentDate, importedByUserId: value.importedByUserId, originalGrossMerchandiseTotal: values.originalGrossMerchandiseTotal!, shippingTotal: values.shippingTotal!, discountTotal: values.discountTotal!, finalTotalPaid: values.finalTotalPaid!, createdAt: value.createdAt, updatedAt: value.updatedAt, ...(value.purchaseItems === undefined ? {} : { purchaseItems: value.purchaseItems.map(parseItem) }) }
}

const parsePurchase = (value: unknown, requireItems = false): Purchase => {
  if (!isRecord(value) || !isNumber(value.id) || !isString(value.sourceOrderReference) || !isNullableString(value.sourceOrderDate) || !isNullableString(value.merchantName) || !isString(value.createdAt) || !isString(value.updatedAt) || !Array.isArray(value.purchaseDocuments)) throw new PurchaseError('malformed-response', 'The server returned an invalid purchase response.')
  return { id: value.id, sourceOrderReference: value.sourceOrderReference, sourceOrderDate: value.sourceOrderDate, merchantName: value.merchantName, createdAt: value.createdAt, updatedAt: value.updatedAt, purchaseDocuments: value.purchaseDocuments.map((document) => parseDocument(document, requireItems)) }
}

const parsePage = (value: unknown): PurchasePage => {
  if (!isRecord(value) || !Array.isArray(value.purchases) || !isRecord(value.pagination)) throw new PurchaseError('malformed-response', 'The server returned an invalid purchase history response.')
  const { page, pageSize, totalItems, totalPages, limit, total } = value.pagination
  if (![page, pageSize, totalItems, totalPages, limit, total].every(isNumber) ||
    ![page, pageSize, totalItems, totalPages, limit, total].every(Number.isSafeInteger) ||
    (page as number) < 1 || (pageSize as number) < 1 || (pageSize as number) > 6 || (totalItems as number) < 0 || (totalPages as number) < 0 ||
    (page as number) > Math.max(1, totalPages as number) ||
    (limit as number) < 1 || (total as number) < 0 || value.purchases.length > (pageSize as number)) {
    throw new PurchaseError('malformed-response', 'The server returned an invalid purchase history response.')
  }
  return { purchases: value.purchases.map((purchase) => parsePurchase(purchase)), pagination: { page: page as number, pageSize: pageSize as number, totalItems: totalItems as number, totalPages: totalPages as number, limit: limit as number, total: total as number } }
}

const poundsToPence = (value: unknown, field: string): number => {
  if (!isString(value) || !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) throw new PurchaseError('validation', `${field} must be a nonnegative amount with up to two decimal places.`)
  const [whole, fraction = ''] = value.trim().split('.')
  const pence = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(pence)) throw new PurchaseError('validation', `${field} is too large.`)
  return pence
}

const optionalText = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined
  if (!isString(value)) throw new PurchaseError('validation', `${field} must be text.`)
  return value.trim() || undefined
}

export function validateManualPurchaseInput(value: unknown) {
  if (!isRecord(value)) throw new PurchaseError('validation', 'Enter valid purchase details.')
  const sourceOrderReference = optionalText(value.sourceOrderReference, 'Purchase reference')
  if (!sourceOrderReference) throw new PurchaseError('validation', 'Purchase reference is required.')
  const sourceOrderDate = optionalText(value.sourceOrderDate, 'Purchase date')
  const sourceDocumentDate = optionalText(value.sourceDocumentDate, 'Document date')
  for (const [label, date] of [['Purchase date', sourceOrderDate], ['Document date', sourceDocumentDate]] as const) {
    if (date && Number.isNaN(Date.parse(date))) throw new PurchaseError('validation', `${label} must be a valid date.`)
  }
  const originalGrossMerchandiseTotal = poundsToPence(value.originalGrossMerchandiseTotal, 'Merchandise total')
  const shippingTotal = poundsToPence(value.shippingTotal ?? '0', 'Shipping')
  const discountTotal = poundsToPence(value.discountTotal ?? '0', 'Discount')
  const finalTotalPaid = poundsToPence(value.finalTotalPaid, 'Total paid')
  if (!Array.isArray(value.items) || value.items.length === 0) throw new PurchaseError('validation', 'Add at least one purchase item.')
  const items = value.items.map((raw: unknown, index) => {
    const row = index + 1
    if (!isRecord(raw)) throw new PurchaseError('validation', `Item ${row} is invalid.`)
    const sourceDescription = optionalText(raw.sourceDescription, `Item ${row} description`)
    if (!sourceDescription) throw new PurchaseError('validation', `Item ${row} description is required.`)
    if (!isNumber(raw.quantity) || !Number.isInteger(raw.quantity) || raw.quantity <= 0) throw new PurchaseError('validation', `Item ${row} quantity must be a positive whole number.`)
    const sourceSetNumber = optionalText(raw.sourceSetNumber, `Item ${row} LEGO set number`)
    const originalGrossUnitCost = poundsToPence(raw.originalGrossUnitCost, `Item ${row} unit cost`)
    const originalGrossLineTotal = poundsToPence(raw.originalGrossLineTotal, `Item ${row} line total`)
    return { sourceDescription, quantity: raw.quantity, originalGrossUnitCost, originalGrossLineTotal, ...(sourceSetNumber ? { sourceSetNumber } : {}) }
  })
  if (items.reduce((sum, item) => sum + item.originalGrossLineTotal, 0) !== originalGrossMerchandiseTotal) throw new PurchaseError('validation', 'Merchandise total must equal the sum of item line totals.')
  if (finalTotalPaid !== originalGrossMerchandiseTotal + shippingTotal - discountTotal) throw new PurchaseError('validation', 'Total paid must equal merchandise plus shipping minus discount.')
  return {
    sourceOrderReference,
    ...(sourceOrderDate ? { sourceOrderDate } : {}),
    ...(optionalText(value.merchantName, 'Supplier / Retailer') ? { merchantName: optionalText(value.merchantName, 'Supplier / Retailer') } : {}),
    ...(optionalText(value.sourceInvoiceReference, 'Invoice reference') ? { sourceInvoiceReference: optionalText(value.sourceInvoiceReference, 'Invoice reference') } : {}),
    ...(sourceDocumentDate ? { sourceDocumentDate } : {}),
    originalGrossMerchandiseTotal, shippingTotal, discountTotal, finalTotalPaid, items,
  }
}

export class PurchaseService implements AdminPurchasesApi {
  private readonly auth: AuthService

  constructor(auth: AuthService) { this.auth = auth }

  async getManualSupplierOptions(): Promise<ManualPurchaseSupplierOptions> {
    const response = await this.auth.authenticatedFetch('/purchases/manual-supplier-options')
    if (!response.ok) throw await responseError(response)
    return parseManualPurchaseSupplierOptions(await response.json())
  }

  async createManual(input: ManualPurchaseInput): Promise<ManualPurchaseCreated> {
    const response = await this.auth.authenticatedFetch('/purchases/manual', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validateManualPurchaseInput(input)),
    })
    if (!response.ok) throw await responseError(response)
    const value: unknown = await response.json()
    if (!isRecord(value) || !isRecord(value.purchase) || !positiveId(value.purchase.id) || !isString(value.purchase.sourceOrderReference)) throw new PurchaseError('malformed-response', 'The server returned an invalid manual purchase response.')
    const document = parseDocument(value, true)
    return { purchaseId: value.purchase.id, documentId: document.id }
  }

  private async reviewRequest(purchaseId: number, path = '', method = 'GET', body?: unknown): Promise<PurchaseReview> {
    const response = await this.auth.authenticatedFetch(`/purchases/${purchaseId}/review${path}`, {
      method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
    if (!response.ok) throw await responseError(response)
    return parseReview(await response.json())
  }
  review(purchaseId: number) { return this.reviewRequest(purchaseId) }
  amend(purchaseId: number, itemId: number, input: PurchaseAmendment) {
    return this.reviewRequest(purchaseId, `/items/${itemId}`, 'PATCH', input)
  }
  resolve(purchaseId: number, groupId: number, input: { revision: string; productListingId: number | null }) {
    return this.reviewRequest(purchaseId, `/groups/${groupId}/listing`, 'PATCH', input)
  }
  receive(purchaseId: number, groupId: number, input: { revision: string }) {
    return this.reviewRequest(purchaseId, `/groups/${groupId}/receive`, 'POST', input)
  }
  setInventoryDisposition(purchaseId: number, groupId: number, input: InventoryDispositionInput) {
    return this.reviewRequest(purchaseId, `/groups/${groupId}/disposition`, 'PATCH', validateInventoryDisposition(input))
  }
  async searchProducts(purchaseId: number, query: string): Promise<ReviewProduct[]> {
    const response = await this.auth.authenticatedFetch(`/purchases/${purchaseId}/review/products?q=${encodeURIComponent(query)}`)
    if (!response.ok) throw await responseError(response)
    const body: unknown = await response.json()
    if (!Array.isArray(body)) throw malformedReview()
    return body.map(parseReviewProduct)
  }
  async createListing(purchaseId: number, input: ReviewListingCreation) {
    const response = await this.auth.authenticatedFetch(`/purchases/${purchaseId}/review/listings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    })
    if (!response.ok) throw await responseError(response)
    return parseProduct(await response.json())
  }

  async importPdf(file: { bytes: Uint8Array; filename: string; mimeType: 'application/pdf' }): Promise<PurchaseImportResult> {
    const form = new FormData()
    form.append('file', new Blob([file.bytes.buffer as ArrayBuffer], { type: file.mimeType }), file.filename)
    let response: Response
    try {
      response = await this.auth.authenticatedFetch('/purchases/import', { method: 'POST', body: form })
    } catch (error) {
      if (!(error instanceof TypeError) && !(error instanceof AuthError && error.code === 'network')) throw error
      throw new PurchaseError('server', 'Could not reach the Colorful Life service. Check your connection and purchase history before retrying the import.')
    }
    if (!response.ok) {
      const error = await responseError(response, true)
      if (error.code === 'server') error.message += ' Check purchase history before retrying the import.'
      throw error
    }
    const value: unknown = await response.json()
    if (!isRecord(value) || !isString(value.message) || !isString(value.importHash)) throw new PurchaseError('malformed-response', 'The server returned an invalid import response.')
    return { message: value.message, importHash: value.importHash }
  }

  async list(page = 1, pageSize = 6, search?: string): Promise<PurchasePage> {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (search) params.set('search', search)
    const response = await this.auth.authenticatedFetch(`/purchases?${params.toString()}`)
    if (!response.ok) throw await responseError(response)
    return parsePage(await response.json())
  }

  async get(purchaseId: number): Promise<Purchase> {
    const response = await this.auth.authenticatedFetch(`/purchases/${purchaseId}`)
    if (!response.ok) throw await responseError(response)
    return parsePurchase(await response.json(), true)
  }

  async purchaseAnalyticsSummary(): Promise<PurchaseAnalyticsSummary> {
    const response = await this.auth.authenticatedFetch('/purchase-analytics')
    if (!response.ok) throw await analyticsResponseError(response)
    return parsePurchaseAnalyticsSummary(await response.json())
  }

  async supplierMonthlyAnalytics(supplierKey: string): Promise<SupplierMonthlyPurchaseAnalytics> {
    const response = await this.auth.authenticatedFetch(`/purchase-analytics/suppliers/${encodeURIComponent(supplierKey)}/monthly`)
    if (!response.ok) throw await analyticsResponseError(response)
    return parseSupplierMonthlyAnalytics(await response.json())
  }
}

const malformedReview = () => new PurchaseError('malformed-response', 'The server returned an invalid purchase review.')
const positiveId = (v: unknown): v is number => isNumber(v) && Number.isInteger(v) && v > 0
const moneyString = (v: unknown): v is string => isString(v) && /^\d+(\.\d{1,6})?$/.test(v)
function parseReviewProduct(value: unknown): ReviewProduct {
  if (!isRecord(value) || !positiveId(value.id) || !isString(value.setNumber) || !isString(value.title)) throw malformedReview()
  return { id: value.id, setNumber: value.setNumber, title: value.title }
}
export function parseReview(value: unknown): PurchaseReview {
  if (!isRecord(value) || !isString(value.revision) || !/^[a-f0-9]{64}$/.test(value.revision) || !moneyString(value.totalCost) || !Array.isArray(value.groups)) throw malformedReview()
  const purchase = parsePurchase(value.purchase, true)
  const groups = value.groups.map((g: unknown): ReviewGroup => {
    if (!isRecord(g) || !positiveId(g.id) || !Array.isArray(g.sourceItemIds) || !g.sourceItemIds.every(positiveId) ||
      !isString(g.description) || !isNullableString(g.externalProductId) || !isNullableString(g.sourceSetNumber) ||
      !positiveId(g.quantity) || !isNumber(g.pendingQuantity) || !Number.isInteger(g.pendingQuantity) || g.pendingQuantity < 0 || g.pendingQuantity > g.quantity ||
      !moneyString(g.totalCost) || !moneyString(g.unitCost) || (g.costKind !== 'UNIT' && g.costKind !== 'WEIGHTED_AVERAGE') ||
      !['UNRESOLVED', 'MATCHED', 'RECEIVED', 'EXCLUDED'].includes(String(g.state)) ||
      !['INVENTORY', 'NON_INVENTORY', 'MIXED'].includes(String(g.inventoryDisposition)) || typeof g.canResolve !== 'boolean' || !Array.isArray(g.lines)) throw malformedReview()
    let listing: ReviewGroup['listing'] = null
    if (g.listing !== null) {
      if (!isRecord(g.listing) || (g.listing.condition !== 'NEW' && g.listing.condition !== 'USED_LIKE_NEW') || typeof g.listing.active !== 'boolean') throw malformedReview()
      listing = { ...parseReviewProduct(g.listing), condition: g.listing.condition, active: g.listing.active }
    }
    const lines = g.lines.map((l: unknown) => {
      if (!isRecord(l) || !positiveId(l.purchaseDocumentId) || typeof l.canAmend !== 'boolean' || typeof l.canAmendCost !== 'boolean') throw malformedReview()
      return { ...parseItem(l), purchaseDocumentId: l.purchaseDocumentId, canAmend: l.canAmend, canAmendCost: l.canAmendCost }
    })
    const sourceItemIds = g.sourceItemIds
    if (!lines.length || lines.length !== sourceItemIds.length || lines.some((l, i) => l.id !== sourceItemIds[i]) ||
      lines.reduce((n, l) => n + l.quantity, 0) !== g.quantity) throw malformedReview()
    return { id: g.id, sourceItemIds: g.sourceItemIds, description: g.description, externalProductId: g.externalProductId,
      sourceSetNumber: g.sourceSetNumber, quantity: g.quantity, pendingQuantity: g.pendingQuantity, totalCost: g.totalCost,
      unitCost: g.unitCost, costKind: g.costKind, listing, state: g.state as ReviewGroup['state'], inventoryDisposition: g.inventoryDisposition as ReviewGroup['inventoryDisposition'], canResolve: g.canResolve, lines }
  })
  return { purchase, revision: value.revision, totalCost: value.totalCost, groups }
}

export function validateReviewInput(value: unknown): { revision: string } {
  if (!isRecord(value) || !isString(value.revision) || !/^[a-f0-9]{64}$/.test(value.revision)) throw new PurchaseError('validation', 'Invalid review revision')
  return { revision: value.revision }
}
export function validateReceipt(value: unknown) {
  const revision = validateReviewInput(value)
  if (!isRecord(value) || Object.keys(value).some(k => k !== 'revision')) throw new PurchaseError('validation', 'Receiving accepts only a review revision')
  return revision
}
export function validateAmendment(value: unknown): PurchaseAmendment {
  const revision = validateReviewInput(value)
  if (!isRecord(value) || Object.keys(value).some(k => !['revision', 'sourceDescription', 'sourceSetNumber', 'quantity', 'originalGrossUnitCost'].includes(k)) ||
    !isString(value.sourceDescription) || !isNullableString(value.sourceSetNumber) ||
    (value.quantity !== undefined && !positiveId(value.quantity)) ||
    (value.originalGrossUnitCost !== undefined && !moneyString(value.originalGrossUnitCost))) throw new PurchaseError('validation', 'Invalid amendment')
  return { ...revision, sourceDescription: value.sourceDescription, sourceSetNumber: value.sourceSetNumber,
    ...(value.quantity === undefined ? {} : { quantity: value.quantity }),
    ...(value.originalGrossUnitCost === undefined ? {} : { originalGrossUnitCost: value.originalGrossUnitCost }) }
}
export function validateResolution(value: unknown) {
  const revision = validateReviewInput(value)
  if (!isRecord(value) || Object.keys(value).some(k => !['revision', 'productListingId'].includes(k)) ||
    (value.productListingId !== null && !positiveId(value.productListingId))) throw new PurchaseError('validation', 'Invalid listing selection')
  return { ...revision, productListingId: value.productListingId }
}
export function validateInventoryDisposition(value: unknown): InventoryDispositionInput {
  const revision = validateReviewInput(value)
  if (!isRecord(value) || Object.keys(value).some(k => !['revision', 'inventoryDisposition'].includes(k)) ||
    (value.inventoryDisposition !== 'INVENTORY' && value.inventoryDisposition !== 'NON_INVENTORY')) {
    throw new PurchaseError('validation', 'Invalid inventory disposition')
  }
  return { ...revision, inventoryDisposition: value.inventoryDisposition }
}
export function validateListingCreation(value: unknown): ReviewListingCreation {
  if (isRecord(value) && !hasValidListingPrices(value)) throw new PurchaseError('validation', priceValidationMessage)
  if (!isRecord(value) || value.currentStock !== 0 || (value.condition !== 'NEW' && value.condition !== 'USED_LIKE_NEW') ||
    !isNumber(value.originalPrice) || (value.salePrice != null && !isNumber(value.salePrice))) throw new PurchaseError('validation', 'Invalid purchase listing')
  const price: Pick<ReviewListingCreation, 'currentStock' | 'condition' | 'originalPrice' | 'salePrice'> = { currentStock: 0 as const, condition: value.condition, originalPrice: value.originalPrice,
    ...(value.salePrice === undefined ? {} : { salePrice: value.salePrice }) }
  if (positiveId(value.existingProductId)) return { ...price, existingProductId: value.existingProductId }
  if (!isString(value.setNumber) || !isString(value.title) || !isString(value.theme) || !positiveId(value.categoryId) ||
    !isString(value.ageRecommendation) || !positiveId(value.pieceCount) || (value.description !== undefined && !isString(value.description))) throw new PurchaseError('validation', 'Invalid new product')
  return { ...price, setNumber: value.setNumber, title: value.title, theme: value.theme, categoryId: value.categoryId,
    ageRecommendation: value.ageRecommendation, pieceCount: value.pieceCount, ...(value.description === undefined ? {} : { description: value.description }) }
}
