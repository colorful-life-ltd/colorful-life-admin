import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Inventory from './Inventory'
import type { PendingShipment } from '../electron/inventory-contract'
import { InventoryError } from '../electron/inventory-service'
import { serializeIpcError } from '../electron/ipc-error-contract'
const input = { productListingId: 4, quantity: 2, shipmentReference: 'FBA-123', note: 'Home stock' }
const saved: PendingShipment = { request: { ...input, idempotencyKey: 'stable-key' }, state: 'prepared' }
const confirmed: PendingShipment = { ...saved, state: 'confirmed', result: { replayed: false, inventory: { productListingId: 4, currentStock: 8, reservedStock: 3, availableStock: 5 }, outbound: { ...saved.request, appliedQuantity: saved.request.quantity, shortfall: 0, id: 9, performedByUserId: 1, createdAt: '2026-10-18T12:00:00Z', movement: { id: 8, listingId: 4, type: 'FBA_OUTBOUND', quantityChange: -2, note: 'Home stock', performedByUserId: 1, createdAt: '2026-10-18T12:00:00Z' } } } }
beforeEach(() => {
  window.adminInventory = {
    list: vi.fn().mockResolvedValue({ items: [{ productListingId: 4, productId: 2, setNumber: '12345', title: 'Test car', condition: 'NEW', active: true, currentStock: 10, reservedStock: 3, availableStock: 7 }], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } }),
    movements: vi.fn().mockResolvedValue([{ ...confirmed.result!.outbound.movement, fbaOutbound: { id: 9, shipmentReference: 'FBA-123', idempotencyKey: 'stable-key' } }]),
    getOutbound: vi.fn(), pending: vi.fn().mockResolvedValue(null), prepare: vi.fn().mockResolvedValue(saved), submit: vi.fn().mockResolvedValue(confirmed), finish: vi.fn().mockResolvedValue(undefined),
  }
})
afterEach(cleanup)
async function select() { fireEvent.click(await screen.findByRole('button', { name: 'View listing #4' })) }
function fill() {
  fireEvent.change(screen.getByLabelText('Outbound quantity'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Shipment reference'), { target: { value: 'FBA-123' } })
  fireEvent.change(screen.getByLabelText('Required shipment note'), { target: { value: 'Home stock' } })
}
function submit() { fireEvent.submit(screen.getByRole('button', { name: 'Record outbound shipment' }).closest('form')!) }
it('shows current/reserved/available quantities and existing stock semantics without inventing SKU', async () => {
  render(<Inventory />)
  expect(screen.getByText(/not a physical shelf count/)).toHaveTextContent('including orders not yet dispatched')
  const row = (await screen.findByText('Test car')).closest('tr')!
  expect(within(row).getByText('10')).toBeInTheDocument(); expect(within(row).getByText('3')).toBeInTheDocument(); expect(within(row).getByText('7')).toBeInTheDocument()
  expect(screen.getByText(/SKU unavailable/)).toBeInTheDocument()
})
it('shows signed movement quantities, actor, timestamp, note and FBA metadata', async () => {
  render(<Inventory />); await select()
  expect(await screen.findByText('FBA OUTBOUND')).toBeInTheDocument()
  const selectedButton = screen.getByRole('button', { name: 'View listing #4' })
  expect(selectedButton).toHaveAttribute('aria-pressed', 'true')
  expect(selectedButton.closest('tr')).not.toHaveAttribute('aria-selected')
  expect(screen.getByText('-2')).toBeInTheDocument(); expect(screen.getByText('User #1')).toBeInTheDocument(); expect(screen.getByText('Home stock')).toBeInTheDocument(); expect(screen.getByText('FBA-123')).toBeInTheDocument()
  expect(document.querySelector('time')).toHaveAttribute('dateTime', '2026-10-18T12:00:00Z')
  expect(screen.getByText(/not reconstructed/)).toBeInTheDocument()
})
it('records an outbound, prevents rapid duplicate clicks and refreshes quantities and history', async () => {
  render(<Inventory />); await select(); fill()
  const form = screen.getByRole('button', { name: 'Record outbound shipment' }).closest('form')!
  fireEvent.submit(form); fireEvent.submit(form)
  await waitFor(() => expect(window.adminInventory.submit).toHaveBeenCalledTimes(1))
  expect(window.adminInventory.prepare).toHaveBeenCalledExactlyOnceWith(input)
  expect(window.adminInventory.submit).toHaveBeenCalledWith('stable-key')
  expect(await screen.findByText(/Outbound shipment recorded successfully/)).toBeInTheDocument()
  await waitFor(() => expect(window.adminInventory.list).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(window.adminInventory.movements).toHaveBeenCalledTimes(2))
  expect(screen.getByLabelText('Shipment reference')).toBeDisabled()
})
it('restores an uncertain shipment after navigation and retries only the original key and payload', async () => {
  const uncertain = { ...saved, state: 'uncertain' as const }
  vi.mocked(window.adminInventory.pending).mockResolvedValue(uncertain)
  vi.mocked(window.adminInventory.submit).mockResolvedValue({ ...confirmed, result: { ...confirmed.result!, replayed: true } })
  render(<Inventory />)
  expect(await screen.findByText(/Outcome is uncertain/)).toBeInTheDocument()
  expect(screen.getByLabelText('Shipment reference')).toHaveValue('FBA-123'); expect(screen.getByLabelText('Shipment reference')).toBeDisabled()
  expect(screen.queryByRole('button', { name: /Start another|Discard/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Retry saved shipment' }))
  expect(await screen.findByText(/No additional stock was deducted/)).toBeInTheDocument()
  expect(window.adminInventory.prepare).not.toHaveBeenCalled(); expect(window.adminInventory.submit).toHaveBeenCalledExactlyOnceWith('stable-key')
})
it.each([
  ['uncertain', null, 'The response was lost. Retry with the same key.'],
  ['api', 409, 'Not enough available local stock.'],
  ['api', 409, 'Idempotency conflict. Do not create a new key.'],
  ['api', 400, 'Check the shipment fields.'],
  ['api', 401, 'Sign in again with the same account.'],
  ['api', 403, 'This account cannot manage inventory.'],
  ['api', 404, 'The listing no longer exists.'],
] as const)('shows %s / %s failures through the serialized IPC boundary without reporting success', async (code, status, message) => {
  vi.mocked(window.adminInventory.submit).mockResolvedValue(serializeIpcError(new InventoryError(code, message, null, status)) as never)
  vi.mocked(window.adminInventory.pending).mockResolvedValueOnce(null).mockResolvedValue({ ...saved, state: 'uncertain' })
  render(<Inventory />); await select(); fill(); submit()
  expect(await screen.findByRole('alert')).toHaveTextContent(message)
  await waitFor(() => expect(screen.getByLabelText('Outbound quantity')).toBeDisabled())
  expect(screen.queryByText(/recorded successfully/)).not.toBeInTheDocument()
  expect(window.adminInventory.prepare).toHaveBeenCalledTimes(1)
})
it('blocks submissions when the journal cannot be recovered or session expiry is open', async () => {
  vi.mocked(window.adminInventory.pending).mockRejectedValue(new Error('Journal unavailable'))
  render(<Inventory sessionBlocked />); await select()
  expect(await screen.findByRole('alert')).toHaveTextContent('No new shipment can be submitted')
  expect(screen.getByRole('button', { name: 'Record outbound shipment' })).toBeDisabled()
})
it('shows loading, empty and API error states with refresh recovery', async () => {
  vi.mocked(window.adminInventory.list).mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValue({ items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } })
  render(<Inventory />)
  expect(screen.getByText('Loading inventory…')).toBeInTheDocument()
  expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable')
  fireEvent.click(screen.getByRole('button', { name: 'Refresh inventory and ledger' }))
  expect(await screen.findByText('No inventory listings found.')).toBeInTheDocument()
})
it('reports ledger failure and does not fabricate an empty history', async () => {
  vi.mocked(window.adminInventory.movements).mockRejectedValue(new Error('Ledger unavailable'))
  render(<Inventory />); await select()
  expect(await screen.findByRole('alert')).toHaveTextContent('Ledger unavailable')
  expect(screen.queryByText('No recorded movements for this listing.')).not.toBeInTheDocument()
})
it('starts a new physical shipment only after explicit completion of the confirmed one', async () => {
  vi.mocked(window.adminInventory.pending).mockResolvedValue(confirmed)
  render(<Inventory />)
  fireEvent.click(await screen.findByRole('button', { name: 'Start another physical shipment' }))
  await waitFor(() => expect(window.adminInventory.finish).toHaveBeenCalledExactlyOnceWith('stable-key'))
  expect(window.adminInventory.submit).not.toHaveBeenCalled()
})
it('paginates inventory without starting a shipment', async () => {
  const first = { items: [{ productListingId: 4, productId: 2, setNumber: '12345', title: 'Page one car', condition: 'NEW' as const, active: true, currentStock: 10, reservedStock: 3, availableStock: 7 }], pagination: { page: 1, pageSize: 20, totalItems: 21, totalPages: 2 } }
  vi.mocked(window.adminInventory.list).mockResolvedValueOnce(first).mockResolvedValueOnce({ ...first, items: [{ ...first.items[0], title: 'Page two car', productListingId: 5 }], pagination: { ...first.pagination, page: 2 } })
  render(<Inventory />)
  expect(await screen.findByText('Page one car')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Next inventory page' }))
  expect(await screen.findByText('Page two car')).toBeInTheDocument()
  expect(window.adminInventory.list).toHaveBeenLastCalledWith(2)
  expect(window.adminInventory.prepare).not.toHaveBeenCalled()
})
it('blocks Used-offer submission and shows an honest empty ledger', async () => {
  vi.mocked(window.adminInventory.list).mockResolvedValue({ items: [{ productListingId: 4, productId: 2, setNumber: '12345', title: 'Used car', condition: 'USED_LIKE_NEW', active: true, currentStock: 1, reservedStock: 0, availableStock: 1 }], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } })
  vi.mocked(window.adminInventory.movements).mockResolvedValue([])
  render(<Inventory />); await select()
  expect(await screen.findByText('No recorded movements for this listing.')).toBeInTheDocument()
  expect(screen.getByText(/Used physical offers are not supported/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Record outbound shipment' })).toBeDisabled()
})
it('reloads pending after failed discard and clears stale payload when a tombstone is already visible', async () => {
  vi.mocked(window.adminInventory.pending).mockResolvedValueOnce(confirmed).mockResolvedValue(null)
  vi.mocked(window.adminInventory.finish).mockRejectedValue(new Error('Directory sync failed after rename'))
  render(<Inventory />)
  fireEvent.click(await screen.findByRole('button', { name: 'Start another physical shipment' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Directory sync failed after rename')
  await waitFor(() => expect(window.adminInventory.pending).toHaveBeenCalledTimes(2))
  expect(screen.queryByText(/Saved shipment for Listing/)).not.toBeInTheDocument()
  expect(screen.getByLabelText('Shipment reference')).toHaveValue('')
  expect(screen.getByLabelText('Outbound quantity')).toHaveValue(null)
  expect(screen.queryByRole('button', { name: 'Start another physical shipment' })).not.toBeInTheDocument()
  expect(window.adminInventory.prepare).not.toHaveBeenCalled(); expect(window.adminInventory.submit).not.toHaveBeenCalled()
})
it('fails closed if pending cannot be reloaded after failed discard', async () => {
  vi.mocked(window.adminInventory.pending).mockResolvedValueOnce(confirmed).mockRejectedValue(new Error('Journal unreadable'))
  vi.mocked(window.adminInventory.finish).mockRejectedValue(new Error('Discard failed'))
  render(<Inventory />)
  fireEvent.click(await screen.findByRole('button', { name: 'Start another physical shipment' }))
  expect(await screen.findByText(/Journal unreadable/)).toHaveTextContent('No new shipment can be submitted')
  expect(window.adminInventory.prepare).not.toHaveBeenCalled(); expect(window.adminInventory.submit).not.toHaveBeenCalled()
})
