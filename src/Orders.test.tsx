import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Orders from './Orders'
import { order, orderPage, financials, payment, refund } from './test-fixtures/order'
import { serializeIpcError } from '../electron/ipc-error-contract'
import { parseRefunds } from '../electron/order-financials'
import type { OrderDetail } from '../electron/order-contract'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  window.adminOrders = { financials: vi.fn().mockResolvedValue(financials), paymentEnvironment: vi.fn().mockResolvedValue({stripeEnvironment:'TEST',refundReconciliationEnabled:true}), list: vi.fn().mockResolvedValue(orderPage), get: vi.fn().mockResolvedValue(order), preparing: vi.fn().mockResolvedValue(order), dispatch: vi.fn().mockResolvedValue(order), delivered: vi.fn().mockResolvedValue(order), cancel: vi.fn().mockResolvedValue(undefined) }
})
afterEach(cleanup)
const open = async (value: OrderDetail = order) => {
  vi.mocked(window.adminOrders.get).mockResolvedValue(value)
  render(<Orders />)
  fireEvent.click(await screen.findByRole('button', { name: 'View order #41' }))
  await screen.findByText('Test LEGO set', { exact: false })
}
const confirm = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })
const fillDispatch = () => {
  fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: 'ab 123456789 gb' } })
  fireEvent.change(screen.getByLabelText('Actual shipping cost'), { target: { value: '3.5' } })
}
it('renders loading, list, details, product prices and delivery snapshot', async () => {
  let resolve!: (v: typeof orderPage) => void
  vi.mocked(window.adminOrders.list).mockImplementation(() => new Promise(r => { resolve = r }))
  render(<Orders />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading orders')
  await waitFor(() => expect(window.adminOrders.list).toHaveBeenCalled())
  await act(async () => resolve(orderPage))
  expect(screen.getByRole('cell', { name: /Sam Buyer/ })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'View order #41' }))
  expect(await screen.findByText(/1 Test Street/)).toBeInTheDocument()
  expect(screen.getByText(/Test LEGO set/)).toBeInTheDocument()
  expect(screen.getByText('No shipment recorded.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Cancel Order' })).not.toBeInTheDocument()
})
it('handles empty list and pagination using supported parameters', async () => {
  vi.mocked(window.adminOrders.list).mockResolvedValueOnce({ ...orderPage, pagination: { page: 1, pageSize: 20, totalItems: 21, totalPages: 2 } }).mockResolvedValueOnce({ items: [], pagination: { page: 2, pageSize: 20, totalItems: 21, totalPages: 2 } })
  render(<Orders />)
  await screen.findByRole('button', { name: 'View order #41' })
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(await screen.findByText('No orders found.')).toBeInTheDocument()
  expect(window.adminOrders.list).toHaveBeenLastCalledWith(2, 20)
})
it('shows network errors and allows refresh retry', async () => {
  vi.mocked(window.adminOrders.list).mockRejectedValueOnce(new Error('Unable to reach service'))
  render(<Orders />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to reach service')
  fireEvent.click(screen.getByRole('button', { name: 'Refresh orders' }))
  expect(await screen.findByRole('button', { name: 'View order #41' })).toBeInTheDocument()
})
it('requires confirmation for Preparing and refreshes state after success', async () => {
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Mark as Preparing' }))
  expect(window.adminOrders.preparing).not.toHaveBeenCalled()
  const updated = { ...order, preparingAt: '2026-10-13T11:00:00Z', fulfilmentStage: 'PREPARING' as const }
  vi.mocked(window.adminOrders.get).mockResolvedValue(updated)
  fireEvent.click(confirm())
  expect(await screen.findByText('Order marked as Preparing.')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark as Preparing' })).not.toBeInTheDocument())
  expect(window.adminOrders.preparing).toHaveBeenCalledOnce()
  expect(window.adminOrders.get).toHaveBeenCalledTimes(2)
})
it('validates dispatch, blocks duplicate submissions and rereads successful shipment', async () => {
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Shipment' }))
  fillDispatch()
  fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: 'bad' } })
  fireEvent.click(confirm())
  expect(await screen.findByRole('alert')).toHaveTextContent('valid tracking number')
  expect(window.adminOrders.dispatch).not.toHaveBeenCalled()
  fillDispatch()
  let resolve!: (value: OrderDetail) => void
  vi.mocked(window.adminOrders.dispatch).mockImplementation(() => new Promise(r => { resolve = r }))
  const form = confirm().closest('form')!
  fireEvent.submit(form); fireEvent.submit(form)
  expect(window.adminOrders.dispatch).toHaveBeenCalledOnce()
  expect(window.adminOrders.dispatch).toHaveBeenCalledWith(41, { carrier: 'ROYAL_MAIL', trackingNumber: 'AB123456789GB', actualShippingCost: 3.5 })
  expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Go back' })).toBeDisabled()
  vi.mocked(window.adminOrders.get).mockResolvedValue({ ...order, status: 'DISPATCHED', fulfilmentStage: 'DISPATCHED' })
  await act(async () => resolve(order))
  expect(await screen.findByText('Shipment confirmed.')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm Shipment' })).not.toBeInTheDocument())
})
it('validates Other carrier names and can dismiss without mutation', async () => {
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Shipment' }))
  fireEvent.change(screen.getByLabelText('Carrier'), { target: { value: 'OTHER' } })
  expect(screen.getByLabelText('Carrier name')).toBeRequired()
  fillDispatch()
  fireEvent.submit(confirm().closest('form')!)
  expect(await screen.findByRole('alert')).toHaveTextContent('carrier name')
  fireEvent.click(screen.getByRole('button', { name: 'Go back' }))
  expect(window.adminOrders.dispatch).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('refreshes on 409 and removes newly unavailable actions', async () => {
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Mark as Preparing' }))
  vi.mocked(window.adminOrders.preparing).mockResolvedValue(serializeIpcError(Object.assign(new Error('Payment is not eligible for fulfilment'), { status: 409, code: 'api', backendCode: 'ORDER_PAYMENT_NOT_VERIFIED' })) as unknown as OrderDetail)
  vi.mocked(window.adminOrders.get).mockResolvedValue({ ...order, status: 'CANCELLED', fulfilmentStage: null })
  fireEvent.click(confirm())
  expect(await screen.findByRole('alert')).toHaveTextContent('Payment is not eligible')
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm Shipment' })).not.toBeInTheDocument())
  expect(window.adminOrders.get).toHaveBeenCalledTimes(2)
})
it('shows a payment security hold, closes confirmation and refreshes without retrying dispatch', async () => {
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Shipment' }))
  fillDispatch()
  vi.mocked(window.adminOrders.dispatch).mockResolvedValue(serializeIpcError(Object.assign(new Error('Dispatch is blocked by a payment security review. This hold cannot be released here. Wait until the review is resolved before trying again.'), { status: 409, code: 'api', backendCode: 'SECURITY_REVIEW_REQUIRED' })) as unknown as OrderDetail)
  fireEvent.click(confirm())
  expect(await screen.findByRole('alert')).toHaveTextContent('Dispatch is blocked by a payment security review')
  await waitFor(() => expect(window.adminOrders.get).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(window.adminOrders.dispatch).toHaveBeenCalledOnce()
  expect(window.adminOrders.cancel).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: /release/i })).not.toBeInTheDocument()
})
it('cancels only no-payment orders after explicit confirmation and blocks repeats', async () => {
  await open({ ...order, status: 'PENDING', fulfilmentStage: null, payment: null, paymentStatus: null })
  expect(screen.queryByRole('button', { name: 'Confirm Shipment' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Order' }))
  expect(window.adminOrders.cancel).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Cancellation reason'), { target: { value: 'FULFILMENT_ISSUE' } })
  let resolve!: () => void
  vi.mocked(window.adminOrders.cancel).mockImplementation(() => new Promise<void>(r => { resolve = r }))
  const form = confirm().closest('form')!
  fireEvent.submit(form); fireEvent.submit(form)
  expect(window.adminOrders.cancel).toHaveBeenCalledOnce()
  expect(window.adminOrders.cancel).toHaveBeenCalledWith(41, 'FULFILMENT_ISSUE')
  vi.mocked(window.adminOrders.get).mockResolvedValue({ ...order, status: 'CANCELLED', fulfilmentStage: null, cancelledAt: '2026-10-13T11:00:00Z' })
  await act(async () => resolve())
  expect(await screen.findByText('Order cancelled. No refund was performed.')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel Order' })).not.toBeInTheDocument())
})
it('handles cancellation payment races with a refresh', async () => {
  await open({ ...order, payment: null, paymentStatus: null })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Order' }))
  vi.mocked(window.adminOrders.cancel).mockResolvedValue(serializeIpcError(Object.assign(new Error('Order already paid'), { status: 409, code: 'api', backendCode: 'ORDER_ALREADY_PAID' })) as unknown as void)
  vi.mocked(window.adminOrders.get).mockResolvedValue(order)
  fireEvent.click(confirm())
  expect(await screen.findByRole('alert')).toHaveTextContent('Order already paid')
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel Order' })).not.toBeInTheDocument())
})
it('retains action drafts on network failure and distinguishes a failed post-success refresh', async () => {
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Shipment' }))
  fillDispatch()
  vi.mocked(window.adminOrders.dispatch).mockRejectedValueOnce(new Error('Network unavailable'))
  fireEvent.click(confirm())
  expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable')
  expect(screen.getByLabelText('Tracking number')).toHaveValue('ab 123456789 gb')
  vi.mocked(window.adminOrders.get).mockRejectedValueOnce(new Error('Read failed'))
  fireEvent.click(confirm())
  expect(await screen.findByRole('alert')).toHaveTextContent('Action succeeded, but refreshing the order failed')
  expect(screen.queryByRole('button', { name: 'Confirm Shipment' })).not.toBeInTheDocument()
})
it('renders historical shipments from fulfilment projection and audit events', async () => {
  await open({ ...order, status: 'DISPATCHED', fulfilmentStage: 'DISPATCHED', fulfilment: { ...order.fulfilment, stage: 'DISPATCHED', shipments: [{ sequence: 1, carrier: 'EVRI', carrierName: 'Evri', trackingNumber: '1234567890123456', dispatchedAt: '2026-10-13T11:00:00Z', trackingUrl: 'https://www.evri.com/track-a-parcel', trackingUrlIncludesNumber: false }] }, fulfilmentEvents: [{ id: 1, action: 'DISPATCHED', fromStage: 'PREPARING', toStage: 'DISPATCHED', source: 'ADMIN_FULFILMENT_API', createdAt: '2026-10-13T11:00:00Z', performedByUser: { id: 1, email: 'admin@example.com' } }] })
  expect(screen.getByRole('link', { name: 'Track shipment 1' })).toHaveAttribute('href', 'https://www.evri.com/track-a-parcel')
  expect(screen.getByText(/Enter the displayed tracking number/)).toBeInTheDocument()
  expect(screen.getByText(/admin@example.com/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Confirm Shipment' })).not.toBeInTheDocument()
})

it('closes the native dialog during the session warning and restores the draft after renewal', async () => {
  const view = render(<Orders />)
  fireEvent.click(await screen.findByRole('button', { name: 'View order #41' }))
  await screen.findByText(/Test LEGO set/)
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Shipment' }))
  fillDispatch()
  view.rerender(<Orders sessionBlocked />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  view.rerender(<Orders sessionBlocked={false} />)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByLabelText('Tracking number')).toHaveValue('ab 123456789 gb')
  expect(window.adminOrders.dispatch).not.toHaveBeenCalled()
})

it.each([
  ['partial', '5', '0', [{ ...refund }], false],
  ['full', '25', '0', [{ ...refund, amount: '25' }], true],
  ['pending', '0', '5', [{ ...refund, status: 'PROCESSING', resolutionCode: 'PROVIDER_PENDING' }], true],
  ['unknown', '0', '5', [{ ...refund, status: 'PROCESSING', resolutionCode: 'PROVIDER_OUTCOME_UNKNOWN' }], true],
  ['review', '5', '0', [{ ...refund, reviewRequired: true, resolutionCode: 'TERMINAL_EVIDENCE_CONFLICT' }], true],
])('shows %s refunds without confusing recorded payment status and dispatch eligibility', async (_name, refundedAmount, reservedRefundAmount, rows, blocked) => {
  vi.mocked(window.adminOrders.financials).mockResolvedValue({ ...financials, payment: { state: 'ready', value: { ...payment, refundedAmount, reservedRefundAmount } }, refunds: { state: 'ready', value: parseRefunds(rows, 41) } })
  await open()
  const section = screen.getByRole('region', { name: 'Payment and refunds' })
  expect(within(section).getByText('STRIPE')).toBeInTheDocument()
  expect(within(section).getAllByText('£25.00 GBP').length).toBeGreaterThan(0)
  expect(within(section).getByText(/Admin #1/)).toBeInTheDocument()
  expect(within(section).getByText(/Return adjustment/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Confirm Shipment' }).hasAttribute('disabled')).toBe(blocked)
  expect(screen.getByRole('button', { name: 'Mark as Preparing' }).hasAttribute('disabled')).toBe(blocked)
  if (_name === 'partial') expect(screen.getByText('Partially refunded payment.')).toBeInTheDocument()
  if (_name === 'unknown') expect(screen.getByText(/no definitive outcome confirmed/)).toBeInTheDocument()
  if (_name === 'review') expect(screen.getByText(/outcome must not be treated as conclusive/)).toBeInTheDocument()
})
it('shows a successful empty history and zero amounts in major units', async () => {
  await open()
  expect(screen.getByText('No refund history recorded in this read.')).toBeInTheDocument()
  expect(screen.getAllByText('£0.00 GBP')).toHaveLength(2)
  expect(within(screen.getByRole('region', { name: 'Payment and refunds' })).getByText('£25.00 GBP')).toBeInTheDocument()
})
it('does not turn failed history into an empty list and refreshes both reads', async () => {
  vi.mocked(window.adminOrders.financials).mockResolvedValueOnce({ ...financials, consistent: false, refunds: { state: 'error', message: 'Refund history could not be read. Refresh to retry.' } })
  await open()
  expect(screen.getByRole('alert')).toHaveTextContent('Refund history could not be read')
  expect(screen.queryByText('No refund history recorded in this read.')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Confirm Shipment' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh order' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm Shipment' })).toBeEnabled())
  expect(window.adminOrders.financials).toHaveBeenCalledTimes(2)
})
it('shows incomplete reads on authorization failure without preserving financial details', async () => {
  vi.mocked(window.adminOrders.financials).mockRejectedValue(new Error('Forbidden'))
  await open()
  expect(screen.getByText(/Financial information is incomplete/)).toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: 'Payment and refunds' })).queryByText('£25.00 GBP')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Confirm Shipment' })).toBeDisabled()
})
it('warns for mismatched snapshots instead of presenting them as ready', async () => {
  vi.mocked(window.adminOrders.financials).mockResolvedValue({ ...financials, consistent: false })
  await open()
  expect(screen.getByText(/They are separate snapshots/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Confirm Shipment' })).toBeDisabled()
})
it('cross-checks the order summary against the separate payment read', async () => {
  vi.mocked(window.adminOrders.financials).mockResolvedValue({ ...financials, payment: { state: 'ready', value: { ...payment, status: 'FAILED' } } })
  await open()
  expect(screen.getByText(/Order and payment reads do not agree/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Confirm Shipment' })).toBeDisabled()
})

const startDispatch = async (typed: string) => {
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Shipment' }))
  fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: 'ab 123456789 gb' } })
  fireEvent.change(screen.getByLabelText('Actual shipping cost'), { target: { value: typed } })
}
it('uses a text field so a typed comma is never silently dropped (3,99 became 399)', async () => {
  await startDispatch('3,99')
  const field = screen.getByLabelText('Actual shipping cost')
  expect(field).toHaveAttribute('type', 'text'); expect(field).toHaveAttribute('inputmode', 'decimal')
  expect(field).toHaveValue('3,99')
  fireEvent.submit(confirm().closest('form')!)
  expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Use a full stop for pence')
  expect(window.adminOrders.dispatch).not.toHaveBeenCalled()
  expect(field).toHaveValue('3,99')
})
it.each([['3.99', 3.99, '£3.99'], ['15.00', 15, '£15.00'], ['15.01', 15.01, '£15.01']])('records %s as exactly %s GBP and shows %s', async (typed, sent, shown) => {
  await startDispatch(typed)
  expect(screen.getByText(`Will be recorded as ${shown}.`)).toBeInTheDocument()
  vi.mocked(window.adminOrders.get).mockResolvedValue({ ...order, status: 'DISPATCHED', fulfilmentStage: 'DISPATCHED', actualShippingCost: String(sent) })
  fireEvent.submit(confirm().closest('form')!)
  await waitFor(() => expect(window.adminOrders.dispatch).toHaveBeenCalledWith(41, { carrier: 'ROYAL_MAIL', trackingNumber: 'AB123456789GB', actualShippingCost: sent }))
  expect(await screen.findByText(`Actual shipping cost: ${shown}`)).toBeInTheDocument()
  expect(screen.queryByText(/£399|£1,500|£1,501/)).not.toBeInTheDocument()
})
it.each([['', 'Enter the actual shipping cost'], ['-1', 'negative'], ['abc', 'two decimal places'], ['3.999', 'two decimal places'], ['100000.01', 'cannot exceed']])('blocks invalid cost %j before any request', async (typed, text) => {
  await startDispatch(typed)
  fireEvent.submit(confirm().closest('form')!)
  expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(text)
  expect(window.adminOrders.dispatch).not.toHaveBeenCalled()
})

const dispatchedOrder: OrderDetail = { ...order, status: 'DISPATCHED', fulfilmentStage: 'DISPATCHED', dispatchedAt: '2026-10-14T10:00:00Z', actualShippingCost: '3.99',
  fulfilment: { stage: 'DISPATCHED', preparingAt: null, dispatchedAt: '2026-10-14T10:00:00Z', shipments: [{ sequence: 1, carrier: 'ROYAL_MAIL', carrierName: 'Royal Mail', trackingNumber: 'AB123456789GB', dispatchedAt: '2026-10-14T10:00:00Z', trackingUrl: 'https://www.royalmail.com/track-your-item#/tracking-results/AB123456789GB', trackingUrlIncludesNumber: true }] } }
const deliveredOrder: OrderDetail = { ...dispatchedOrder, fulfilmentStage: 'DELIVERED',
  fulfilment: { ...dispatchedOrder.fulfilment, stage: 'DELIVERED', shipments: [{ ...dispatchedOrder.fulfilment.shipments[0], tracking: { progress: 'DELIVERED', deliveredAt: '2026-10-16T09:30:00Z', deliveryConfirmation: 'MANUAL' } }] },
  deliveryConfirmations: [{ shipmentId: 9, shipmentSequence: 1, confirmedAt: '2026-10-16T09:30:00Z', source: 'MANUAL_OPERATOR_CONFIRMATION', performedByUser: { id: 1, email: 'operator@example.com' } }] }
const markDelivered = () => screen.queryByRole('button', { name: 'Mark as Delivered' })
const confirmDelivery = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm delivery' })
const checkDelivery = () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: /checked the carrier’s tracking website/ }))

it('offers Mark as Delivered only for a dispatched shipment that is not yet delivered', async () => {
  await open(); expect(markDelivered()).not.toBeInTheDocument(); cleanup()
  await open({ ...dispatchedOrder, fulfilment: { ...dispatchedOrder.fulfilment, shipments: [] } }); expect(markDelivered()).not.toBeInTheDocument(); cleanup()
  await open({ ...dispatchedOrder, status: 'COMPLETED' }); expect(markDelivered()).not.toBeInTheDocument(); cleanup()
  await open(deliveredOrder); expect(markDelivered()).not.toBeInTheDocument()
  expect(screen.getByText(/Delivered 16 Oct 2026, 09:30 \(confirmed manually\)|Delivered 16 Oct 2026, 10:30 \(confirmed manually\)/)).toBeInTheDocument()
  expect(screen.getByText(/Delivered · Dispatched → Delivered · Shipment 1/)).toBeInTheDocument()
  expect(screen.getByText(/operator@example.com · Manual confirmation \(carrier website checked\)/)).toBeInTheDocument()
  cleanup()
  await open(dispatchedOrder); expect(markDelivered()).toBeEnabled()
})
it('requires the manual carrier check and lets the operator back out without a request', async () => {
  await open(dispatchedOrder)
  fireEvent.click(markDelivered()!)
  const dialog = screen.getByRole('dialog')
  expect(dialog).toHaveTextContent('open the carrier’s tracking website and check that it shows this parcel as delivered')
  expect(dialog).toHaveTextContent('Your account and the time are recorded')
  expect(within(dialog).getByRole('link', { name: 'Open carrier tracking' })).toHaveAttribute('href', 'https://www.royalmail.com/track-your-item#/tracking-results/AB123456789GB')
  expect(confirmDelivery()).toBeDisabled()
  fireEvent.submit(confirmDelivery().closest('form')!)
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Confirm that you checked the carrier’s tracking website first')
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(markDelivered()!)
  expect(within(screen.getByRole('dialog')).getByRole('checkbox')).not.toBeChecked()
  checkDelivery(); fireEvent.click(screen.getByRole('button', { name: 'Go back' }))
  expect(window.adminOrders.delivered).not.toHaveBeenCalled()
})
it('confirms delivery once, shows success and refreshes the order', async () => {
  await open(dispatchedOrder)
  fireEvent.click(markDelivered()!); checkDelivery()
  let resolve!: (value: OrderDetail) => void
  vi.mocked(window.adminOrders.delivered).mockImplementation(() => new Promise(r => { resolve = r }))
  const form = confirmDelivery().closest('form')!
  fireEvent.submit(form); fireEvent.submit(form)
  expect(window.adminOrders.delivered).toHaveBeenCalledOnce()
  expect(window.adminOrders.delivered).toHaveBeenCalledWith(41)
  expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled()
  vi.mocked(window.adminOrders.get).mockResolvedValue(deliveredOrder)
  await act(async () => resolve(deliveredOrder))
  expect(await screen.findByText('Delivery confirmed. The customer now sees this order as Delivered.')).toBeInTheDocument()
  await waitFor(() => expect(markDelivered()).not.toBeInTheDocument())
  expect(screen.getByText(/operator@example.com · Manual confirmation/)).toBeInTheDocument()
  expect(window.adminOrders.get).toHaveBeenCalledTimes(2)
})
it('closes and refreshes on a duplicate confirmation, and keeps the dialog open for a retryable failure', async () => {
  await open(dispatchedOrder)
  fireEvent.click(markDelivered()!); checkDelivery()
  vi.mocked(window.adminOrders.delivered).mockRejectedValueOnce(new Error('The Backend is unavailable. Try again.'))
  fireEvent.submit(confirmDelivery().closest('form')!)
  expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('The Backend is unavailable')
  expect(within(screen.getByRole('dialog')).getByRole('checkbox')).toBeChecked()
  const duplicate = Object.assign(new Error('This order has already been confirmed as delivered. The order has been refreshed.'), { code: 'api', backendCode: 'ORDER_ALREADY_DELIVERED', status: 409 })
  vi.mocked(window.adminOrders.delivered).mockResolvedValueOnce(serializeIpcError(duplicate) as unknown as OrderDetail)
  vi.mocked(window.adminOrders.get).mockResolvedValue(deliveredOrder)
  fireEvent.submit(confirmDelivery().closest('form')!)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(await screen.findByRole('alert')).toHaveTextContent('already been confirmed as delivered')
  await waitFor(() => expect(markDelivered()).not.toBeInTheDocument())
  expect(window.adminOrders.delivered).toHaveBeenCalledTimes(2)
})
