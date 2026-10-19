import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type { AdminCategory } from '../electron/category-contract'
import type { AdminLegoProduct, ImageUploadPayload, ProductImage, ProductMetadataUpdate } from '../electron/product-contract'
import { adminCategories, adminProducts } from './admin-api'
import { normalizeImageFile } from './image-normalization'
import './ProductEditor.css'

const maximumImages = 10
const maximumImageBytes = 8 * 1024 * 1024

interface ProductForm {
  title: string
  description: string
  theme: string
  ageRecommendation: string
  pieceCount: string
  isRetired: boolean
  categoryId: string
}

type ImageAction = 'adding' | 'replacing' | 'removing' | 'reordering' | null

const formForProduct = (product: AdminLegoProduct): ProductForm => ({
  title: product.title,
  description: product.description ?? '',
  theme: product.theme,
  ageRecommendation: product.ageRecommendation,
  pieceCount: String(product.pieceCount),
  isRetired: product.isRetired,
  categoryId: product.category ? String(product.category.id) : '',
})

const metadataChanges = (product: AdminLegoProduct, form: ProductForm): ProductMetadataUpdate => {
  const update: ProductMetadataUpdate = {}
  if (form.title !== product.title) update.title = form.title.trim()
  if (form.description !== (product.description ?? '')) update.description = form.description
  if (form.theme !== product.theme) update.theme = form.theme.trim()
  if (form.ageRecommendation !== product.ageRecommendation) update.ageRecommendation = form.ageRecommendation.trim()
  const pieceCount = Number(form.pieceCount)
  if (Number.isInteger(pieceCount) && pieceCount > 0 && pieceCount !== product.pieceCount) update.pieceCount = pieceCount
  if (form.isRetired !== product.isRetired) update.isRetired = form.isRetired
  if (form.categoryId !== (product.category ? String(product.category.id) : '')) {
    const categoryId = Number(form.categoryId)
    if (Number.isInteger(categoryId) && categoryId > 0) update.categoryId = categoryId
  }
  return update
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'The product action could not be completed.'

const orderedImages = (images: ProductImage[]) => [...images].sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id)

function ProductEditor() {
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [categoriesError, setCategoriesError] = useState('')
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<AdminLegoProduct[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<AdminLegoProduct | null>(null)
  const [form, setForm] = useState<ProductForm | null>(null)
  const [images, setImages] = useState<ProductImage[]>([])
  const [imagesLoading, setImagesLoading] = useState(false)
  const [imagesError, setImagesError] = useState('')
  const [imagesLoadAttempt, setImagesLoadAttempt] = useState(0)
  const [imageAction, setImageAction] = useState<ImageAction>(null)
  const [imageMessage, setImageMessage] = useState('')
  const [imageError, setImageError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const selectedProductId = selectedProduct?.id

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => adminCategories.list()).then(
      result => { if (!cancelled) setCategories(result) },
      error => { if (!cancelled) { setCategories([]); setCategoriesError(getErrorMessage(error)) } },
    ).finally(() => { if (!cancelled) setCategoriesLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (selectedProductId === undefined) return
    let cancelled = false
    void Promise.resolve().then(() => adminProducts.listProductImages(selectedProductId)).then(
      result => { if (!cancelled) setImages(orderedImages(result)) },
      error => { if (!cancelled) { setImages([]); setImagesError(getErrorMessage(error)) } },
    ).finally(() => { if (!cancelled) setImagesLoading(false) })
    return () => { cancelled = true }
  }, [selectedProductId, imagesLoadAttempt])

  const changes = useMemo(() => selectedProduct && form ? metadataChanges(selectedProduct, form) : {}, [selectedProduct, form])
  const hasChanges = !!selectedProduct && !!form && (
    form.title !== selectedProduct.title || form.description !== (selectedProduct.description ?? '') || form.theme !== selectedProduct.theme ||
    form.ageRecommendation !== selectedProduct.ageRecommendation || form.pieceCount !== String(selectedProduct.pieceCount) ||
    form.isRetired !== selectedProduct.isRetired || form.categoryId !== (selectedProduct.category ? String(selectedProduct.category.id) : '')
  )
  const isFormValid = !!selectedProduct && !!form && form.title.trim().length > 0 && form.theme.trim().length > 0 && form.ageRecommendation.trim().length > 0 &&
    Number.isInteger(Number(form.pieceCount)) && Number(form.pieceCount) > 0 &&
    (form.categoryId === (selectedProduct.category ? String(selectedProduct.category.id) : '') ||
      (Number.isInteger(Number(form.categoryId)) && Number(form.categoryId) > 0 && categories.some(category => category.id === Number(form.categoryId))))
  const canSave = hasChanges && isFormValid && !isSaving && !imageAction && !imagesLoading
  const validationMessage = hasChanges && !isFormValid ? 'Complete the required fields with valid values before saving.' : ''

  const searchProducts = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const searchTerm = query.trim()
    if (isSearching || isSaving || imageAction || !searchTerm) return
    if (selectedProduct && form && hasChanges && !window.confirm('Discard unsaved product changes and search for another product?')) return
    setSelectedProduct(null)
    setForm(null)
    setImages([])
    setImagesLoading(false)
    setImagesError('')
    setImageMessage('')
    setImageError('')
    setSaveMessage('')
    setSaveError('')
    setSearchResults([])
    setIsSearching(true)
    setHasSearched(false)
    setSearchError('')
    try {
      const result = await adminProducts.searchLegoProducts(searchTerm)
      setSearchResults(result.items)
      setHasSearched(true)
    } catch (error) {
      setSearchResults([])
      setSearchError(getErrorMessage(error))
    } finally {
      setIsSearching(false)
    }
  }

  const selectProduct = (product: AdminLegoProduct) => {
    if (imageAction || isSaving || product.id === selectedProduct?.id) return
    if (selectedProduct && form && hasChanges && !window.confirm('Discard unsaved product changes and edit another product?')) return
    setSelectedProduct(product)
    setForm(formForProduct(product))
    setImages([])
    setImagesLoading(true)
    setImagesError('')
    setSaveMessage('')
    setSaveError('')
    setImageMessage('')
    setImageError('')
  }

  const saveProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedProduct || !form || !canSave) return
    setIsSaving(true)
    setSaveMessage('')
    setSaveError('')
    try {
      const updated = await adminProducts.updateProductMetadata(selectedProduct.id, changes)
      const nextProduct: AdminLegoProduct = {
        ...selectedProduct,
        setNumber: updated.setNumber,
        title: updated.title,
        description: updated.description,
        theme: updated.theme,
        ageRecommendation: updated.ageRecommendation,
        pieceCount: updated.pieceCount,
        isRetired: updated.isRetired,
        category: updated.category ? { id: updated.category.id, name: updated.category.name } : null,
      }
      setSelectedProduct(nextProduct)
      setSearchResults(current => current.map(product => product.id === nextProduct.id ? nextProduct : product))
      setForm(formForProduct(nextProduct))
      setImages(orderedImages(updated.productImages))
      setImagesError('')
      setSaveMessage('Product details saved.')
    } catch (error) {
      setSaveError(getErrorMessage(error))
    } finally {
      setIsSaving(false)
    }
  }

  const refreshImages = async (productId: number) => {
    try {
      const current = await adminProducts.listProductImages(productId)
      setImages(orderedImages(current))
      setImagesError('')
    } catch (error) {
      setImagesError(getErrorMessage(error))
      throw error
    }
  }

  const addImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!selectedProduct || files.length === 0 || imagesError || imageAction || isSaving) return
    setImageError('')
    setImageMessage('')
    const validFiles: File[] = []
    let validationError = ''
    for (const file of files) {
      if (images.length + validFiles.length >= maximumImages) {
        validationError = 'A product can have at most 10 images.'
        break
      }
      if (file.size === 0) { validationError = `${file.name} is empty and cannot be uploaded.`; continue }
      if (file.size > maximumImageBytes) { validationError = `${file.name} exceeds the 8 MiB image limit.`; continue }
      validFiles.push(file)
    }
    if (validationError) setImageError(validationError)
    if (validFiles.length === 0) return
    setImageAction('adding')
    let uploadedCount = 0
    try {
      for (const file of validFiles) {
        const payload = await normalizeImageFile(file)
        const uploaded = await adminProducts.uploadProductImage(selectedProduct.id, payload)
        setImages(current => orderedImages([...current, uploaded]))
        uploadedCount += 1
      }
      setImageMessage(`${uploadedCount} ${uploadedCount === 1 ? 'image' : 'images'} added.`)
    } catch (error) {
      setImageError(`${uploadedCount > 0 ? `${uploadedCount} image${uploadedCount === 1 ? '' : 's'} added. ` : ''}${getErrorMessage(error)}`)
      try { await refreshImages(selectedProduct.id) } catch { /* Keep the original upload failure visible. */ }
    } finally {
      setImageAction(null)
    }
  }

  const removeImage = async (image: ProductImage) => {
    if (!selectedProduct || imagesError || imageAction || isSaving) return
    if (!window.confirm(`Remove product image ${image.sortOrder + 1}? This action cannot be undone.`)) return
    setImageAction('removing')
    setImageError('')
    setImageMessage('')
    try {
      await adminProducts.deleteProductImage(selectedProduct.id, image.id)
      await refreshImages(selectedProduct.id)
      setImageMessage('Product image removed.')
    } catch (error) {
      setImageError(getErrorMessage(error))
      try { await refreshImages(selectedProduct.id) } catch { /* Keep the original removal failure visible. */ }
    } finally {
      setImageAction(null)
    }
  }

  const replaceImage = async (image: ProductImage, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!selectedProduct || !file || imagesError || imageAction || isSaving) return
    if (file.size === 0) { setImageError(`${file.name} is empty and cannot be uploaded.`); return }
    if (file.size > maximumImageBytes) { setImageError(`${file.name} exceeds the 8 MiB image limit.`); return }
    setImageAction('replacing')
    setImageError('')
    setImageMessage('')
    try {
      const payload: ImageUploadPayload = await normalizeImageFile(file)
      const deleteFirst = images.length >= maximumImages
      const confirmation = deleteFirst
        ? 'This product already has 10 images. The selected image must be removed before its replacement can upload; if the upload fails, the selected image will be gone. Continue?'
        : `Upload a replacement for product image ${image.sortOrder + 1}, then remove the current image?`
      if (!window.confirm(confirmation)) return
      if (deleteFirst) {
        await adminProducts.deleteProductImage(selectedProduct.id, image.id)
        setImages(current => orderedImages(current.filter(entry => entry.id !== image.id)))
      }
      await adminProducts.uploadProductImage(selectedProduct.id, payload)
      if (!deleteFirst) await adminProducts.deleteProductImage(selectedProduct.id, image.id)
      await refreshImages(selectedProduct.id)
      setImageMessage('Product image replaced.')
    } catch (error) {
      setImageError(getErrorMessage(error))
      try { await refreshImages(selectedProduct.id) } catch { /* Keep the original replacement failure visible. */ }
    } finally {
      setImageAction(null)
    }
  }

  const moveImage = async (imageIndex: number, direction: -1 | 1) => {
    if (!selectedProduct || imagesError || imageAction || isSaving) return
    const targetIndex = imageIndex + direction
    if (targetIndex < 0 || targetIndex >= images.length) return
    const reordered = [...images]
    const [moved] = reordered.splice(imageIndex, 1)
    if (!moved) return
    reordered.splice(targetIndex, 0, moved)
    setImageAction('reordering')
    setImageError('')
    setImageMessage('')
    try {
      const result = await adminProducts.reorderProductImages(selectedProduct.id, reordered.map(image => image.id))
      setImages(orderedImages(result))
      setImageMessage('Product image order saved.')
    } catch (error) {
      setImageError(getErrorMessage(error))
      try { await refreshImages(selectedProduct.id) } catch { /* Keep the original reorder failure visible. */ }
    } finally {
      setImageAction(null)
    }
  }

  return (
    <section className="product-editor" aria-labelledby="product-editor-title">
      <div className="product-editor-heading">
        <div><p className="eyebrow">CATALOGUE</p><h2 id="product-editor-title">Edit existing product</h2></div>
      </div>
      <p className="product-editor-intro">Search by LEGO set number or product title. Shared details and Product Images apply to every listing for this LEGO product.</p>
      <p className="product-editor-boundary">Inventory, offer prices, purchase history, Used lifecycle, Used Condition Photos, and Catalogue Artwork are managed separately.</p>

      <form className="product-editor-search" onSubmit={event => void searchProducts(event)}>
        <label htmlFor="product-editor-query">Set number or product title</label>
        <div className="product-editor-search-controls">
          <input id="product-editor-query" value={query} onChange={event => setQuery(event.target.value)} maxLength={100} required />
          <button className="button button-primary" type="submit" disabled={isSearching || isSaving || !!imageAction || !query.trim()} aria-busy={isSearching}>{isSearching ? 'Searching…' : 'Search products'}</button>
        </div>
      </form>
      {searchError && <p className="error-message" role="alert">Unable to search products: {searchError}</p>}
      {hasSearched && <>
        {searchResults.length === 0 ? <p className="product-editor-empty" role="status">No products found.</p> :
          <ul className="product-editor-results" aria-label="Product search results">
            {searchResults.map(product => <li key={product.id}>
              <button type="button" className={`product-editor-result${selectedProduct?.id === product.id ? ' product-editor-result-selected' : ''}`} onClick={() => selectProduct(product)} disabled={!!imageAction || isSaving} aria-pressed={selectedProduct?.id === product.id}>
                <span><strong>{product.setNumber} · {product.title}</strong><small>LEGO product #{product.id}{product.category ? ` · ${product.category.name}` : ''}</small></span>
                <span>{selectedProduct?.id === product.id ? 'Selected' : 'Edit product'}</span>
              </button>
            </li>)}
          </ul>}
      </>}

      {selectedProduct && form && <>
        <section className="product-editor-section" aria-labelledby="shared-details-title">
          <div className="product-editor-section-heading"><div><h3 id="shared-details-title">Shared product details</h3><p>LEGO product #{selectedProduct.id} · {selectedProduct.setNumber}</p></div></div>
          <form className="product-editor-form" onSubmit={event => void saveProduct(event)}>
            <label>Title<input value={form.title} onChange={event => { setForm(current => current ? { ...current, title: event.target.value } : current); setSaveMessage(''); setSaveError('') }} required aria-invalid={form.title.trim().length === 0} disabled={isSaving} /></label>
            <label>Description<textarea value={form.description} onChange={event => { setForm(current => current ? { ...current, description: event.target.value } : current); setSaveMessage(''); setSaveError('') }} disabled={isSaving} /></label>
            <label>Theme<input value={form.theme} onChange={event => { setForm(current => current ? { ...current, theme: event.target.value } : current); setSaveMessage(''); setSaveError('') }} required aria-invalid={form.theme.trim().length === 0} disabled={isSaving} /></label>
            <label>Age recommendation<input value={form.ageRecommendation} onChange={event => { setForm(current => current ? { ...current, ageRecommendation: event.target.value } : current); setSaveMessage(''); setSaveError('') }} required aria-invalid={form.ageRecommendation.trim().length === 0} disabled={isSaving} /></label>
            <label>Piece count<input type="number" min="1" step="1" value={form.pieceCount} onChange={event => { setForm(current => current ? { ...current, pieceCount: event.target.value } : current); setSaveMessage(''); setSaveError('') }} required aria-invalid={!Number.isInteger(Number(form.pieceCount)) || Number(form.pieceCount) < 1} disabled={isSaving} /></label>
            <div className="product-retired-field"><label className="product-retired-control"><span>Retired Set</span><input type="checkbox" checked={form.isRetired} onChange={event => { setForm(current => current ? { ...current, isRetired: event.target.checked } : current); setSaveMessage(''); setSaveError('') }} disabled={isSaving} aria-describedby="edit-retired-set-help" /></label><p id="edit-retired-set-help">Manufacturer retirement information only. This does not mark the shop product Discontinued.</p></div>
            <label>Category<select value={form.categoryId} onChange={event => { setForm(current => current ? { ...current, categoryId: event.target.value } : current); setSaveMessage(''); setSaveError('') }} disabled={isSaving || categoriesLoading || !!categoriesError}>
              <option value="">No category selected</option>
              {selectedProduct.category && !categories.some(category => category.id === selectedProduct.category?.id) && <option value={selectedProduct.category.id}>{selectedProduct.category.name} (current)</option>}
              {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select></label>
            {categoriesLoading && <p className="product-editor-note" role="status">Loading categories…</p>}
            {categoriesError && <p className="error-message" role="alert">Categories could not be loaded: {categoriesError}. Other product details can still be edited.</p>}
            {validationMessage && <p className="error-message" role="alert">{validationMessage}</p>}
            {saveError && <p className="error-message" role="alert">Unable to save product details: {saveError}</p>}
            {saveMessage && <p className="success-message" role="status">{saveMessage}</p>}
            <button className="button button-primary" type="submit" disabled={!canSave} aria-busy={isSaving}>{isSaving ? 'Saving changes…' : 'Save changes'}</button>
          </form>
        </section>

        <section className="product-editor-section" aria-labelledby="product-images-title">
          <div className="product-editor-section-heading"><div><h3 id="product-images-title">Product Images</h3><p>Shared images for this LEGO product, separate from Used Condition Photos and Catalogue Artwork.</p></div>
            <label className="button button-secondary product-editor-add-images">Add images<input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple onChange={event => void addImages(event)} disabled={imagesLoading || !!imagesError || !!imageAction || isSaving || images.length >= maximumImages} /></label>
          </div>
          <p className="product-editor-note">JPEG, PNG, or WebP · up to 8 MiB each · maximum 10 images.</p>
          {imagesLoading && <p role="status">Loading Product Images…</p>}
          {imageAction && <p role="status">{imageAction === 'adding' ? 'Adding Product Images…' : imageAction === 'replacing' ? 'Replacing Product Image…' : imageAction === 'removing' ? 'Removing Product Image…' : 'Saving Product Image order…'}</p>}
          {imagesError && <><p className="error-message" role="alert">Unable to load Product Images: {imagesError}</p><button className="button button-secondary" type="button" onClick={() => { setImages([]); setImagesError(''); setImagesLoading(true); setImagesLoadAttempt(attempt => attempt + 1) }} disabled={imagesLoading || !!imageAction || isSaving}>Retry loading images</button></>}
          {!imagesLoading && !imagesError && images.length === 0 && <p className="product-editor-empty">No Product Images have been added.</p>}
          {imageError && <p className="error-message" role="alert">{imageError}</p>}
          {imageMessage && <p className="success-message" role="status">{imageMessage}</p>}
          {images.length > 0 && <ol className="product-editor-images" aria-label="Product Images">
            {images.map((image, index) => <li className="product-editor-image" key={image.id}>
              <img src={image.url} alt={image.altText || `Product image ${index + 1}`} />
              <div className="product-editor-image-details"><strong>{index === 0 ? 'Cover image' : `Image ${index + 1}`}</strong><span>{image.altText || 'No alt text'}</span></div>
              <div className="product-editor-image-actions">
                <button className="button button-secondary" type="button" onClick={() => void moveImage(index, -1)} disabled={index === 0 || !!imagesError || !!imageAction || isSaving} aria-label={`Move image ${index + 1} up`}>Move up</button>
                <button className="button button-secondary" type="button" onClick={() => void moveImage(index, 1)} disabled={index === images.length - 1 || !!imagesError || !!imageAction || isSaving} aria-label={`Move image ${index + 1} down`}>Move down</button>
                <label className="button button-secondary product-editor-replace-image">Replace<input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-label={`Replace image ${index + 1}`} onChange={event => void replaceImage(image, event)} disabled={!!imagesError || !!imageAction || isSaving} /></label>
                <button className="button button-secondary" type="button" onClick={() => void removeImage(image)} disabled={!!imagesError || !!imageAction || isSaving} aria-label={`Remove image ${index + 1}`}>Remove</button>
              </div>
            </li>)}
          </ol>}
        </section>
      </>}
    </section>
  )
}

export default ProductEditor
