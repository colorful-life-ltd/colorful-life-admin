import { AuthError } from '../electron/auth-service'
import { describe, expect, it, vi } from 'vitest'
import { AuthService } from '../electron/auth-service.js'
import { PurchaseError, PurchaseService } from '../electron/purchase-service.js'

const item = { id: 1, productListingId: null, inventoryDisposition: 'INVENTORY', externalProductId: 'ASIN', sourceDescription: 'Example set', sourceSetNumber: '12345', sourceLineNumber: 1, quantity: 2, originalGrossUnitCost: '10.00', originalGrossLineTotal: '20.00', allocatedShipping: '1.00', allocatedDiscount: '0.50', finalLineCost: '20.50', finalUnitCost: '10.250000', receivedAt: null, returnedAt: null }
const document = { id: 2, purchaseId: 3, partNumber: 1, sourceInvoiceReference: 'INV-1', importHash: 'hash', sourceDocumentDate: '2026-09-20T00:00:00.000Z', importedByUserId: 7, originalGrossMerchandiseTotal: '20.00', shippingTotal: '1.00', discountTotal: '0.50', finalTotalPaid: '20.50', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', purchaseItems: [item] }
const purchase = { id: 3, sourceOrderReference: 'ORDER-1', sourceOrderDate: '2026-09-20T00:00:00.000Z', merchantName: null, createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', purchaseDocuments: [document] }
const historyPurchase = { ...purchase, purchaseDocuments: [{ ...document, purchaseItems: undefined }] }

describe('PurchaseService', () => {
  it('requests and maps backend-owned manual supplier options through the authenticated purchase client', async () => {
    const options = { canonicalSuppliers: ["Sainsbury's", 'eBay', 'B&M'], customSupplierOption: 'Others' }
    const authenticatedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(options), { status: 200 }))
    const service = new PurchaseService({ authenticatedFetch } as unknown as AuthService)

    await expect(service.getManualSupplierOptions()).resolves.toEqual(options)
    expect(authenticatedFetch).toHaveBeenCalledWith('/purchases/manual-supplier-options')
  })

  it('preserves supplier-options FORBIDDEN and SESSION_INVALID service errors', async () => {
    const authenticatedFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Admin access required' } }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'SESSION_INVALID', message: 'Session invalid' } }), { status: 401 }))
    const service = new PurchaseService({ authenticatedFetch } as unknown as AuthService)

    await expect(service.getManualSupplierOptions()).rejects.toMatchObject({ code: 'forbidden', backendCode: 'FORBIDDEN', status: 403 } satisfies Partial<PurchaseError>)
    await expect(service.getManualSupplierOptions()).rejects.toMatchObject({ code: 'session-invalid', backendCode: 'SESSION_INVALID', status: 401 } satisfies Partial<PurchaseError>)
  })

  it('keeps manual supplier-options SESSION_INVALID on the centralized AuthService renewal path', async () => {
    const expiry = '2099-01-01T00:00:00.000Z'
    const options = { canonicalSuppliers: ['Backend choice'], customSupplierOption: 'Others' }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'old-access', accessTokenExpiresAt: expiry, refreshToken: 'old-refresh', refreshExpiresAt: expiry }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 7, email: 'admin@example.test', role: 'ADMIN', createdAt: expiry, updatedAt: expiry }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'SESSION_INVALID', message: 'Session invalid' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'new-access', accessTokenExpiresAt: expiry, refreshToken: 'new-refresh', refreshExpiresAt: expiry }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(options), { status: 200 }))
    const auth = new AuthService('https://api.example.test', fetcher)
    await auth.login({ email: 'admin@example.test', password: 'password' })
    const service = new PurchaseService(auth)

    await expect(service.getManualSupplierOptions()).resolves.toEqual(options)
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://api.example.test/auth/login',
      'https://api.example.test/profile',
      'https://api.example.test/purchases/manual-supplier-options',
      'https://api.example.test/auth/refresh',
      'https://api.example.test/purchases/manual-supplier-options',
    ])
    expect(new Headers(fetcher.mock.calls[4][1]?.headers).get('Authorization')).toBe('Bearer new-access')
  })

  it('posts one multipart PDF and parses the import response', async () => {
    const authenticatedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Purchase invoice imported successfully', importHash: 'abc' }), { status: 201 }))
    const service = new PurchaseService({ authenticatedFetch } as unknown as AuthService)
    const result = await service.importPdf({ bytes: new Uint8Array([37, 80, 68, 70, 45]), filename: 'invoice.pdf', mimeType: 'application/pdf' })
    expect(result.importHash).toBe('abc')
    const init = authenticatedFetch.mock.calls[0][1] as RequestInit
    expect(authenticatedFetch.mock.calls[0][0]).toBe('/purchases/import')
    expect(init.method).toBe('POST')
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob)
  })

  it('parses history and details using the backend contracts', async () => {
    const authenticatedFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ purchases: [historyPurchase], pagination: { page: 1, pageSize: 6, totalItems: 1, totalPages: 1, limit: 6, total: 1 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(purchase), { status: 200 }))
    const service = new PurchaseService({ authenticatedFetch } as unknown as AuthService)
    expect((await service.list()).purchases[0].purchaseDocuments[0].purchaseItems).toBeUndefined()
    expect((await service.get(3)).sourceOrderReference).toBe('ORDER-1')
    expect(authenticatedFetch.mock.calls.map((call) => call[0])).toEqual(['/purchases?page=1&pageSize=6', '/purchases/3'])
  })

  it('passes page, pageSize and search through the authenticated history service using the backend contract', async () => {
    const page = { purchases: [], pagination: { page: 2, pageSize: 6, totalItems: 14, totalPages: 3, limit: 6, total: 14 } }
    const authenticatedFetch = vi.fn().mockImplementation(() => new Response(JSON.stringify(page), { status: 200 }))
    const service = new PurchaseService({ authenticatedFetch } as unknown as AuthService)

    await expect(service.list(2, 6, '171-')).resolves.toMatchObject({ pagination: page.pagination })
    expect(authenticatedFetch.mock.calls.at(-1)?.[0]).toBe('/purchases?page=2&pageSize=6&search=171-')
    await service.list(1, 6, '2026-09-27')
    expect(authenticatedFetch.mock.calls.at(-1)?.[0]).toBe('/purchases?page=1&pageSize=6&search=2026-09-27')
  })

  it('rejects a backend history page containing more purchases than its pageSize', async () => {
    const tooMany = Array.from({ length: 7 }, (_, id) => ({ ...historyPurchase, id: id + 1 }))
    const authenticatedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      purchases: tooMany,
      pagination: { page: 1, pageSize: 6, totalItems: 7, totalPages: 2, limit: 6, total: 7 },
    }), { status: 200 }))
    const service = new PurchaseService({ authenticatedFetch } as unknown as AuthService)

    await expect(service.list(1, 6)).rejects.toMatchObject({ code: 'malformed-response' } satisfies Partial<PurchaseError>)
  })


  it.each([
    [409, 'Another purchase conflict', 'conflict'],
    [400, 'Uploaded file is not a valid PDF', 'validation'],
    [500, 'Internal server error', 'server'],
  ])('does not classify HTTP %s failures as duplicates', async (status, message, code) => {
    const authenticatedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: message }), { status }))
    const service = new PurchaseService({ authenticatedFetch } as unknown as AuthService)
    await expect(service.importPdf({ bytes: new Uint8Array([1]), filename: 'same-name.pdf', mimeType: 'application/pdf' })).rejects.toMatchObject({ code, status })
  })

  it('reports an actionable network failure without claiming a duplicate or retrying', async () => {
    const authenticatedFetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const service = new PurchaseService({ authenticatedFetch } as unknown as AuthService)
    await expect(service.importPdf({ bytes: new Uint8Array([1]), filename: 'invoice.pdf', mimeType: 'application/pdf' })).rejects.toMatchObject({ code: 'server', message: expect.stringContaining('purchase history before retrying') })
    expect(authenticatedFetch).toHaveBeenCalledTimes(1)
  })

  it('preserves authentication errors rather than misreporting a network failure', async () => {
    const error = new AuthError('auth-required', 'Sign in is required to continue.')
    const service = new PurchaseService({ authenticatedFetch: vi.fn().mockRejectedValue(error) } as unknown as AuthService)
    await expect(service.importPdf({ bytes: new Uint8Array([1]), filename: 'invoice.pdf', mimeType: 'application/pdf' })).rejects.toBe(error)
  })

  it('maps duplicate and server responses to safe errors', async () => {
    const authenticatedFetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: `Duplicate import hash: ${'a'.repeat(64)}` }), { status: 409 })).mockResolvedValueOnce(new Response(null, { status: 500 }))
    const service = new PurchaseService({ authenticatedFetch } as unknown as AuthService)
    await expect(service.importPdf({ bytes: new Uint8Array([1]), filename: 'invoice.pdf', mimeType: 'application/pdf' })).rejects.toMatchObject({ code: 'duplicate', status: 409 } satisfies Partial<PurchaseError>)
    await expect(service.list()).rejects.toMatchObject({ code: 'server', status: 500 } satisfies Partial<PurchaseError>)
  })

  it('keeps FORBIDDEN and INTERNAL_SERVER_ERROR distinct in service errors', async () => {
    const authenticatedFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Not permitted' } }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } }), { status: 500 }))
    const service = new PurchaseService({ authenticatedFetch } as unknown as AuthService)
    await expect(service.list()).rejects.toMatchObject({ code: 'forbidden', backendCode: 'FORBIDDEN', status: 403 } satisfies Partial<PurchaseError>)
    await expect(service.list()).rejects.toMatchObject({ code: 'server', backendCode: 'INTERNAL_SERVER_ERROR', status: 500 } satisfies Partial<PurchaseError>)
  })

  it('requests and maps the backend purchase analytics summary without recalculating it', async () => {
    const summary = {
      totalQuantity: 1250,
      totalAmount: '18420.50',
      suppliers: [
        { supplierKey: 'supplier-abc', supplierName: 'Example Supplier', totalAmount: '8250.25' },
        { supplierKey: 'unknown', supplierName: 'Unknown supplier', totalAmount: '450.00' },
      ],
    }
    const authenticatedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(summary), { status: 200 }))
    const service = new PurchaseService({ authenticatedFetch } as unknown as AuthService)

    await expect(service.purchaseAnalyticsSummary()).resolves.toEqual(summary)
    expect(authenticatedFetch).toHaveBeenCalledWith('/purchase-analytics')
  })

  it('requests supplier monthly analytics using the encoded backend supplierKey and preserves its ordering', async () => {
    const monthly = {
      supplierKey: 'supplier-a/b',
      supplierName: 'Example Supplier',
      months: [{ month: '2026-09', totalAmount: '12.34' }, { month: '2026-08', totalAmount: '56.78' }],
      undatedTotalAmount: '6.66',
    }
    const authenticatedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(monthly), { status: 200 }))
    const service = new PurchaseService({ authenticatedFetch } as unknown as AuthService)

    await expect(service.supplierMonthlyAnalytics(monthly.supplierKey)).resolves.toEqual(monthly)
    expect(authenticatedFetch).toHaveBeenCalledWith('/purchase-analytics/suppliers/supplier-a%2Fb/monthly')
  })

  it('preserves analytics-specific structured backend errors without treating them as logout', async () => {
    const authenticatedFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'INVALID_SUPPLIER_KEY', message: 'Invalid supplier key' } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'PURCHASE_ANALYTICS_SUPPLIER_NOT_FOUND', message: 'Supplier not found' } }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }), { status: 403 }))
    const service = new PurchaseService({ authenticatedFetch } as unknown as AuthService)

    await expect(service.supplierMonthlyAnalytics('bad-key')).rejects.toMatchObject({ code: 'invalid-supplier-key', backendCode: 'INVALID_SUPPLIER_KEY', status: 400 } satisfies Partial<PurchaseError>)
    await expect(service.supplierMonthlyAnalytics('supplier-missing')).rejects.toMatchObject({ code: 'analytics-supplier-not-found', backendCode: 'PURCHASE_ANALYTICS_SUPPLIER_NOT_FOUND', status: 404 } satisfies Partial<PurchaseError>)
    await expect(service.purchaseAnalyticsSummary()).rejects.toMatchObject({ code: 'forbidden', backendCode: 'FORBIDDEN', status: 403 } satisfies Partial<PurchaseError>)
  })

  it('keeps analytics SESSION_INVALID responses on the centralized AuthService renewal path', async () => {
    const expiry = '2099-01-01T00:00:00.000Z'
    const responseBody = {
      totalQuantity: 0,
      totalAmount: '0.00',
      suppliers: [],
    }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'old-access', accessTokenExpiresAt: expiry, refreshToken: 'old-refresh', refreshExpiresAt: expiry }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 7, email: 'admin@example.test', role: 'ADMIN', createdAt: expiry, updatedAt: expiry }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'SESSION_INVALID', message: 'Session invalid' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'new-access', accessTokenExpiresAt: expiry, refreshToken: 'new-refresh', refreshExpiresAt: expiry }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(responseBody), { status: 200 }))
    const auth = new AuthService('https://api.example.test', fetcher)
    await auth.login({ email: 'admin@example.test', password: 'password' })
    const service = new PurchaseService(auth)

    await expect(service.purchaseAnalyticsSummary()).resolves.toEqual(responseBody)
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://api.example.test/auth/login',
      'https://api.example.test/profile',
      'https://api.example.test/purchase-analytics',
      'https://api.example.test/auth/refresh',
      'https://api.example.test/purchase-analytics',
    ])
    expect(new Headers(fetcher.mock.calls[4][1]?.headers).get('Authorization')).toBe('Bearer new-access')
  })
})
