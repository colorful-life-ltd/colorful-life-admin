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
