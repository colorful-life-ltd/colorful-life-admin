export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'DISPATCHED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED' | 'RETURNED'
export type FulfilmentStage = 'CONFIRMED' | 'PREPARING' | 'DISPATCHED' | 'IN_TRANSIT' | 'DELIVERED' | null
export type Carrier = 'ROYAL_MAIL' | 'EVRI' | 'DPD' | 'OTHER'
export const cancellationReasons = ['OUT_OF_STOCK', 'PRICING_ERROR', 'PRODUCT_UNAVAILABLE', 'FULFILMENT_ISSUE', 'OTHER'] as const
export type CancellationReason = typeof cancellationReasons[number]
export interface OrderSummary {
  id: number
  user: { id: number; firstName: string | null; lastName: string | null; email: string }
  status: OrderStatus
  totalAmount: string
  currency: string
  createdAt: string
  payment: { status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED'; currency: string; paidAt: string | null } | null
  paymentStatus: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | null
  fulfilmentStage: FulfilmentStage
  preparingAt: string | null
  dispatchedAt: string | null
  shippingCarrier: string | null
  trackingNumber: string | null
}
export interface Shipment {
  tracking?: {progress: 'DISPATCHED'|'IN_TRANSIT'|'DELIVERED';deliveredAt:string|null}
  sequence: number; carrier: Carrier | null; carrierName: string; trackingNumber: string | null
  dispatchedAt: string; trackingUrl: string | null; trackingUrlIncludesNumber: boolean
}
export interface OrderDetail extends OrderSummary {
  cancelledAt: string | null
  actualShippingCost: string | null
  deliveryRecipientName: string; deliveryLine1: string; deliveryLine2: string | null
  deliveryCity: string; deliveryCounty: string | null; deliveryPostcode: string; deliveryCountryCode: string; deliveryPhone: string | null
  orderItems: Array<{ id: number; quantity: number; unitPrice: string; lineTotal: string; productListing: { id: number; condition: string; legoProduct: { id: number; setNumber: string; title: string } } }>
  fulfilment: { stage: FulfilmentStage; preparingAt: string | null; dispatchedAt: string | null; shipments: Shipment[] }
  fulfilmentEvents: Array<{ id: number; action: string; fromStage: FulfilmentStage; toStage: FulfilmentStage; source: string; createdAt: string; performedByUser: { id: number; email: string } }>
}
export interface OrderPage { items: OrderSummary[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } }
export interface DispatchInput { carrier: Carrier; carrierName?: string; trackingNumber: string; actualShippingCost: number }
export interface AdminOrdersApi {
  financials(id: number): Promise<import('./order-financials.js').OrderFinancials>
  list(page?: number, pageSize?: number): Promise<OrderPage>
  get(id: number): Promise<OrderDetail>
  preparing(id: number): Promise<OrderDetail>
  dispatch(id: number, input: DispatchInput): Promise<OrderDetail>
  cancel(id: number, reason: CancellationReason): Promise<void>
}
export const canFulfil = (order: OrderSummary) => order.status === 'CONFIRMED' && order.payment?.status === 'SUCCEEDED' && !!order.payment.paidAt
export const canCancel = (order: OrderDetail) => ['PENDING', 'CONFIRMED'].includes(order.status) && order.payment === null && order.cancelledAt === null
