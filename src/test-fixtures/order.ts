import type { OrderDetail, OrderPage } from '../../electron/order-contract'
export const order: OrderDetail = {
  id: 41, user: { id: 2, firstName: 'Sam', lastName: 'Buyer', email: 'buyer@example.com' },
  status: 'CONFIRMED', totalAmount: '25', currency: 'GBP', createdAt: '2026-10-13T10:00:00Z',
  payment: { status: 'SUCCEEDED', currency: 'GBP', paidAt: '2026-10-13T10:01:00Z' }, paymentStatus: 'SUCCEEDED',
  fulfilmentStage: 'CONFIRMED', preparingAt: null, dispatchedAt: null, shippingCarrier: null, trackingNumber: null,
  cancelledAt: null, actualShippingCost: null,
  deliveryRecipientName: 'Sam Buyer', deliveryLine1: '1 Test Street', deliveryLine2: null,
  deliveryCity: 'London', deliveryCounty: null, deliveryPostcode: 'E1 1AA', deliveryCountryCode: 'GB', deliveryPhone: null,
  orderItems: [{ id: 3, quantity: 2, unitPrice: '12.5', lineTotal: '25', productListing: { id: 4, condition: 'NEW', legoProduct: { id: 5, setNumber: '12345', title: 'Test LEGO set' } } }],
  fulfilment: { stage: 'CONFIRMED', preparingAt: null, dispatchedAt: null, shipments: [] }, fulfilmentEvents: [],
}
export const orderPage: OrderPage = { items: [order], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } }

export const payment = { id: 7, orderId: 41, amount: '25', currency: 'GBP', provider: 'STRIPE', status: 'SUCCEEDED' as const, paidAt: '2026-10-13T10:01:00Z', refundedAmount: '0', reservedRefundAmount: '0' }
export const refund = { id: 8, orderId: 41, paymentId: 7, amount: '5', currency: 'GBP', provider: 'STRIPE', status: 'SUCCEEDED' as const, createdAt: '2026-10-14T10:01:00Z', reason: 'Return adjustment', performedByUserId: 1, resolutionCode: 'REFUND_SUCCEEDED', reviewRequired: false }
export const financials = { payment: { state: 'ready' as const, value: payment }, refunds: { state: 'ready' as const, value: [] }, consistent: true }
