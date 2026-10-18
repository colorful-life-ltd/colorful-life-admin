import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Purchases from './Purchases'
import { PurchaseService } from '../electron/purchase-service'
import { serializeIpcError } from '../electron/ipc-error-contract'
import type { AuthService } from '../electron/auth-service'
import type { Purchase, PurchasePage, PurchaseReview as Review } from '../electron/purchase-contract.js'

const purchase: Purchase = { id: 3, sourceOrderReference: 'ORDER-1', sourceOrderDate: '2026-09-20T00:00:00.000Z', merchantName: null, createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', purchaseDocuments: [] }
const supplierOptions = { canonicalSuppliers: ['LEGO', 'Amazon', 'eBay', 'B&M', "Sainsbury's"], customSupplierOption: 'Others' }
const fillMinimalPurchase = () => {
  fireEvent.change(screen.getByLabelText('Purchase reference *'), { target: { value: 'ORDER-17' } })
  fireEvent.change(screen.getByLabelText('Description *'), { target: { value: 'Technic set' } })
  fireEvent.change(screen.getByLabelText('Unit cost (£) *'), { target: { value: '10.00' } })
}
const historyRow = (id: number, sourceOrderReference: string, importHash: string): Purchase => ({
  ...purchase,
  id,
  sourceOrderReference,
  purchaseDocuments: [{
    id: id * 10, purchaseId: id, partNumber: 1, sourceInvoiceReference: null, importHash, sourceDocumentDate: null,
    importedByUserId: 7, originalGrossMerchandiseTotal: '10.00', shippingTotal: '0.00', discountTotal: '0.00',
    finalTotalPaid: '10.00', createdAt: purchase.createdAt, updatedAt: purchase.updatedAt,
  }],
})
const purchasePage = (purchases: Purchase[], page = 1, totalItems = purchases.length, totalPages = totalItems === 0 ? 0 : 1): PurchasePage => ({
  purchases,
  pagination: { page, pageSize: 6, totalItems, totalPages, limit: 6, total: totalItems },
})
const reviewState = (purchase: Purchase, state: 'UNRESOLVED' | 'MATCHED' | 'EXCLUDED'): Review => ({
  purchase,
  revision: 'a'.repeat(64),
  totalCost: '10.00',
  groups: [{ state, inventoryDisposition: state === 'EXCLUDED' ? 'NON_INVENTORY' : 'INVENTORY', lines: [{ purchaseDocumentId: purchase.purchaseDocuments[0].id, productListingId: null }] }],
} as unknown as Review)

describe('Purchases', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    window.adminPurchases = {
      getManualSupplierOptions: vi.fn().mockResolvedValue(supplierOptions),
      createManual: vi.fn().mockResolvedValue({ purchaseId: purchase.id, documentId: 4 }),
      review: vi.fn().mockResolvedValue({ purchase, revision: 'a'.repeat(64), totalCost: '0.00', groups: [] }),
      amend: vi.fn(), resolve: vi.fn(), setInventoryDisposition: vi.fn(), receive: vi.fn(), searchProducts: vi.fn(), createListing: vi.fn(),
      importPdf: vi.fn().mockResolvedValue({ message: 'Purchase invoice imported successfully', importHash: 'hash' }),
      list: vi.fn().mockResolvedValue(purchasePage([purchase])),
      get: vi.fn().mockResolvedValue(purchase),
      purchaseAnalyticsSummary: vi.fn().mockResolvedValue({ totalQuantity: 0, totalAmount: '0.00', suppliers: [] }),
      supplierMonthlyAnalytics: vi.fn().mockResolvedValue({ supplierKey: 'unknown', supplierName: 'Unknown supplier', months: [], undatedTotalAmount: '0.00' }),
    }
  })

  it('rejects non-PDF files and imports a selected PDF', async () => {
    render(<Purchases />)
    const input = screen.getByLabelText('PDF purchase document upload').querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['text'], 'notes.txt', { type: 'text/plain' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a PDF')
    fireEvent.change(input, { target: { files: [new File(['%PDF-'], 'invoice.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import purchase document' }))
    await waitFor(() => expect(window.adminPurchases.importPdf).toHaveBeenCalled())
    expect(screen.getByRole('status')).toHaveTextContent('Purchase invoice imported successfully')
  })


  it.each([
    [201, { message: 'Purchase invoice imported successfully', importHash: 'a'.repeat(64) }, 'status', 'Purchase invoice imported successfully'],
    [409, { error: `Duplicate import hash: ${'a'.repeat(64)}` }, 'status', 'This invoice has already been imported. No duplicate was created.'],
    [409, { error: 'Conflicting purchase details. Check the invoice reference.' }, 'alert', 'Check the invoice reference'],
    [400, { error: 'Uploaded file is not a valid PDF' }, 'alert', 'Uploaded file is not a valid PDF'],
    [500, { error: 'Internal server error' }, 'alert', 'service is unavailable'],
    [0, {}, 'alert', 'Check your connection and purchase history before retrying'],
  ] as const)('displays HTTP %s import outcomes through serialized Electron IPC', async (status, body, role, message) => {
    const authenticatedFetch = status === 0 ? vi.fn().mockRejectedValue(new TypeError('fetch failed')) : vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
    const service = new PurchaseService({ authenticatedFetch } as unknown as AuthService)
    // Model Main's error envelope, preload's data-only forwarding and renderer restoration.
    vi.mocked(window.adminPurchases.importPdf).mockImplementation(async file => {
      try { return await service.importPdf(file) }
      catch (error) { return serializeIpcError(error) as never }
    })
    render(<Purchases />)
    const input = screen.getByLabelText('PDF purchase document upload').querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['%PDF-'], 'same-name.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import purchase document' }))
    expect(await screen.findByRole(role)).toHaveTextContent(message)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh history' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh history' })).toBeEnabled())
    // Cancelling the picker and refreshing history must not erase the outcome.
    fireEvent.change(input, { target: { files: [] } })
    expect(screen.getByRole(role)).toHaveTextContent(message)
    expect(authenticatedFetch).toHaveBeenCalledTimes(1)
    if (role === 'status') expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    else expect(screen.queryByText(/No duplicate was created/)).not.toBeInTheDocument()
  })

  it('renders history and opens purchase details', async () => {
    render(<Purchases />)
    await waitFor(() => expect(screen.getByText('ORDER-1')).toBeInTheDocument())
    expect(window.adminPurchases.list).toHaveBeenCalledWith(1, 6, undefined)
    fireEvent.click(screen.getByRole('button', { name: 'View details' }))
    await waitFor(() => expect(window.adminPurchases.review).toHaveBeenCalledWith(3))
    expect(screen.getByRole('heading', { name: 'ORDER-1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Purchase History/ }))
    expect(screen.getByText('Purchase History')).toBeInTheDocument()
  })

  it('requests six purchases and uses backend totals and page metadata', async () => {
    const firstPage = Array.from({ length: 6 }, (_, index) => historyRow(index + 1, `PAGE-ONE-${index + 1}`, `hash-${index + 1}`))
    vi.mocked(window.adminPurchases.list).mockResolvedValueOnce(purchasePage(firstPage, 1, 14, 3))
    render(<Purchases />)

    expect(await screen.findByText('14 results')).toBeInTheDocument()
    expect(document.querySelectorAll('.purchase-list .purchase-row')).toHaveLength(6)
    expect(screen.getByRole('navigation', { name: 'Purchase history pages' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to page 1' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    expect(window.adminPurchases.list).toHaveBeenCalledWith(1, 6, undefined)
  })

  it('navigates forward, by page number and backward using server pagination', async () => {
    const pageOne = historyRow(21, 'SERVER-PAGE-1', 'page-1')
    const pageTwo = historyRow(22, 'SERVER-PAGE-2', 'page-2')
    const pageThree = historyRow(23, 'SERVER-PAGE-3', 'page-3')
    vi.mocked(window.adminPurchases.list)
      .mockResolvedValueOnce(purchasePage([pageOne], 1, 13, 3))
      .mockResolvedValueOnce(purchasePage([pageTwo], 2, 13, 3))
      .mockResolvedValueOnce(purchasePage([pageThree], 3, 13, 3))
      .mockResolvedValueOnce(purchasePage([pageTwo], 2, 13, 3))
    render(<Purchases />)

    expect(await screen.findByText('SERVER-PAGE-1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('SERVER-PAGE-2')).toBeInTheDocument()
    expect(window.adminPurchases.list).toHaveBeenLastCalledWith(2, 6, undefined)

    fireEvent.click(screen.getByRole('button', { name: 'Go to page 3' }))
    expect(await screen.findByText('SERVER-PAGE-3')).toBeInTheDocument()
    expect(window.adminPurchases.list).toHaveBeenLastCalledWith(3, 6, undefined)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('SERVER-PAGE-2')).toBeInTheDocument()
    expect(window.adminPurchases.list).toHaveBeenLastCalledWith(2, 6, undefined)
  })

  it.each(['171-', '2026-09-27'])('searches server-side for order/date value %s and resets to page 1', async searchTerm => {
    const currentPage = historyRow(31, 'CURRENT-PAGE-2', 'current-page-2')
    const match = historyRow(32, 'SEARCH-MATCH', 'search-match')
    vi.mocked(window.adminPurchases.list)
      .mockResolvedValueOnce(purchasePage([currentPage], 2, 12, 2))
      .mockResolvedValueOnce(purchasePage([match], 1, 1, 1))
    render(<Purchases />)

    expect(await screen.findByText('CURRENT-PAGE-2')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search purchases' }), { target: { value: searchTerm } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByText('SEARCH-MATCH')).toBeInTheDocument()
    expect(screen.getByText('1 result')).toBeInTheDocument()
    expect(window.adminPurchases.list).toHaveBeenNthCalledWith(1, 1, 6, undefined)
    expect(window.adminPurchases.list).toHaveBeenNthCalledWith(2, 1, 6, searchTerm)
    expect(screen.queryByRole('navigation', { name: 'Purchase history pages' })).not.toBeInTheDocument()
  })

  it('shows a no-results search state with a usable search control and no pagination', async () => {
    vi.mocked(window.adminPurchases.list)
      .mockResolvedValueOnce(purchasePage([purchase]))
      .mockResolvedValueOnce(purchasePage([], 1, 0, 0))
    render(<Purchases />)

    await screen.findByText('ORDER-1')
    const search = screen.getByRole('searchbox', { name: 'Search purchases' })
    fireEvent.change(search, { target: { value: 'no-such-purchase' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByText('No purchases match your search.')).toBeInTheDocument()
    expect(screen.getByText('0 results')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Purchase history pages' })).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search purchases' })).toBeEnabled()
  })

  it('keeps Purchase History loading and error feedback around server requests', async () => {
    let finish!: (page: PurchasePage) => void
    vi.mocked(window.adminPurchases.list).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    render(<Purchases />)

    expect(screen.getByText('Loading purchase history…')).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search purchases' })).toBeInTheDocument()
    await waitFor(() => expect(window.adminPurchases.list).toHaveBeenCalledTimes(1))
    finish(purchasePage([purchase]))
    expect(await screen.findByText('ORDER-1')).toBeInTheDocument()

    vi.mocked(window.adminPurchases.list).mockRejectedValueOnce(new Error('History unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('History unavailable')
    expect(screen.getByText('ORDER-1')).toBeInTheDocument()
  })

  it('opens and cancels the Add Purchase form without changing the existing workflow', async () => {
    render(<Purchases />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Purchase' }))
    expect(screen.getByRole('heading', { name: 'Add Purchase' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Add Purchase' })).not.toBeInTheDocument()
    expect(window.adminPurchases.importPdf).not.toHaveBeenCalled()
  })

  it('loads supplier options from the Electron API and does not show a fake list while loading', async () => {
    let finish!: (value: typeof supplierOptions) => void
    vi.mocked(window.adminPurchases.getManualSupplierOptions).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    render(<Purchases />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Purchase' }))

    const select = screen.getByLabelText('Supplier / Retailer')
    expect(select).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Loading supplier options')
    expect(within(select).queryByRole('option', { name: 'LEGO' })).not.toBeInTheDocument()
    expect(window.adminPurchases.getManualSupplierOptions).toHaveBeenCalledTimes(1)

    finish(supplierOptions)
    expect(await screen.findByRole('option', { name: "Sainsbury's" })).toBeInTheDocument()
    expect(select).toBeEnabled()
  })

  it('shows supplier-options load failures and retries through the Electron API', async () => {
    vi.mocked(window.adminPurchases.getManualSupplierOptions)
      .mockRejectedValueOnce(new Error('Supplier options are temporarily unavailable.'))
      .mockResolvedValueOnce(supplierOptions)
    render(<Purchases />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Purchase' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Supplier options are temporarily unavailable.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry supplier options' }))
    expect(await screen.findByRole('option', { name: 'B&M' })).toBeInTheDocument()
    expect(window.adminPurchases.getManualSupplierOptions).toHaveBeenCalledTimes(2)
  })

  it('renders only supplier choices returned by the backend', async () => {
    vi.mocked(window.adminPurchases.getManualSupplierOptions).mockResolvedValueOnce({
      canonicalSuppliers: ['Backend-provided retailer'], customSupplierOption: 'Others',
    })
    render(<Purchases />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Purchase' }))

    const select = screen.getByLabelText('Supplier / Retailer')
    expect(await screen.findByRole('option', { name: 'Backend-provided retailer' })).toBeInTheDocument()
    expect(within(select).queryByRole('option', { name: 'LEGO' })).not.toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Others' })).toBeInTheDocument()
  })

  it('creates a purchase with pound totals and opens it in the existing Purchase Review flow', async () => {
    render(<Purchases />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Purchase' }))
    fireEvent.change(screen.getByLabelText('Purchase reference *'), { target: { value: 'ORDER-17' } })
    await screen.findByRole('option', { name: "Sainsbury's" })
    fireEvent.change(screen.getByLabelText('Supplier / Retailer'), { target: { value: "Sainsbury's" } })
    fireEvent.change(screen.getByLabelText('Shipping (£)'), { target: { value: '2.00' } })
    fireEvent.change(screen.getByLabelText('Discount (£)'), { target: { value: '1.50' } })
    fireEvent.change(screen.getByLabelText('Description *'), { target: { value: 'Technic set' } })
    fireEvent.change(screen.getByLabelText('LEGO set number'), { target: { value: '42100' } })
    fireEvent.change(screen.getByLabelText('Quantity *'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Unit cost (£) *'), { target: { value: '10.00' } })
    expect(screen.getAllByText('£20.00')).toHaveLength(2)
    expect(screen.getByText('£20.50')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create purchase' }))
    await waitFor(() => expect(window.adminPurchases.createManual).toHaveBeenCalledWith(expect.objectContaining({
      sourceOrderReference: 'ORDER-17', merchantName: "Sainsbury's", originalGrossMerchandiseTotal: '20.00',
      shippingTotal: '2.00', discountTotal: '1.50', finalTotalPaid: '20.50',
      items: [{ sourceDescription: 'Technic set', sourceSetNumber: '42100', quantity: 2, originalGrossUnitCost: '10.00', originalGrossLineTotal: '20.00' }],
    })))
    await waitFor(() => expect(window.adminPurchases.review).toHaveBeenCalledWith(3))
    expect(window.adminPurchases.list).toHaveBeenCalledTimes(2)
    expect(window.adminPurchases.receive).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'ORDER-1' })).toBeInTheDocument()
  })

  it.each(["Sainsbury's", 'eBay', 'B&M'])('submits the exact backend canonical supplier value %s', async supplier => {
    render(<Purchases />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Purchase' }))
    await screen.findByRole('option', { name: supplier })
    fireEvent.change(screen.getByLabelText('Supplier / Retailer'), { target: { value: supplier } })
    fillMinimalPurchase()
    fireEvent.click(screen.getByRole('button', { name: 'Create purchase' }))

    await waitFor(() => expect(window.adminPurchases.createManual).toHaveBeenCalledWith(expect.objectContaining({ merchantName: supplier })))
  })

  it('requires a meaningful custom supplier and submits its trimmed value rather than Others', async () => {
    render(<Purchases />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Purchase' }))
    await screen.findByRole('option', { name: 'Others' })
    fireEvent.change(screen.getByLabelText('Supplier / Retailer'), { target: { value: 'Others' } })
    expect(screen.getByLabelText('Other supplier / retailer')).toBeInTheDocument()
    fillMinimalPurchase()
    fireEvent.click(screen.getByRole('button', { name: 'Create purchase' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the other supplier / retailer name')
    expect(window.adminPurchases.createManual).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Other supplier / retailer'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create purchase' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the other supplier / retailer name')
    expect(window.adminPurchases.createManual).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Other supplier / retailer'), { target: { value: '  Local Toy Shop  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create purchase' }))
    await waitFor(() => expect(window.adminPurchases.createManual).toHaveBeenCalledWith(expect.objectContaining({ merchantName: 'Local Toy Shop' })))
    expect(vi.mocked(window.adminPurchases.createManual).mock.calls[0][0].merchantName).not.toBe('Others')
  })

  it('discards stale custom supplier text when switching back to a predefined supplier', async () => {
    render(<Purchases />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Purchase' }))
    await screen.findByRole('option', { name: 'Others' })
    fireEvent.change(screen.getByLabelText('Supplier / Retailer'), { target: { value: 'Others' } })
    fireEvent.change(screen.getByLabelText('Other supplier / retailer'), { target: { value: 'Local Toy Shop' } })
    fireEvent.change(screen.getByLabelText('Supplier / Retailer'), { target: { value: 'LEGO' } })
    expect(screen.queryByLabelText('Other supplier / retailer')).not.toBeInTheDocument()
    fillMinimalPurchase()
    fireEvent.click(screen.getByRole('button', { name: 'Create purchase' }))

    await waitFor(() => expect(window.adminPurchases.createManual).toHaveBeenCalledWith(expect.objectContaining({ merchantName: 'LEGO' })))
    expect(vi.mocked(window.adminPurchases.createManual).mock.calls[0][0].merchantName).not.toBe('Local Toy Shop')
  })

  it('preserves optional no-supplier submission by omitting merchantName', async () => {
    render(<Purchases />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Purchase' }))
    await screen.findByRole('option', { name: 'B&M' })
    fillMinimalPurchase()
    fireEvent.click(screen.getByRole('button', { name: 'Create purchase' }))

    await waitFor(() => expect(window.adminPurchases.createManual).toHaveBeenCalledTimes(1))
    expect(vi.mocked(window.adminPurchases.createManual).mock.calls[0][0]).not.toHaveProperty('merchantName')
  })

  it('supports adding and removing purchase item rows', () => {
    render(<Purchases />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Purchase' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    expect(screen.getByText('Item 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove item 2' }))
    expect(screen.queryByText('Item 2')).not.toBeInTheDocument()
    expect(screen.getByText('Item 1')).toBeInTheDocument()
  })

  it('validates required purchase data and positive integer quantities', async () => {
    render(<Purchases />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Purchase' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create purchase' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Purchase reference is required')
    expect(window.adminPurchases.createManual).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Purchase reference *'), { target: { value: 'ORDER-17' } })
    fireEvent.change(screen.getByLabelText('Description *'), { target: { value: 'Set' } })
    fireEvent.change(screen.getByLabelText('Quantity *'), { target: { value: '1.5' } })
    fireEvent.change(screen.getByLabelText('Unit cost (£) *'), { target: { value: '4.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create purchase' }))
    expect(screen.getByRole('alert')).toHaveTextContent('positive whole number')
    expect(window.adminPurchases.createManual).not.toHaveBeenCalled()
  })

  it('prevents duplicate submission while a manual purchase request is pending', async () => {
    let finish!: (value: { purchaseId: number; documentId: number }) => void
    vi.mocked(window.adminPurchases.createManual).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    render(<Purchases />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Purchase' }))
    fireEvent.change(screen.getByLabelText('Purchase reference *'), { target: { value: 'ORDER-17' } })
    fireEvent.change(screen.getByLabelText('Description *'), { target: { value: 'Set' } })
    fireEvent.change(screen.getByLabelText('Unit cost (£) *'), { target: { value: '4.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create purchase' }))
    const pendingButton = screen.getByRole('button', { name: 'Creating purchase…' })
    expect(pendingButton).toBeDisabled()
    expect(pendingButton).toHaveAttribute('aria-busy', 'true')
    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    expect(cancelButton).toBeDisabled()
    expect(cancelButton).not.toHaveAttribute('aria-busy', 'true')
    expect(window.adminPurchases.createManual).toHaveBeenCalledTimes(1)
    finish({ purchaseId: 3, documentId: 4 })
    await waitFor(() => expect(window.adminPurchases.review).toHaveBeenCalledWith(3))
  })

  it('shows backend creation errors to the user', async () => {
    vi.mocked(window.adminPurchases.createManual).mockRejectedValueOnce(new Error('Purchase reference already exists.'))
    render(<Purchases />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Purchase' }))
    fireEvent.change(screen.getByLabelText('Purchase reference *'), { target: { value: 'ORDER-17' } })
    fireEvent.change(screen.getByLabelText('Description *'), { target: { value: 'Set' } })
    fireEvent.change(screen.getByLabelText('Unit cost (£) *'), { target: { value: '4.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create purchase' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Purchase reference already exists.'))
  })

  it('opens Purchase Analytics from Purchases and returns to purchase history', async () => {
    render(<Purchases />)
    fireEvent.click(screen.getByRole('button', { name: 'Purchase Analytics' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Purchase Summary' })).toBeInTheDocument())
    expect(window.adminPurchases.purchaseAnalyticsSummary).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Back to Purchases' }))
    expect(screen.getByRole('heading', { name: 'Purchases' })).toBeInTheDocument()
  })

  it('shows review-state status for unresolved purchases from either origin and preserves order and View details', async () => {
    const unresolvedPdf = historyRow(9, 'PDF-UNRESOLVED', 'pdf-hash-9')
    const unresolvedManual = historyRow(6724838930, '6724838930', 'manual:manual-hash-6724838930')
    const resolvedPdf = historyRow(7, 'PDF-RESOLVED', 'pdf-hash-7')
    const resolvedManual = historyRow(5, 'MANUAL-RESOLVED', 'manual:manual-hash-5')
    vi.mocked(window.adminPurchases.list).mockResolvedValueOnce({
      ...purchasePage([unresolvedPdf, unresolvedManual, resolvedPdf, resolvedManual]),
    })
    const reviewByPurchaseId = new Map([
      [unresolvedPdf.id, reviewState(unresolvedPdf, 'UNRESOLVED')],
      [unresolvedManual.id, reviewState(unresolvedManual, 'UNRESOLVED')],
      [resolvedPdf.id, reviewState(resolvedPdf, 'MATCHED')],
      [resolvedManual.id, reviewState(resolvedManual, 'MATCHED')],
    ])
    vi.mocked(window.adminPurchases.review).mockImplementation(async (purchaseId) => reviewByPurchaseId.get(purchaseId)!)

    render(<Purchases />)
    expect(await screen.findAllByText('WAITING FOR REVIEW')).toHaveLength(2)
    const rows = screen.getAllByRole('article')
    expect(rows.map((row) => row.querySelector('strong')?.textContent)).toEqual([
      'PDF-UNRESOLVED', '6724838930', 'PDF-RESOLVED', 'MANUAL-RESOLVED',
    ])
    expect(within(rows[0]).getByText('PDF-UNRESOLVED').parentElement).toHaveClass('purchase-row-reference')
    expect(within(rows[0]).getByText('WAITING FOR REVIEW')).toHaveClass('purchase-review-status')
    expect(within(rows[0]).getByText('20 Sept 2026 · 1 document')).toBeInTheDocument()
    expect(within(rows[1]).getByText('WAITING FOR REVIEW')).toHaveClass('purchase-review-status')
    expect(within(rows[2]).queryByText('WAITING FOR REVIEW')).not.toBeInTheDocument()
    expect(within(rows[3]).queryByText('WAITING FOR REVIEW')).not.toBeInTheDocument()
    expect(window.adminPurchases.review).toHaveBeenCalledWith(9)
    expect(window.adminPurchases.review).toHaveBeenCalledWith(6724838930)
    expect(window.adminPurchases.review).toHaveBeenCalledWith(7)
    expect(window.adminPurchases.review).toHaveBeenCalledWith(5)

    const detailReview: Review = { purchase, revision: 'b'.repeat(64), totalCost: '0.00', groups: [] }
    vi.mocked(window.adminPurchases.review).mockResolvedValueOnce(detailReview)
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'View details' }))
    expect(await screen.findByRole('heading', { name: 'ORDER-1' })).toBeInTheDocument()
    expect(window.adminPurchases.review).toHaveBeenLastCalledWith(9)
  })

  it('does not treat an explicitly excluded item with no listing as unresolved inventory work', async () => {
    const excludedPurchase = historyRow(12, 'MANUAL-GENERAL-ITEMS', 'manual:excluded-12')
    vi.mocked(window.adminPurchases.list).mockResolvedValueOnce(purchasePage([excludedPurchase]))
    vi.mocked(window.adminPurchases.review).mockResolvedValueOnce(reviewState(excludedPurchase, 'EXCLUDED'))
    render(<Purchases />)

    expect(await screen.findByText('MANUAL-GENERAL-ITEMS')).toBeInTheDocument()
    expect(screen.queryByText('WAITING FOR REVIEW')).not.toBeInTheDocument()
  })
})
