import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductListing } from '../electron/product-contract'
import AddProduct from './AddProduct'

const product: ProductListing = {
  id: 123, legoProductId: 456, colorfulLifeCategory: 'VEHICLES', category: { id: 11, name: 'Vehicles', subtitle: 'Built for the thrill', description: null, imageUrl: null }, condition: 'NEW', originalPrice: '29.99', salePrice: null, currentStock: 2, availableStock: 2,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
  legoProduct: { id: 456, setNumber: '60325', title: 'Example Set', description: null, theme: 'City', ageRecommendation: '6+', pieceCount: 235, isRetired: false, isFeatureProduct: false, catalogueArtworkUrl: null, catalogueArtworkPublicId: null, productImages: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
}
const categories = [{ id: 11, name: 'Vehicles', subtitle: null, description: null, imageUrl: null, imagePublicId: null, thumbnailUrl: null, thumbnailPublicId: null }, { id: 29, name: 'Juniors', subtitle: null, description: null, imageUrl: null, imagePublicId: null, thumbnailUrl: null, thumbnailPublicId: null }]

const fillRequiredFields = async () => {
  await screen.findByRole('option', { name: 'Vehicles' })
  fireEvent.change(screen.getByLabelText('Set number'), { target: { value: '60325' } })
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Example Set' } })
  fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'City' } })
  fireEvent.change(screen.getByLabelText('Colorful Life Category'), { target: { value: '11' } })
  fireEvent.change(screen.getByLabelText('Age recommendation'), { target: { value: '6+' } })
  fireEvent.change(screen.getByLabelText('Piece count'), { target: { value: '235' } })
  fireEvent.change(screen.getByLabelText('Original price'), { target: { value: '29.99' } })
}

const imageFile = (name: string, type = 'image/jpeg', size = 16) => {
  const bytes = new Uint8Array(size)
  const signature = type === 'image/png' ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] : type === 'image/jpeg' ? [0xff, 0xd8, 0xff, 0xe0] : []
  bytes.set(signature.slice(0, size))
  return new File([bytes], name, { type, lastModified: 1 })
}
const legoProduct = (usedOfferStatus: 'AVAILABLE' | 'HISTORICAL_ONLY' | 'NONE' = 'NONE', isRetired = false) => ({ id: 456, setNumber: '60325', title: 'Existing Set', description: 'Shared description', theme: 'City', ageRecommendation: '6+', pieceCount: 235, category: { id: 11, name: 'Vehicles' }, isRetired, usedOfferStatus })
const lookupPage = (items: ReturnType<typeof legoProduct>[]) => ({ items, pagination: { page: 1, pageSize: 20, totalItems: items.length, totalPages: 1 } })
const usedOffer = { id: 77, legoProductId: 456, condition: 'USED_LIKE_NEW' as const, originalPrice: '45.00', salePrice: null, currentStock: 1 as const, usedLifecycle: 'AVAILABLE' as const, damageDescription: 'Creased outer box' }
const pngPhotoBytes = Uint8Array.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082'.match(/.{2}/g) ?? [], byte => Number.parseInt(byte, 16))

describe('AddProduct workflow', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() })
    window.adminProducts = { createProduct: vi.fn().mockResolvedValue(product), listProducts: vi.fn().mockResolvedValue([]), listAdminProductListings: vi.fn().mockResolvedValue([]), getProductAvailability: vi.fn().mockResolvedValue({ totalProducts: 0, totalInventory: 0, activeProducts: 0, inactiveProducts: 0 }), updateProductMetadata: vi.fn(), listProductImages: vi.fn().mockResolvedValue([]), uploadProductImage: vi.fn().mockResolvedValue({ id: 1, legoProductId: 456, url: 'https://cdn.test/image.jpg', publicId: 'image', altText: null, sortOrder: 0, createdAt: '2026-01-01' }), reorderProductImages: vi.fn().mockResolvedValue([]), updateProductImageAltText: vi.fn(), deleteProductImage: vi.fn(), setFeatureProduct: vi.fn(), uploadCatalogueArtwork: vi.fn(), removeCatalogueArtwork: vi.fn(), searchLegoProducts: vi.fn().mockResolvedValue(lookupPage([])), createUsedOffer: vi.fn().mockResolvedValue(usedOffer) }
    window.adminCategories = { list: vi.fn().mockResolvedValue(categories), getProductAvailability: vi.fn().mockResolvedValue({ totalProducts: 0, totalInventory: 0, activeProducts: 0, inactiveProducts: 0 }), create: vi.fn(), update: vi.fn(), uploadArtwork: vi.fn(), removeArtwork: vi.fn(), uploadThumbnailArtwork: vi.fn(), removeThumbnailArtwork: vi.fn() }
  })

  afterEach(() => cleanup())

  it.each(['0', '-1', '0.001', '0.005'])('rejects optional sale price %s before IPC even on programmatic submission', async value => {
    render(<AddProduct />)
    await fillRequiredFields()
    expect(screen.getByLabelText('Sale price')).toHaveAttribute('min', '0.01')
    fireEvent.change(screen.getByLabelText('Sale price'), { target: { value } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create product listing' }).closest('form') as HTMLFormElement)
    expect(await screen.findByRole('alert')).toHaveTextContent('greater than £0')
    expect(window.adminProducts.createProduct).not.toHaveBeenCalled()
  })

  it.each(['0', '-1', '0.001'])('rejects regular selling price %s before IPC', async value => {
    render(<AddProduct />)
    await fillRequiredFields()
    fireEvent.change(screen.getByLabelText('Original price'), { target: { value } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create product listing' }).closest('form') as HTMLFormElement)
    expect(await screen.findByRole('alert')).toHaveTextContent('greater than £0')
    expect(window.adminProducts.createProduct).not.toHaveBeenCalled()
  })

  it('keeps a valid one-penny promotion and the original selling price', async () => {
    render(<AddProduct />)
    await fillRequiredFields()
    fireEvent.change(screen.getByLabelText('Sale price'), { target: { value: '0.01' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create product listing' }).closest('form') as HTMLFormElement)
    await waitFor(() => expect(window.adminProducts.createProduct).toHaveBeenCalledWith(expect.objectContaining({ originalPrice: 29.99, salePrice: 0.01 })))
  })

  it('creates a product without images', async () => {
    render(<AddProduct />)
    expect(screen.getByLabelText('Retired Set')).not.toBeChecked()
    await fillRequiredFields()
    fireEvent.submit(screen.getByRole('button', { name: 'Create product listing' }).closest('form') as HTMLFormElement)
    await waitFor(() => expect(screen.getByText('Listing created: 123')).toBeInTheDocument())
    expect(window.adminProducts.createProduct).toHaveBeenCalledOnce()
    expect(window.adminProducts.createProduct).toHaveBeenCalledWith(expect.objectContaining({ theme: 'City', categoryId: 11, isRetired: false }))
    expect(window.adminProducts.uploadProductImage).not.toHaveBeenCalled()
  })

  it('notifies the parent only after the product workflow is complete', async () => {
    const onProductCreated = vi.fn()
    render(<AddProduct onProductCreated={onProductCreated} />)
    await fillRequiredFields()
    fireEvent.change(screen.getByLabelText('Product images'), { target: { files: [imageFile('cover.jpg')] } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create product listing' }).closest('form') as HTMLFormElement)
    await waitFor(() => expect(onProductCreated).toHaveBeenCalledWith(product))
    expect(window.adminProducts.uploadProductImage).toHaveBeenCalledOnce()
  })

  it('populates backend categories, including new categories, and requires an explicit selection', async () => {
    render(<AddProduct />)
    const selector = screen.getByLabelText('Colorful Life Category')
    expect(selector).toBeRequired()
    expect(await screen.findByRole('option', { name: 'Juniors' })).toHaveValue('29')
    expect(Array.from(selector.querySelectorAll('option')).map((option) => option.value)).toEqual(['', '11', '29'])
    expect(screen.getByLabelText('Theme')).toHaveValue('')
    expect(selector).toHaveValue('')
  })

  it('keeps the normal catalogue condition choice editable', () => {
    render(<AddProduct />)
    const condition = screen.getByLabelText('Condition')
    expect(screen.getByRole('option', { name: 'New – Outer Box Damage' })).toHaveValue('USED_LIKE_NEW')
    expect(screen.queryByText('Used – Like New')).not.toBeInTheDocument()
    fireEvent.change(condition, { target: { value: 'USED_LIKE_NEW' } })
    expect(condition).toHaveValue('USED_LIKE_NEW')
  })

  it('shows category loading failures and does not expose stale options', async () => {
    window.adminCategories.list = vi.fn().mockRejectedValue(new Error('Category service unavailable'))
    render(<AddProduct />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Category service unavailable')
    expect(screen.getByLabelText('Colorful Life Category')).toBeDisabled()
    expect(screen.queryByRole('option', { name: 'Vehicles' })).not.toBeInTheDocument()
  })

  it('sends isRetired true when Retired Set is selected for a new LegoProduct', async () => {
    render(<AddProduct />)
    await fillRequiredFields()
    fireEvent.click(screen.getByLabelText('Retired Set'))
    fireEvent.submit(screen.getByRole('button', { name: 'Create product listing' }).closest('form') as HTMLFormElement)
    await waitFor(() => expect(window.adminProducts.createProduct).toHaveBeenCalledWith(expect.objectContaining({ isRetired: true })))
  })

  it('switches to Admin existing-product lookup without querying the public catalogue', async () => {
    vi.mocked(window.adminProducts.searchLegoProducts).mockResolvedValue(lookupPage([legoProduct('HISTORICAL_ONLY'), legoProduct('NONE')]))
    render(<AddProduct />)
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'USED_LIKE_NEW' } })
    expect(screen.queryByLabelText('Set number')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search existing LEGO products'), { target: { value: '60325' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search products' }))
    expect(await screen.findByText(/Historical New – Outer Box Damage offers only/)).toBeInTheDocument()
    expect(screen.getByText(/No New – Outer Box Damage offer/)).toBeInTheDocument()
    expect(window.adminProducts.searchLegoProducts).toHaveBeenCalledWith('60325')
    expect(window.adminProducts.listProducts).not.toHaveBeenCalled()
    expect(window.adminProducts.createProduct).not.toHaveBeenCalled()
  })

  it('shows shared retirement status for selected damaged-box products without adding offer retirement input', async () => {
    vi.mocked(window.adminProducts.searchLegoProducts).mockResolvedValue(lookupPage([legoProduct('HISTORICAL_ONLY', true), { ...legoProduct('NONE'), id: 457, setNumber: '60326' }]))
    render(<AddProduct />)
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'USED_LIKE_NEW' } })
    expect(screen.queryByLabelText('Retired Set')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search existing LEGO products'), { target: { value: '60325' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search products' }))
    fireEvent.click(await screen.findByRole('button', { name: /Historical New – Outer Box Damage offers only/ }))
    expect(screen.getByText('Retired Set').parentElement).toHaveTextContent('Yes')
    expect(screen.getByText('Selected existing product').parentElement).toHaveTextContent('Retired Set')
    expect(screen.getByText('Selected existing product').parentElement).toHaveTextContent('Yes')
    fireEvent.click(screen.getByRole('button', { name: /No New – Outer Box Damage offer/ }))
    expect(screen.getByText('Selected existing product').parentElement).toHaveTextContent('Retired Set')
    expect(screen.getByText('Selected existing product').parentElement).toHaveTextContent('No')
  })

  it('blocks an AVAILABLE offer but permits HISTORICAL_ONLY and NONE statuses', async () => {
    render(<AddProduct />)
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'USED_LIKE_NEW' } })
    vi.mocked(window.adminProducts.searchLegoProducts).mockResolvedValue(lookupPage([legoProduct('AVAILABLE')]))
    fireEvent.change(screen.getByLabelText('Search existing LEGO products'), { target: { value: '60325' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search products' }))
    fireEvent.click(await screen.findByRole('button', { name: /Available New – Outer Box Damage offer exists/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('An available New – Outer Box Damage item already exists')
    const unavailableOffer = screen.getByRole('button', { name: 'Create New – Outer Box Damage offer' })
    expect(unavailableOffer).toBeDisabled()
    expect(unavailableOffer).toHaveAttribute('aria-busy', 'false')

    vi.mocked(window.adminProducts.searchLegoProducts).mockResolvedValue(lookupPage([legoProduct('HISTORICAL_ONLY'), { ...legoProduct('NONE'), id: 457, setNumber: '60326' }]))
    fireEvent.change(screen.getByLabelText('Search existing LEGO products'), { target: { value: '60326' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search products' }))
    fireEvent.click(await screen.findByRole('button', { name: /Historical New – Outer Box Damage offers only/ }))
    expect(screen.getByRole('button', { name: 'Create New – Outer Box Damage offer' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /No New – Outer Box Damage offer/ }))
    expect(screen.getByRole('button', { name: 'Create New – Outer Box Damage offer' })).toBeEnabled()
  })

  it('shows shared product data read-only, fixes quantity at one, and submits isolated condition photos to the Used endpoint', async () => {
    const onUsedOfferCreated = vi.fn()
    vi.mocked(window.adminProducts.searchLegoProducts).mockResolvedValue(lookupPage([legoProduct('HISTORICAL_ONLY')]))
    render(<AddProduct onUsedOfferCreated={onUsedOfferCreated} />)
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'USED_LIKE_NEW' } })
    fireEvent.change(screen.getByLabelText('Search existing LEGO products'), { target: { value: 'Existing Set' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search products' }))
    fireEvent.click(await screen.findByRole('button', { name: /Historical New – Outer Box Damage offers only/ }))
    expect(screen.getByText('Shared description')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity')).toHaveValue('1')
    expect(screen.getByLabelText('Quantity')).toHaveAttribute('readonly')
    expect(screen.queryByLabelText('Product images')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Sale price (£)'), { target: { value: '45.00' } })
    fireEvent.change(screen.getByLabelText('Damage description'), { target: { value: 'Creased outer box' } })
    fireEvent.change(screen.getByLabelText(/Condition Photos/), { target: { files: [imageFile('front.jpg'), imageFile('corner.png', 'image/png')] } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create New – Outer Box Damage offer' }).closest('form') as HTMLFormElement)
    await waitFor(() => expect(screen.getByText('New – Outer Box Damage offer created: 77')).toBeInTheDocument())
    const [productId, input] = vi.mocked(window.adminProducts.createUsedOffer).mock.calls[0]
    expect(productId).toBe(456)
    expect(input).toMatchObject({ salePrice: 45, damageDescription: 'Creased outer box' })
    expect(input).not.toHaveProperty('isRetired')
    expect(input.conditionPhotos.map(photo => photo.filename)).toEqual(['front.jpg', 'corner.png'])
    expect(input.conditionPhotos[0].bytes).toBeInstanceOf(Uint8Array)
    expect(window.adminProducts.createProduct).not.toHaveBeenCalled()
    expect(window.adminProducts.uploadProductImage).not.toHaveBeenCalled()
    expect(onUsedOfferCreated).toHaveBeenCalledWith(usedOffer, 11)
    expect(usedOffer.condition).toBe('USED_LIKE_NEW')
  })

  it('passes genuine PNG file bytes, names, and MIME types from React into condition-photo payloads', async () => {
    vi.mocked(window.adminProducts.searchLegoProducts).mockResolvedValue(lookupPage([legoProduct()]))
    render(<AddProduct />)
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'USED_LIKE_NEW' } })
    fireEvent.change(screen.getByLabelText('Search existing LEGO products'), { target: { value: '10759' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search products' }))
    fireEvent.click(await screen.findByRole('button', { name: /No New – Outer Box Damage offer/ }))
    fireEvent.change(screen.getByLabelText('Sale price (£)'), { target: { value: '19.99' } })
    fireEvent.change(screen.getByLabelText('Damage description'), { target: { value: 'Cosmetic outer box crease' } })
    const jpegBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9])
    const photoFiles = [
      new File([jpegBytes], '10759-used-1.png', { type: 'image/png' }),
      new File([pngPhotoBytes], '10759-used-2.jpg', { type: 'image/jpeg' }),
      new File([pngPhotoBytes], '10759-used-3.png', { type: 'image/png' }),
    ]
    fireEvent.change(screen.getByLabelText(/Condition Photos/), { target: { files: photoFiles } })
    expect(screen.getAllByAltText(/Condition photo/)).toHaveLength(3)
    fireEvent.submit(screen.getByRole('button', { name: 'Create New – Outer Box Damage offer' }).closest('form') as HTMLFormElement)
    await waitFor(() => expect(window.adminProducts.createUsedOffer).toHaveBeenCalledOnce())
    const [productId, payload] = vi.mocked(window.adminProducts.createUsedOffer).mock.calls[0]
    expect(productId).toBe(456)
    expect(payload.conditionPhotos.map(photo => [photo.filename, photo.mimeType])).toEqual([
      ['10759-used-1.jpg', 'image/jpeg'], ['10759-used-2.png', 'image/png'], ['10759-used-3.png', 'image/png'],
    ])
    expect(payload.conditionPhotos.map(photo => Array.from(photo.bytes))).toEqual([jpegBytes, pngPhotoBytes, pngPhotoBytes].map(bytes => Array.from(bytes)))
    expect(window.adminProducts.uploadProductImage).not.toHaveBeenCalled()
  })

  it('validates price, damage and photo counts; rejects unsupported photos', async () => {
    render(<AddProduct />)
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'USED_LIKE_NEW' } })
    vi.mocked(window.adminProducts.searchLegoProducts).mockResolvedValue(lookupPage([legoProduct()]))
    fireEvent.change(screen.getByLabelText('Search existing LEGO products'), { target: { value: '60325' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search products' }))
    fireEvent.click(await screen.findByRole('button', { name: /No New – Outer Box Damage offer/ }))
    fireEvent.submit(screen.getByRole('button', { name: 'Create New – Outer Box Damage offer' }).closest('form') as HTMLFormElement)
    expect(await screen.findByRole('alert')).toHaveTextContent('greater than £0')
    fireEvent.change(screen.getByLabelText('Sale price (£)'), { target: { value: '12' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create New – Outer Box Damage offer' }).closest('form') as HTMLFormElement)
    expect(screen.getByRole('alert')).toHaveTextContent('damage description')
    fireEvent.change(screen.getByLabelText('Damage description'), { target: { value: 'Dent' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create New – Outer Box Damage offer' }).closest('form') as HTMLFormElement)
    expect(screen.getByRole('alert')).toHaveTextContent('1 to 3 Condition Photos')
    fireEvent.change(screen.getByLabelText(/Condition Photos/), { target: { files: [imageFile('bad.gif', 'image/gif')] } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create New – Outer Box Damage offer' }).closest('form') as HTMLFormElement)
    expect(await screen.findByRole('alert')).toHaveTextContent('bad.gif is not a supported JPEG, PNG, or WebP image.')
    expect(window.adminProducts.createUsedOffer).not.toHaveBeenCalled()
  })

  it('preserves entered data after a backend duplicate conflict and prevents duplicate submissions', async () => {
    let resolveCreate: ((value: typeof usedOffer) => void) | undefined
    const createUsed = vi.fn().mockImplementationOnce(() => new Promise<typeof usedOffer>((resolve) => { resolveCreate = resolve }))
    window.adminProducts.createUsedOffer = createUsed
    const onUsedOfferCreated = vi.fn()
    vi.mocked(window.adminProducts.searchLegoProducts).mockResolvedValue(lookupPage([legoProduct()]))
    render(<AddProduct onUsedOfferCreated={onUsedOfferCreated} />)
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'USED_LIKE_NEW' } })
    fireEvent.change(screen.getByLabelText('Search existing LEGO products'), { target: { value: '60325' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search products' }))
    fireEvent.click(await screen.findByRole('button', { name: /No New – Outer Box Damage offer/ }))
    fireEvent.change(screen.getByLabelText('Sale price (£)'), { target: { value: '45' } })
    fireEvent.change(screen.getByLabelText('Damage description'), { target: { value: 'Dent' } })
    fireEvent.change(screen.getByLabelText(/Condition Photos/), { target: { files: [imageFile('front.jpg')] } })
    const form = screen.getByRole('button', { name: 'Create New – Outer Box Damage offer' }).closest('form') as HTMLFormElement
    fireEvent.submit(form)
    const pendingButton = await screen.findByRole('button', { name: 'Creating New – Outer Box Damage offer…' })
    expect(pendingButton).toBeDisabled()
    expect(pendingButton).toHaveAttribute('aria-busy', 'true')
    fireEvent.submit(form)
    expect(createUsed).toHaveBeenCalledOnce()
    resolveCreate?.(usedOffer)
    await waitFor(() => expect(onUsedOfferCreated).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button', { name: /Creating New – Outer Box Damage offer/ })).not.toBeInTheDocument()
    expect(onUsedOfferCreated).toHaveBeenCalledWith(usedOffer, 11)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not report success or reset fields when a Used creation conflicts', async () => {
    window.adminProducts.createUsedOffer = vi.fn().mockRejectedValue(new Error('An available Used offer already exists for this product'))
    vi.mocked(window.adminProducts.searchLegoProducts).mockResolvedValue(lookupPage([legoProduct('HISTORICAL_ONLY')]))
    render(<AddProduct />)
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'USED_LIKE_NEW' } })
    fireEvent.change(screen.getByLabelText('Search existing LEGO products'), { target: { value: '60325' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search products' }))
    fireEvent.click(await screen.findByRole('button', { name: /Historical New – Outer Box Damage offers only/ }))
    fireEvent.change(screen.getByLabelText('Sale price (£)'), { target: { value: '45' } })
    fireEvent.change(screen.getByLabelText('Damage description'), { target: { value: 'Dent' } })
    fireEvent.change(screen.getByLabelText(/Condition Photos/), { target: { files: [imageFile('front.jpg')] } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create New – Outer Box Damage offer' }).closest('form') as HTMLFormElement)
    expect(await screen.findByRole('alert')).toHaveTextContent('An available New – Outer Box Damage item already exists')
    expect(screen.queryByText(/offer created/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Sale price (£)')).toHaveValue(45)
    expect(screen.getByLabelText('Damage description')).toHaveValue('Dent')
    expect(screen.getAllByAltText(/Condition photo/)).toHaveLength(1)
  })

  it('uploads one image with the selected binary and keeps it as the cover', async () => {
    render(<AddProduct />)
    await fillRequiredFields()
    const mislabeledJpeg = new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70])], 'cover.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Product images'), { target: { files: [mislabeledJpeg] } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create product listing' }).closest('form') as HTMLFormElement)
    await waitFor(() => expect(screen.getByText('Product listing and images are ready.')).toBeInTheDocument())
    const [, payload] = (window.adminProducts.uploadProductImage as ReturnType<typeof vi.fn>).mock.calls[0]
    expect((window.adminProducts.uploadProductImage as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(456)
    expect(payload.filename).toBe('cover.jpg')
    expect(payload.mimeType).toBe('image/jpeg')
    expect(payload.bytes).toEqual(new Uint8Array(await mislabeledJpeg.arrayBuffer()))
    expect(window.adminProducts.createProduct).toHaveBeenCalledOnce()
  })

  it('uploads multiple images sequentially in selection order', async () => {
    render(<AddProduct />)
    await fillRequiredFields()
    fireEvent.change(screen.getByLabelText('Product images'), { target: { files: [imageFile('cover.jpg'), imageFile('second.png', 'image/png')] } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create product listing' }).closest('form') as HTMLFormElement)
    await waitFor(() => expect(screen.getByText('Product listing and images are ready.')).toBeInTheDocument())
    expect((window.adminProducts.uploadProductImage as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan((window.adminProducts.uploadProductImage as ReturnType<typeof vi.fn>).mock.invocationCallOrder[1])
    expect((window.adminProducts.uploadProductImage as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1].filename)).toEqual(['cover.jpg', 'second.png'])
  })

  it('keeps the created listing and retries only a failed later image', async () => {
    const upload = vi.fn().mockResolvedValueOnce({ id: 1, legoProductId: 456, url: 'https://cdn.test/one.jpg', publicId: 'one', altText: null, sortOrder: 0, createdAt: '2026-01-01' }).mockRejectedValueOnce(new Error('Image upload failed')).mockResolvedValueOnce({ id: 2, legoProductId: 456, url: 'https://cdn.test/two.jpg', publicId: 'two', altText: null, sortOrder: 1, createdAt: '2026-01-01' })
    window.adminProducts.uploadProductImage = upload
    render(<AddProduct />)
    await fillRequiredFields()
    fireEvent.change(screen.getByLabelText('Product images'), { target: { files: [imageFile('one.jpg'), imageFile('two.jpg')] } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create product listing' }).closest('form') as HTMLFormElement)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry failed images' })).toBeInTheDocument())
    expect(window.adminProducts.createProduct).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed images' }))
    await waitFor(() => expect(screen.getByText('Product listing and images are ready.')).toBeInTheDocument())
    expect(window.adminProducts.createProduct).toHaveBeenCalledOnce()
    expect(upload).toHaveBeenCalledTimes(3)
    expect(upload.mock.calls[2][1].filename).toBe('two.jpg')
  })

  it('does not offer retry while the initial sequential upload is active', async () => {
    let resolveSecond: (() => void) | undefined
    const secondUpload = new Promise<void>((resolve) => { resolveSecond = resolve })
    const upload = vi.fn()
      .mockResolvedValueOnce({ id: 1, legoProductId: 456, url: 'https://cdn.test/one.jpg', publicId: 'one', altText: null, sortOrder: 0, createdAt: '2026-01-01' })
      .mockImplementationOnce(() => secondUpload.then(() => { throw new Error('Image upload failed') }))
      .mockResolvedValueOnce({ id: 2, legoProductId: 456, url: 'https://cdn.test/two.jpg', publicId: 'two', altText: null, sortOrder: 1, createdAt: '2026-01-01' })
    window.adminProducts.uploadProductImage = upload
    render(<AddProduct />)
    await fillRequiredFields()
    fireEvent.change(screen.getByLabelText('Product images'), { target: { files: [imageFile('one.jpg'), imageFile('two.jpg')] } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create product listing' }).closest('form') as HTMLFormElement)
    await waitFor(() => expect(screen.getByText('Product created. 1 of 2 images uploaded.')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Retry failed images' })).not.toBeInTheDocument()
    resolveSecond?.()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry failed images' })).toBeInTheDocument())
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('resets only the completed renderer workflow and allows another product submission', async () => {
    render(<AddProduct />)
    await fillRequiredFields()
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'First product' } })
    fireEvent.change(screen.getByLabelText('Product images'), { target: { files: [imageFile('first.jpg')] } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create product listing' }).closest('form') as HTMLFormElement)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add another product' })).toBeInTheDocument())
    const createProduct = window.adminProducts.createProduct as ReturnType<typeof vi.fn>
    const uploadImage = window.adminProducts.uploadProductImage as ReturnType<typeof vi.fn>
    expect(createProduct).toHaveBeenCalledOnce()
    expect(uploadImage).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Add another product' }))
    expect(screen.getByLabelText('Set number')).toHaveValue('')
    expect(screen.getByLabelText('Description')).toHaveValue('')
    expect(screen.getByLabelText('Colorful Life Category')).toHaveValue('')
    expect(screen.queryByText('Listing created: 123')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create product listing' })).toBeInTheDocument()
    expect(createProduct).toHaveBeenCalledOnce()
    expect(uploadImage).toHaveBeenCalledOnce()

    await fillRequiredFields()
    fireEvent.change(screen.getByLabelText('Set number'), { target: { value: '60400' } })
    fireEvent.change(screen.getByLabelText('Colorful Life Category'), { target: { value: '29' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create product listing' }).closest('form') as HTMLFormElement)
    await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(2))
    expect(createProduct).toHaveBeenLastCalledWith(expect.objectContaining({ setNumber: '60400', theme: 'City', categoryId: 29 }))
    expect(uploadImage).toHaveBeenCalledOnce()
  })

  it('rejects unsupported image bytes during local upload and enforces size and count limits', async () => {
    render(<AddProduct />)
    await fillRequiredFields()
    const input = screen.getByLabelText('Product images')
    fireEvent.change(input, { target: { files: [imageFile('bad.gif', 'image/gif')] } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create product listing' }).closest('form') as HTMLFormElement)
    await waitFor(() => expect(screen.getByText('Listing created: 123')).toBeInTheDocument())
    expect(await screen.findByText('Failed: bad.gif is not a supported JPEG, PNG, or WebP image.')).toBeInTheDocument()
    expect(window.adminProducts.uploadProductImage).not.toHaveBeenCalled()
  })

  it('enforces product-image size and count limits before submission', () => {
    render(<AddProduct />)
    const input = screen.getByLabelText('Product images')
    fireEvent.change(input, { target: { files: [imageFile('large.jpg', 'image/jpeg', 8 * 1024 * 1024 + 1)] } })
    expect(screen.getByRole('alert')).toHaveTextContent('exceeds the 8 MiB')
    fireEvent.change(input, { target: { files: Array.from({ length: 11 }, (_, index) => imageFile(`${index}.jpg`)) } })
    expect(screen.getByRole('alert')).toHaveTextContent('at most 10 images')
    expect(screen.getAllByRole('img')).toHaveLength(10)
  })
})
