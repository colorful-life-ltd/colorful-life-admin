export interface StockQuantities { productListingId: number; currentStock: number; reservedStock: number; availableStock: number }
export interface InventoryListing extends StockQuantities { productId: number; setNumber: string; title: string; condition: 'NEW' | 'USED_LIKE_NEW'; active: boolean; discrepancies?: {id:number;quantity:number;appliedQuantity:number;shortfall:number;shipmentReference:string}[] }
export interface InventoryPage { items: InventoryListing[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } }
export interface InventoryMovement { id: number; listingId: number; quantityChange: number; type: string; note: string; performedByUserId: number; createdAt: string; fbaOutbound?: { id: number; shipmentReference: string; idempotencyKey: string } | null }
export interface ShipmentInput { productListingId: number; quantity: number; shipmentReference: string; note: string }
export interface ShipmentRequest extends ShipmentInput { idempotencyKey: string }
export interface OutboundRecord extends ShipmentRequest { id: number; appliedQuantity: number; shortfall: number; performedByUserId: number; createdAt: string; movement: InventoryMovement }
export interface OutboundAudit { outbound: OutboundRecord; inventory: StockQuantities }
export interface OutboundResult extends OutboundAudit { replayed: boolean }
export interface PendingShipment { request: ShipmentRequest; state: 'prepared' | 'uncertain' | 'rejected' | 'confirmed'; result?: OutboundResult }
export interface AdminInventoryApi {
  list(page?: number): Promise<InventoryPage>
  movements(listingId: number): Promise<InventoryMovement[]>
  getOutbound(id: number): Promise<OutboundAudit>
  pending(): Promise<PendingShipment | null>
  prepare(input: ShipmentInput): Promise<PendingShipment>
  submit(key: string): Promise<PendingShipment>
  finish(key: string): Promise<void>
}
