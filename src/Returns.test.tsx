import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import Returns, { type ReturnsNavigation } from './Returns'
import { RETURN_POSTAGE_INSTRUCTIONS } from './returnPostage'
import Orders from './Orders'
import { returnCase, returnQueue } from './test-fixtures/returns'
import { order, orderPage, financials, refund } from './test-fixtures/order'
import { parseRefunds } from '../electron/order-financials'
const setup = (detail = returnCase) => {
  window.adminReturns = {
    list: vi.fn().mockResolvedValue(returnQueue),
    get: vi.fn().mockResolvedValue(detail),
    action: vi.fn().mockResolvedValue(detail),
  }
  window.adminOrders = {
    financials: vi.fn().mockResolvedValue(financials),
    paymentEnvironment: vi.fn().mockResolvedValue({ stripeEnvironment: 'TEST', refundReconciliationEnabled: true }),
    list: vi.fn().mockResolvedValue(orderPage),
    get: vi.fn().mockResolvedValue(order),
    preparing: vi.fn(),
    dispatch: vi.fn(),
    cancel: vi.fn(),
  }
  window.adminConnection = { status: vi.fn().mockResolvedValue({ mode: 'remote-sandbox', state: 'connected', message: 'Connected' }), retry: vi.fn() }
  window.adminOperations = {
    read: vi.fn().mockResolvedValue({}),
    execute: vi.fn().mockResolvedValue({ refundId: 91, status: 'PROCESSING', amount: '23.98', currency: 'GBP', provider: 'STRIPE' }),
    pending: vi.fn().mockResolvedValue([]),
    finish: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn().mockResolvedValue({}),
  }
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
  setup()
})
afterEach(cleanup)
function Workspace() {
  const [section, setSection] = useState('returns'),
    [navigation, setNavigation] = useState<ReturnsNavigation>({
      orderId: null,
      status: 'REQUESTED',
      page: 1,
    }),
    [orderId, setOrderId] = useState<number | null>(null)
  return section === 'returns' ? (
    <Returns
      navigation={navigation}
      onNavigate={setNavigation}
      onViewOriginalOrder={(id) => {
        setOrderId(id)
        setSection('orders')
      }}
    />
  ) : (
    <Orders
      initialOrderId={orderId}
      onViewReturns={(id) => {
        setNavigation((n) => ({ ...n, orderId: id }))
        setSection('returns')
      }}
    />
  )
}
it('groups requests and navigates directly to original order and back, preserving queue filter', async () => {
  render(<Workspace />)
  fireEvent.change(screen.getByLabelText('Return status filter'), {
    target: { value: 'AUTHORIZED' },
  })
  fireEvent.click(await screen.findByRole('button', { name: /BB-R-41/ }))
  expect(
    await screen.findByRole('heading', { name: 'Returns · BB-R-41' }),
  ).toBeInTheDocument()
  expect(screen.getByText(/Missing parts/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'View Original Order' }))
  expect(await screen.findByText(/1 Test Street/)).toBeInTheDocument()
  expect(window.adminOrders.get).toHaveBeenCalledWith(41)
  expect(window.adminOrders.list).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'View Returns' }))
  expect(
    await screen.findByRole('heading', { name: 'Returns · BB-R-41' }),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Back to Returns' }))
  expect(await screen.findByLabelText('Return status filter')).toHaveValue(
    'AUTHORIZED',
  )
  expect(window.adminReturns.list).toHaveBeenLastCalledWith('AUTHORIZED', 1)
})
const openAuthorize = async (detail = returnCase) => {
  setup(detail)
  render(
    <Returns
      navigation={{ orderId: 41, status: 'REQUESTED', page: 1 }}
      onNavigate={vi.fn()}
      onViewOriginalOrder={vi.fn()}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Authorize' }))
  return screen.getByRole('dialog')
}
const confirmAuthorize = async (dialog: HTMLElement) => {
  fireEvent.submit(
    within(dialog)
      .getByRole('button', { name: 'Confirm authorize' })
      .closest('form')!,
  )
  await act(async () => {})
}
it('requires an explicit postage choice and sends fixed seller-reimbursement text', async () => {
  const dialog = await openAuthorize()
  expect(within(dialog).getByText('3 Hawthorne Drive')).toBeInTheDocument()
  expect(within(dialog).queryByLabelText('Postage arrangements')).toBeNull()
  const customer = within(dialog).getByRole('radio', { name: 'Customer pays return postage' })
  const seller = within(dialog).getByRole('radio', { name: 'Seller pays return postage' })
  expect(customer).not.toBeChecked()
  expect(seller).not.toBeChecked()
  fireEvent.click(within(dialog).getByRole('checkbox'))
  expect(within(dialog).getByRole('button', { name: 'Confirm authorize' })).toBeDisabled()
  await confirmAuthorize(dialog)
  expect(window.adminReturns.action).not.toHaveBeenCalled()
  fireEvent.click(seller)
  expect(within(dialog).getByText(RETURN_POSTAGE_INSTRUCTIONS.SELLER)).toBeInTheDocument()
  await confirmAuthorize(dialog)
  expect(window.adminReturns.action).toHaveBeenCalledWith(41, 10, 'authorize', {
    shippingPayer: 'SELLER',
    postageInstructions: RETURN_POSTAGE_INSTRUCTIONS.SELLER,
    instructions: returnCase.defaultInstructions!.instructions,
    rightsReviewed: true,
  })
  expect(window.adminReturns.action).toHaveBeenCalledOnce()
})
it('sends the fixed customer-pays text for a change-of-mind return and still requires the rights acknowledgement', async () => {
  const detail = structuredClone(returnCase)
  detail.submissions[0].lines[0].reason = 'CHANGE_OF_MIND'
  const dialog = await openAuthorize(detail)
  fireEvent.click(within(dialog).getByRole('radio', { name: 'Customer pays return postage' }))
  expect(within(dialog).getByText(RETURN_POSTAGE_INSTRUCTIONS.CUSTOMER)).toBeInTheDocument()
  expect(within(dialog).getByRole('checkbox')).toBeRequired()
  fireEvent.click(within(dialog).getByRole('checkbox'))
  await confirmAuthorize(dialog)
  expect(window.adminReturns.action).toHaveBeenCalledWith(
    41,
    10,
    'authorize',
    expect.objectContaining({
      shippingPayer: 'CUSTOMER',
      postageInstructions: RETURN_POSTAGE_INSTRUCTIONS.CUSTOMER,
      rightsReviewed: true,
    }),
  )
})
it.each(['DAMAGED', 'DEFECTIVE', 'WRONG_ITEM', 'NOT_AS_DESCRIBED'] as const)(
  'keeps customer-paid postage unavailable for %s without preselecting the seller',
  async (reason) => {
    const detail = structuredClone(returnCase)
    detail.submissions[0].lines[0].reason = reason
    const dialog = await openAuthorize(detail)
    expect(within(dialog).getByRole('radio', { name: 'Customer pays return postage' })).toBeDisabled()
    expect(within(dialog).getByRole('radio', { name: 'Seller pays return postage' })).not.toBeChecked()
    expect(within(dialog).getByText(/seller must cover reasonable return postage/)).toBeInTheDocument()
  },
)
it('keeps both fixed postage texts within the backend contract', () => {
  for (const text of Object.values(RETURN_POSTAGE_INSTRUCTIONS)) {
    expect(text.trim().length).toBeGreaterThanOrEqual(10)
    expect(text.length).toBeLessThanOrEqual(2000)
  }
})
it('records receipt separately from refunds and blocks duplicate submissions', async () => {
  const detail = structuredClone(returnCase)
  detail.submissions[0].lines[0].status = 'AUTHORIZED'
  setup(detail)
  let resolve!: (value: typeof detail) => void
  vi.mocked(window.adminReturns.action).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  render(
    <Returns
      navigation={{ orderId: 41, status: 'AUTHORIZED', page: 1 }}
      onNavigate={vi.fn()}
      onViewOriginalOrder={vi.fn()}
    />,
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Confirm Received' }),
  )
  const dialog = screen.getByRole('dialog')
  expect(
    within(dialog).getByText(/No refund or stock change/),
  ).toBeInTheDocument()
  fireEvent.change(within(dialog).getByLabelText('Operator notes'), {
    target: { value: 'Parcel received and recorded' },
  })
  const form = within(dialog)
    .getByRole('button', { name: 'Confirm receipt' })
    .closest('form')!
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(window.adminReturns.action).toHaveBeenCalledOnce()
  expect(window.adminReturns.action).toHaveBeenCalledWith(
    41,
    10,
    'receive',
    expect.objectContaining({
      note: 'Parcel received and recorded',
      receivedAt: expect.any(String),
    }),
  )
  await act(async () => resolve(detail))
})
it('disables mutations during session expiry and handles empty queues', async () => {
  render(
    <Returns
      navigation={{ orderId: 41, status: '', page: 1 }}
      onNavigate={vi.fn()}
      onViewOriginalOrder={vi.fn()}
      sessionBlocked
    />,
  )
  expect(
    await screen.findByRole('button', { name: 'Authorize' }),
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled()
})

it('shows refused actions inside the active modal so the operator can read the error', async () => {
  vi.mocked(window.adminReturns.action).mockRejectedValue(
    new Error('RETURN_TRANSITION_REFUSED'),
  )
  render(
    <Returns
      navigation={{ orderId: 41, status: 'REQUESTED', page: 1 }}
      onNavigate={vi.fn()}
      onViewOriginalOrder={vi.fn()}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Authorize' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(
    within(dialog).getByRole('radio', { name: 'Seller pays return postage' }),
  )
  fireEvent.click(within(dialog).getByRole('checkbox'))
  fireEvent.submit(
    within(dialog)
      .getByRole('button', { name: 'Confirm authorize' })
      .closest('form')!,
  )
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'RETURN_TRANSITION_REFUSED',
  )
  expect(dialog).toHaveAttribute('open')
  expect(window.adminReturns.action).toHaveBeenCalledOnce()
})

const completedReturn = () => {
  const detail = structuredClone(returnCase)
  detail.submissions[0].lines[0].status = 'COMPLETED'
  detail.submissions[0].lines[0].orderItemId = 3
  detail.submissions[0].lines[0].completedAt = '2026-10-30T10:00:00Z'
  return detail
}
const openRefund = async (detail = completedReturn(), orderOverride = order) => {
  setup(detail)
  vi.mocked(window.adminOrders.get).mockResolvedValue(orderOverride)
  render(<Returns navigation={{ orderId: 41, status: '', page: 1 }} onNavigate={vi.fn()} onViewOriginalOrder={vi.fn()} />)
  const opener = await screen.findByRole('button', { name: 'Review refund' })
  opener.focus()
  fireEvent.click(opener)
  return await screen.findByRole('dialog', { name: /Refund · BB-R-41/ })
}
it('opens a dedicated modal with verified payment context and no prefilled amount', async () => {
  const dialog = await openRefund()
  expect(within(dialog).getByText('pi_testfixture')).toBeInTheDocument()
  expect(within(dialog).getAllByText('£25.00 GBP')).toHaveLength(2)
  expect(within(dialog).getByRole('status')).toHaveTextContent(/Stripe environment: TEST/)
  expect(within(dialog).getByLabelText('Refund amount (GBP)')).toHaveValue('')
  expect(window.adminOperations.execute).not.toHaveBeenCalled()
})
it('moves focus into the modal and returns focus to the opener when Escape closes it', async () => {
  const dialog = await openRefund()
  expect(within(dialog).getByLabelText('Refund amount (GBP)')).toHaveFocus()
  dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByRole('button', { name: 'Review refund' })).toHaveFocus()
})
it('fill-in controls use exact cents and only change the amount field', async () => {
  const dialog = await openRefund(completedReturn(), { ...order, totalAmount: '28.00', financials: { shipping: { chargePence: 300 } } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Use returned items value' }))
  expect(within(dialog).getByLabelText('Refund amount (GBP)')).toHaveValue('12.50')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add delivery charge' }))
  expect(within(dialog).getByLabelText('Refund amount (GBP)')).toHaveValue('15.50')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Use full available amount' }))
  expect(within(dialog).getByLabelText('Refund amount (GBP)')).toHaveValue('25.00')
  expect(window.adminOperations.execute).not.toHaveBeenCalled()
})
it('validates empty, zero, malformed and over-capacity amounts before creating an operation intent', async () => {
  const dialog = await openRefund()
  const amount = within(dialog).getByLabelText('Refund amount (GBP)')
  fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'FAULTY' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
  expect(within(dialog).getByRole('alert')).toHaveTextContent(/Enter an amount/)
  for (const value of ['0.00', '-1.00', '1e2', '25.01']) {
    fireEvent.change(amount, { target: { value } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    expect(window.adminOperations.execute).not.toHaveBeenCalled()
  }
  expect(within(dialog).getByRole('alert')).toHaveTextContent(/exceeds the available/)
})
it('requires the confirmation step and initiates exactly once with the selected amount/reason', async () => {
  const dialog = await openRefund()
  fireEvent.change(within(dialog).getByLabelText('Refund amount (GBP)'), { target: { value: '23.98' } })
  fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'FAULTY' } })
  fireEvent.change(within(dialog).getByLabelText('Optional note'), { target: { value: 'Returned item inspected' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
  expect(within(dialog).getByText('Review before refunding')).toBeInTheDocument()
  const final = within(dialog).getByRole('button', { name: 'Refund £23.98 GBP' })
  expect(final).toBeEnabled()
  expect(within(dialog).getByText(/BB-R-41 — Faulty — Returned item inspected/)).toBeInTheDocument()
  expect(window.adminOperations.execute).not.toHaveBeenCalled()
  fireEvent.click(final)
  fireEvent.click(final)
  await waitFor(() => expect(window.adminOperations.execute).toHaveBeenCalledOnce())
  expect(window.adminOperations.execute).toHaveBeenCalledWith('refund', { orderId: 41, paymentId: 7, amount: 23.98, reason: 'BB-R-41 — Faulty — Returned item inspected' })
  expect(await within(dialog).findByText(/Refund pending/)).toBeInTheDocument()
  expect(window.adminOperations.finish).not.toHaveBeenCalled()
})
it.each([
  [{ refundId: 90, status: 'SUCCEEDED', amount: '1.00', currency: 'GBP', provider: 'STRIPE', resolutionCode: 'REFUND_SUCCEEDED', reviewRequired: false }, 'Refund succeeded', false],
  [{ refundId: 90, status: 'FAILED', amount: '1.00', currency: 'GBP', provider: 'STRIPE', resolutionCode: 'REFUND_FAILED', reviewRequired: false }, 'Refund failed', false],
  [{ refundId: 90, status: 'PROCESSING', amount: '1.00', currency: 'GBP', provider: 'STRIPE', resolutionCode: 'PROVIDER_EVIDENCE_MISMATCH', reviewRequired: true }, 'Refund needs review', true],
] as const)('shows the authoritative refund outcome without overstating settlement', async (response, title, needsReview) => {
  const dialog = await openRefund()
  vi.mocked(window.adminOperations.execute).mockResolvedValueOnce(response)
  fireEvent.change(within(dialog).getByLabelText('Refund amount (GBP)'), { target: { value: '1.00' } })
  fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'GOODWILL' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Refund £1.00 GBP' }))
  expect(await within(dialog).findByRole('heading', { name: title })).toBeInTheDocument()
  if (needsReview) expect(within(dialog).getByText(/provider evidence mismatch/i)).toBeInTheDocument()
  expect(dialog.textContent).not.toContain("reached the customer's bank")
})
it('fails closed on UNKNOWN and blocks a Sandbox connection reporting LIVE', async () => {
  const detail = completedReturn(); setup(detail)
  vi.mocked(window.adminOrders.paymentEnvironment).mockResolvedValueOnce({ stripeEnvironment: 'UNKNOWN', refundReconciliationEnabled: false })
  render(<Returns navigation={{ orderId: 41, status: '', page: 1 }} onNavigate={vi.fn()} onViewOriginalOrder={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Review refund' }))
  let dialog = await screen.findByRole('dialog', { name: /Refund · BB-R-41/ })
  expect(within(dialog).getByText(/status is unverified; refund is blocked/)).toBeInTheDocument()
  expect(within(dialog).getByLabelText('Refund amount (GBP)')).toBeDisabled()
  expect(window.adminOperations.execute).not.toHaveBeenCalled()
  cleanup()
  setup(detail)
  vi.mocked(window.adminOrders.paymentEnvironment).mockResolvedValueOnce({ stripeEnvironment: 'LIVE', refundReconciliationEnabled: true })
  render(<Returns navigation={{ orderId: 41, status: '', page: 1 }} onNavigate={vi.fn()} onViewOriginalOrder={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Review refund' }))
  dialog = await screen.findByRole('dialog', { name: /Refund · BB-R-41/ })
  expect(within(dialog).getByRole('alert')).toHaveTextContent(/Sandbox connection \/ LIVE Stripe mismatch/)
  expect(within(dialog).getByLabelText('Refund amount (GBP)')).toBeDisabled()
})
it('requires extra LIVE confirmation and presents real-money warning', async () => {
  const detail = completedReturn(); setup(detail)
  vi.mocked(window.adminOrders.paymentEnvironment).mockResolvedValueOnce({ stripeEnvironment: 'LIVE', refundReconciliationEnabled: true })
  vi.mocked(window.adminConnection!.status).mockResolvedValueOnce({ mode: 'direct', state: 'connected', message: 'Direct' })
  render(<Returns navigation={{ orderId: 41, status: '', page: 1 }} onNavigate={vi.fn()} onViewOriginalOrder={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Review refund' }))
  const dialog = await screen.findByRole('dialog', { name: /Refund · BB-R-41/ })
  fireEvent.change(within(dialog).getByLabelText('Refund amount (GBP)'), { target: { value: '1.00' } })
  fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'GOODWILL' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
  expect(within(dialog).getByText(/real money will be refunded/)).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'Refund £1.00 GBP' })).toBeDisabled()
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /I understand this LIVE Stripe refund/ }))
  expect(within(dialog).getByRole('button', { name: 'Refund £1.00 GBP' })).toBeEnabled()
  expect(window.adminOperations.execute).not.toHaveBeenCalled()
})
it('keeps pending and review-required refunds from offering a new refund, with truthful recovery availability', async () => {
  const detail = completedReturn(); setup(detail)
  const processing = { ...parseRefunds([refund], 41)[0], status: 'PROCESSING' as const, resolutionCode: 'PROVIDER_PENDING', reviewRequired: false }
  vi.mocked(window.adminOrders.financials).mockResolvedValueOnce({
    payment: { state: 'ready', value: { ...financials.payment.value!, reservedRefundAmount: '5' } },
    refunds: { state: 'ready', value: [processing] }, consistent: true,
  })
  vi.mocked(window.adminOrders.paymentEnvironment).mockResolvedValueOnce({ stripeEnvironment: 'TEST', refundReconciliationEnabled: false })
  render(<Returns navigation={{ orderId: 41, status: '', page: 1 }} onNavigate={vi.fn()} onViewOriginalOrder={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Review refund status' }))
  const dialog = await screen.findByRole('dialog', { name: /Refund · BB-R-41/ })
  expect(within(dialog).getByText(/Status checking is currently unavailable/)).toBeInTheDocument()
  expect(within(dialog).queryByRole('button', { name: 'Refund £' })).toBeNull()
  expect(window.adminOperations.execute).not.toHaveBeenCalled()
})
