export interface PurchaseItem {
  id: number
  productListingId: number | null
  inventoryDisposition: 'INVENTORY' | 'NON_INVENTORY'
  externalProductId: string | null
  sourceDescription: string
  sourceSetNumber: string | null
  sourceLineNumber: number | null
  quantity: number
  originalGrossUnitCost: string
  originalGrossLineTotal: string
  allocatedShipping: string
  allocatedDiscount: string
  finalLineCost: string
  finalUnitCost: string
  receivedAt: string | null
  returnedAt: string | null
}

export interface PurchaseDocument {
  id: number
  purchaseId: number
  partNumber: number
  sourceInvoiceReference: string | null
  importHash: string
  sourceDocumentDate: string | null
  importedByUserId: number
  originalGrossMerchandiseTotal: string
  shippingTotal: string
  discountTotal: string
  finalTotalPaid: string
  createdAt: string
  updatedAt: string
  purchaseItems?: PurchaseItem[]
}

export interface Purchase {
  id: number
  sourceOrderReference: string
  sourceOrderDate: string | null
  merchantName: string | null
  createdAt: string
  updatedAt: string
  purchaseDocuments: PurchaseDocument[]
}

export interface PurchasePage {
  purchases: Purchase[]
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number; limit: number; total: number }
}

/** Monetary totals are backend-calculated decimal strings; the renderer only formats them. */
export interface PurchaseAnalyticsSummary {
  totalQuantity: number
  totalAmount: string
  suppliers: Array<{
    supplierKey: string
    supplierName: string
    totalAmount: string
  }>
}

export interface SupplierMonthlyPurchaseAnalytics {
  supplierKey: string
  supplierName: string
  months: Array<{
    month: string
    totalAmount: string
  }>
  undatedTotalAmount: string
}

export interface PurchaseImportResult {
  message: string
  importHash: string
}

/** Supplier choices are owned by the backend for manual purchase entry. */
export interface ManualPurchaseSupplierOptions {
  canonicalSuppliers: string[]
  customSupplierOption: string
}

/** Monetary values are entered in pounds in the renderer and converted to pence by PurchaseService. */
export interface ManualPurchaseInput {
  sourceOrderReference: string
  sourceOrderDate?: string
  merchantName?: string
  sourceInvoiceReference?: string
  sourceDocumentDate?: string
  originalGrossMerchandiseTotal: string
  shippingTotal: string
  discountTotal: string
  finalTotalPaid: string
  items: Array<{
    sourceDescription: string
    quantity: number
    originalGrossUnitCost: string
    originalGrossLineTotal: string
    sourceSetNumber?: string
  }>
}

export interface ManualPurchaseCreated { purchaseId: number; documentId: number }

export interface AdminPurchasesApi {
  getManualSupplierOptions(): Promise<ManualPurchaseSupplierOptions>
  createManual(input: ManualPurchaseInput): Promise<ManualPurchaseCreated>
  review(purchaseId: number): Promise<PurchaseReview>
  amend(purchaseId: number, itemId: number, input: PurchaseAmendment): Promise<PurchaseReview>
  resolve(purchaseId: number, groupId: number, input: { revision: string; productListingId: number | null }): Promise<PurchaseReview>
  setInventoryDisposition(purchaseId: number, groupId: number, input: InventoryDispositionInput): Promise<PurchaseReview>
  receive(purchaseId: number, groupId: number, input: { revision: string }): Promise<PurchaseReview>
  searchProducts(purchaseId: number, query: string): Promise<ReviewProduct[]>
  createListing(purchaseId: number, input: ReviewListingCreation): Promise<import('./product-contract.js').ProductListing>
  importPdf(file: { bytes: Uint8Array; filename: string; mimeType: 'application/pdf' }): Promise<PurchaseImportResult>
  list(page?: number, pageSize?: number, search?: string): Promise<PurchasePage>
  get(purchaseId: number): Promise<Purchase>
  purchaseAnalyticsSummary(): Promise<PurchaseAnalyticsSummary>
  supplierMonthlyAnalytics(supplierKey: string): Promise<SupplierMonthlyPurchaseAnalytics>
}

export interface ReviewProduct { id: number; setNumber: string; title: string }
export type ReviewListingCreation = {
  condition: 'NEW' | 'USED_LIKE_NEW'; originalPrice: number; salePrice?: number | null; currentStock: 0
} & ({ existingProductId: number } | {
  setNumber: string; title: string; description?: string; theme: string; categoryId: number; ageRecommendation: string; pieceCount: number
})
export interface PurchaseAmendment {
  revision: string; sourceDescription: string; sourceSetNumber: string | null
  quantity?: number; originalGrossUnitCost?: string
}
export interface InventoryDispositionInput {
  revision: string
  inventoryDisposition: 'INVENTORY' | 'NON_INVENTORY'
}
export interface ReviewLine extends PurchaseItem {
  purchaseDocumentId: number; canAmend: boolean; canAmendCost: boolean
}
export interface ReviewGroup {
  id: number; sourceItemIds: number[]; description: string
  externalProductId: string | null; sourceSetNumber: string | null
  quantity: number; pendingQuantity: number; totalCost: string; unitCost: string
  costKind: 'UNIT' | 'WEIGHTED_AVERAGE'
  listing: (ReviewProduct & { condition: 'NEW' | 'USED_LIKE_NEW'; active: boolean }) | null
  state: 'UNRESOLVED' | 'MATCHED' | 'RECEIVED' | 'EXCLUDED';
  inventoryDisposition: 'INVENTORY' | 'NON_INVENTORY' | 'MIXED'
  canResolve: boolean; lines: ReviewLine[]
}
export interface PurchaseReview {
  purchase: Purchase; revision: string; totalCost: string; groups: ReviewGroup[]
}
