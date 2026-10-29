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
it('previews the approved address and requires postage instructions and confirmation before authorising', async () => {
  render(
    <Returns
      navigation={{ orderId: 41, status: 'REQUESTED', page: 1 }}
      onNavigate={vi.fn()}
      onViewOriginalOrder={vi.fn()}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Authorize' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText('3 Hawthorne Drive')).toBeInTheDocument()
  expect(window.adminReturns.action).not.toHaveBeenCalled()
  fireEvent.change(within(dialog).getByLabelText('Postage arrangements'), {
    target: { value: 'Contact support for prepaid return postage.' },
  })
  fireEvent.click(within(dialog).getByRole('checkbox'))
  fireEvent.submit(
    within(dialog)
      .getByRole('button', { name: 'Confirm authorize' })
      .closest('form')!,
  )
  await act(async () => {})
  expect(window.adminReturns.action).toHaveBeenCalledWith(
    41,
    10,
    'authorize',
    expect.objectContaining({
      shippingPayer: 'SELLER',
      rightsReviewed: true,
      postageInstructions: 'Contact support for prepaid return postage.',
    }),
  )
  expect(window.adminReturns.action).toHaveBeenCalledOnce()
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
