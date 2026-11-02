import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import Returns, { type ReturnsNavigation } from './Returns'
import { RETURN_POSTAGE_INSTRUCTIONS } from './returnPostage'
import Orders from './Orders'
import { returnCase, returnQueue } from './test-fixtures/returns'
import { order, orderPage, financials } from './test-fixtures/order'
const setup = (detail = returnCase) => {
  window.adminReturns = {
    list: vi.fn().mockResolvedValue(returnQueue),
    get: vi.fn().mockResolvedValue(detail),
    action: vi.fn().mockResolvedValue(detail),
  }
  window.adminOrders = {
    financials: vi.fn().mockResolvedValue(financials),
    list: vi.fn().mockResolvedValue(orderPage),
    get: vi.fn().mockResolvedValue(order),
    preparing: vi.fn(),
    dispatch: vi.fn(),
    cancel: vi.fn(),
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
