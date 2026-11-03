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
  tracking?: {progress: 'DISPATCHED'|'IN_TRANSIT'|'DELIVERED';deliveredAt:string|null;deliveryConfirmation?:'MANUAL'|'CARRIER'|null}
  sequence: number; carrier: Carrier | null; carrierName: string; trackingNumber: string | null
  dispatchedAt: string; trackingUrl: string | null; trackingUrlIncludesNumber: boolean
}
export interface OrderDetail extends OrderSummary {
  cancelledAt: string | null
  actualShippingCost: string | null
  deliveryRecipientName: string; deliveryLine1: string; deliveryLine2: string | null
  deliveryCity: string; deliveryCounty: string | null; deliveryPostcode: string; deliveryCountryCode: string; deliveryPhone: string | null
  orderItems: Array<{ id: number; quantity: number; unitPrice: string; lineTotal: string; productListing: { id: number; condition: string; legoProduct: { id: number; setNumber: string; title: string } } }>
  financials?: { shipping: { chargePence: number } | null }
  fulfilment: { stage: FulfilmentStage; preparingAt: string | null; dispatchedAt: string | null; shipments: Shipment[] }
  /** Operator-confirmed manual deliveries (Backend OperationalAudit); absent on older Backends. */
  deliveryConfirmations?: DeliveryConfirmation[]
  fulfilmentEvents: Array<{ id: number; action: string; fromStage: FulfilmentStage; toStage: FulfilmentStage; source: string; createdAt: string; performedByUser: { id: number; email: string } }>
}
export interface DeliveryConfirmation { shipmentId: number; shipmentSequence: number | null; confirmedAt: string; source: 'MANUAL_OPERATOR_CONFIRMATION'; performedByUser: { id: number; email: string | null } | null }
export interface OrderPage { items: OrderSummary[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } }
export interface DispatchInput { carrier: Carrier; carrierName?: string; trackingNumber: string; actualShippingCost: number }
export interface AdminOrdersApi {
  financials(id: number): Promise<import('./order-financials.js').OrderFinancials>
  paymentEnvironment(): Promise<import('./payment-environment.js').PaymentEnvironment>
  list(page?: number, pageSize?: number): Promise<OrderPage>
  get(id: number): Promise<OrderDetail>
  preparing(id: number): Promise<OrderDetail>
  dispatch(id: number, input: DispatchInput): Promise<OrderDetail>
  /** DISPATCHED -> DELIVERED after the operator checked the carrier's tracking website. */
  delivered(id: number): Promise<OrderDetail>
  cancel(id: number, reason: CancellationReason): Promise<void>
}
/** Shipping cost above £15.00 (1500 pence) needs explicit operator approval; exactly £15.00 does not. */
export const SHIPPING_APPROVAL_THRESHOLD_PENCE = 1500
export const requiresShippingApproval = (pence: number) => pence > SHIPPING_APPROVAL_THRESHOLD_PENCE
export const canFulfil = (order: OrderSummary) => order.status === 'CONFIRMED' && order.payment?.status === 'SUCCEEDED' && !!order.payment.paidAt
/** Manual delivery confirmation: dispatched, with a shipment record, and not already delivered. */
export const canMarkDelivered = (order: OrderDetail) => order.status === 'DISPATCHED' && !!order.dispatchedAt && order.fulfilment.shipments.length > 0 && order.fulfilment.stage !== 'DELIVERED'
export const canCancel = (order: OrderDetail) => ['PENDING', 'CONFIRMED'].includes(order.status) && order.payment === null && order.cancelledAt === null
