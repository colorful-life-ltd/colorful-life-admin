import { hasValidListingPrices, isPositivePrice, priceValidationMessage } from '../electron/listing-price'
import { useEffect, useRef, useState } from 'react'
import type { AdminCategory } from '../electron/category-contract'
import type { ReviewProduct } from '../electron/purchase-contract'
import type { FormEvent, ChangeEvent } from 'react'
import type { AdminLegoProduct, CreateProductRequest, ProductImage, ProductListing, UsedOfferCreated } from '../electron/product-contract'
import { adminCategories, adminProducts, adminPurchases } from './admin-api'
import { normalizeImageFile } from './image-normalization'

type ImageStatus = 'pending' | 'uploading' | 'uploaded' | 'failed'

interface SelectedImage {
  id: string
  file: File
  previewUrl: string
  altText: string
  status: ImageStatus
  result?: ProductImage
  error?: string
}

const maximumImageBytes = 8 * 1024 * 1024
const maximumImages = 10

const getErrorMessage = (error: unknown): string => error instanceof Error ? error.message : 'The product could not be created.'
const getUsedOfferErrorMessage = (error: unknown): string => {
  const message = getErrorMessage(error)
  return /available used offer already exists/i.test(message)
    ? 'An available New – Outer Box Damage item already exists for this product. It cannot be reused or changed here.'
    : message
}

interface AddProductProps {
  purchaseContext?: {
    purchaseId: number
    groupId: number
    revision: string
    sourceSetNumber: string | null
    sourceDescription: string
    existingProduct?: ReviewProduct
  }
  onProductCreated?: (product: ProductListing) => void
  onUsedOfferCreated?: (offer: UsedOfferCreated, categoryId: number | null) => void
}

interface SelectedConditionPhoto { file: File; previewUrl: string }

function AddProduct({ onProductCreated, onUsedOfferCreated, purchaseContext }: AddProductProps) {
  const [setNumber, setSetNumber] = useState(purchaseContext?.sourceSetNumber ?? '')
  const [title, setTitle] = useState(purchaseContext?.sourceDescription ?? '')
  const [description, setDescription] = useState('')
  const [theme, setTheme] = useState('')
  const [ageRecommendation, setAgeRecommendation] = useState('')
  const [pieceCount, setPieceCount] = useState('')
  const [condition, setCondition] = useState<CreateProductRequest['condition']>('NEW')
  const [isRetired, setIsRetired] = useState(false)
  const [originalPrice, setOriginalPrice] = useState('')
  const [salePrice, setSalePrice] = useState('')
  const [currentStock, setCurrentStock] = useState('')
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [categoriesError, setCategoriesError] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [images, setImages] = useState<SelectedImage[]>([])
  const [formError, setFormError] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [isInitialUploadActive, setIsInitialUploadActive] = useState(false)
  const [isRetryingImages, setIsRetryingImages] = useState(false)
  const [createdProduct, setCreatedProduct] = useState<ProductListing | null>(null)
  const [lookupQuery, setLookupQuery] = useState('')
  const [lookupResults, setLookupResults] = useState<AdminLegoProduct[]>([])
  const [selectedLegoProduct, setSelectedLegoProduct] = useState<AdminLegoProduct | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [usedSalePrice, setUsedSalePrice] = useState('')
  const [damageDescription, setDamageDescription] = useState('')
  const [conditionPhotos, setConditionPhotos] = useState<SelectedConditionPhoto[]>([])
  const conditionPhotosRef = useRef(conditionPhotos)
  conditionPhotosRef.current = conditionPhotos
  const [createdUsedOffer, setCreatedUsedOffer] = useState<UsedOfferCreated | null>(null)
  const creationNotifiedRef = useRef(false)
  const imagesRef = useRef(images)
  imagesRef.current = images

  useEffect(() => {
    let cancelled = false
    setCategoriesLoading(true)
    setCategoriesError('')
    void adminCategories.list().then(data => { if (!cancelled) setCategories(data) }, error => { if (!cancelled) { setCategories([]); setCategoriesError(getErrorMessage(error)) } }).finally(() => { if (!cancelled) setCategoriesLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => () => imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl)), [])
  useEffect(() => () => conditionPhotosRef.current.forEach(photo => URL.revokeObjectURL(photo.previewUrl)), [])

  const uploadedCount = images.filter((image) => image.status === 'uploaded').length
  const isWorkflowActive = isCreating || isInitialUploadActive || isRetryingImages
  const isWorkflowComplete = createdProduct !== null && !isWorkflowActive && images.every((image) => image.status === 'uploaded')

  useEffect(() => {
    if (!isWorkflowComplete || !createdProduct || creationNotifiedRef.current) return
    creationNotifiedRef.current = true
    onProductCreated?.(createdProduct)
  }, [createdProduct, isWorkflowComplete, onProductCreated])

  const handleImageSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    setFormError('')
    const nextImages = [...images]
    for (const file of files) {
      if (nextImages.length >= maximumImages) {
        setFormError('A product can have at most 10 images.')
        break
      }
      if (file.size === 0) { setFormError(`${file.name} is empty and cannot be uploaded.`); continue }
      if (file.size > maximumImageBytes) {
        setFormError(`${file.name} exceeds the 8 MiB image limit.`)
        continue
      }
      nextImages.push({ id: `${file.name}-${file.lastModified}-${nextImages.length}`, file, previewUrl: URL.createObjectURL(file), altText: '', status: 'pending' })
    }
    setImages(nextImages)
  }

  const removeImage = (imageId: string) => {
    setImages((current) => current.filter((image) => {
      if (image.id !== imageId) return true
      URL.revokeObjectURL(image.previewUrl)
      return false
    }))
  }

  const updateAltText = (imageId: string, altText: string) => {
    setImages((current) => current.map((image) => image.id === imageId ? { ...image, altText } : image))
  }

  const uploadImage = async (productId: number, imageIndex: number) => {
    const image = imagesRef.current[imageIndex]
    if (!image) return
    setImages((current) => current.map((entry, index) => index === imageIndex ? { ...entry, status: 'uploading', error: undefined } : entry))
    try {
      const result = await adminProducts.uploadProductImage(productId, {
        ...await normalizeImageFile(image.file),
        ...(image.altText ? { altText: image.altText } : {}),
      })
      setImages((current) => current.map((entry, index) => index === imageIndex ? { ...entry, status: 'uploaded', result } : entry))
    } catch (error) {
      setImages((current) => current.map((entry, index) => index === imageIndex ? { ...entry, status: 'failed', error: getErrorMessage(error) } : entry))
    }
  }

  const createProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isCreating || !condition) return
    setFormError('')
    if (condition === 'USED_LIKE_NEW') {
      const price = Number(usedSalePrice)
      if (!selectedLegoProduct) { setFormError('Select an existing LEGO product.'); return }
      if (!isPositivePrice(price)) { setFormError(priceValidationMessage); return }
      if (!damageDescription.trim()) { setFormError('Enter a damage description.'); return }
      if (conditionPhotos.length < 1 || conditionPhotos.length > 3) { setFormError('Add 1 to 3 Condition Photos.'); return }
      setIsCreating(true)
      try {
        const photoPayloads = await Promise.all(conditionPhotos.map(({ file }) => normalizeImageFile(file)))
        const offer = await adminProducts.createUsedOffer(selectedLegoProduct.id, {
          salePrice: price,
          damageDescription: damageDescription.trim(),
          conditionPhotos: photoPayloads,
        })
        setCreatedUsedOffer(offer)
        onUsedOfferCreated?.(offer, selectedLegoProduct.category?.id ?? null)
      } catch (error) { setFormError(getUsedOfferErrorMessage(error)) }
      finally { setIsCreating(false) }
      return
    }
    if (!hasValidListingPrices({ originalPrice: Number(originalPrice), salePrice: salePrice.trim() === '' ? undefined : Number(salePrice) })) {
      setFormError(priceValidationMessage)
      return
    }
    setIsCreating(true)
    try {
      const request: CreateProductRequest = {
        setNumber, title, theme, categoryId: Number(categoryId), ageRecommendation, pieceCount: Number(pieceCount), condition, originalPrice: Number(originalPrice),
        isRetired,
        ...(description ? { description } : {}), ...(salePrice ? { salePrice: Number(salePrice) } : {}), ...(currentStock ? { currentStock: Number(currentStock) } : {}),
      }
      const product = purchaseContext
        ? await adminPurchases.createListing(purchaseContext.purchaseId, {
          ...(purchaseContext.existingProduct ? { existingProductId: purchaseContext.existingProduct.id } : {
            setNumber, title, description, theme, categoryId: Number(categoryId), ageRecommendation, pieceCount: Number(pieceCount),
          }),
          condition, originalPrice: Number(originalPrice), ...(salePrice ? { salePrice: Number(salePrice) } : {}), currentStock: 0,
        })
        : await adminProducts.createProduct(request)
      setCreatedProduct(product)
      setIsInitialUploadActive(true)
      for (let index = 0; index < imagesRef.current.length; index += 1) await uploadImage(product.legoProduct.id, index)
    } catch (error) {
      setFormError(getErrorMessage(error))
    } finally {
      setIsCreating(false)
      setIsInitialUploadActive(false)
    }
  }

  const searchExistingProducts = async () => {
    if (isSearching || lookupQuery.trim().length === 0) return
    setIsSearching(true)
    setFormError('')
    try {
      const result = await adminProducts.searchLegoProducts(lookupQuery.trim())
      setLookupResults(result.items)
    } catch (error) { setFormError(getErrorMessage(error)) }
    finally { setIsSearching(false) }
  }

  const selectCondition = (next: CreateProductRequest['condition']) => {
    setCondition(next)
    setFormError('')
    if (next === 'USED_LIKE_NEW') {
      imagesRef.current.forEach(image => URL.revokeObjectURL(image.previewUrl))
      setImages([])
      setCreatedProduct(null)
      creationNotifiedRef.current = false
    } else {
      conditionPhotosRef.current.forEach(photo => URL.revokeObjectURL(photo.previewUrl))
      setSelectedLegoProduct(null)
      setLookupResults([])
      setConditionPhotos([])
      setCreatedUsedOffer(null)
    }
  }

  const handleConditionPhotoSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    setFormError('')
    const next = [...conditionPhotos]
    for (const file of files) {
      if (file.size === 0) { setFormError(`${file.name} is empty and cannot be uploaded.`); continue }
      if (file.size > maximumImageBytes) { setFormError(`${file.name} exceeds the 8 MiB image limit.`); continue }
      if (next.length >= 3) { setFormError('A New – Outer Box Damage offer can have at most 3 Condition Photos.'); break }
      next.push({ file, previewUrl: URL.createObjectURL(file) })
    }
    setConditionPhotos(next)
  }

  const retryFailedImages = async () => {
    if (!createdProduct || isCreating || isInitialUploadActive || isRetryingImages) return
    setIsRetryingImages(true)
    try {
      await Promise.all(imagesRef.current.map((image, index) => image.status === 'failed' || image.status === 'pending' ? uploadImage(createdProduct.legoProduct.id, index) : Promise.resolve()))
    } finally {
      setIsRetryingImages(false)
    }
  }

  const resetWorkflow = () => {
    imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl))
    setSetNumber('')
    setTitle('')
    setDescription('')
    setTheme('')
    setCategoryId('')
    setAgeRecommendation('')
    setPieceCount('')
    setCondition('NEW')
    setIsRetired(false)
    setOriginalPrice('')
    setSalePrice('')
    setCurrentStock('')
    setImages([])
    setFormError('')
    setIsCreating(false)
    setIsInitialUploadActive(false)
    setCreatedProduct(null)
    creationNotifiedRef.current = false
  }

  const hasFailedImages = images.some((image) => image.status === 'failed' || image.status === 'pending')
  const canRetryImages = createdProduct !== null && !isWorkflowActive && hasFailedImages

  return (
    <section className="product-panel" aria-labelledby="add-product-title">
      <div className="product-panel-heading"><div><p className="eyebrow">CATALOGUE</p><h2 id="add-product-title">Add product listing</h2></div>{createdProduct && <p role="status">Listing created: {createdProduct.id}</p>}</div>
      <form className="product-form" onSubmit={(event) => void createProduct(event)}>
        {!purchaseContext?.existingProduct && condition === 'NEW' && <>
        <label>Set number<input value={setNumber} onChange={(event) => setSetNumber(event.target.value)} required disabled={!!createdProduct} /></label>
        <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} required disabled={!!createdProduct} /></label>
        <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} disabled={!!createdProduct} /></label>
        <label>Theme<input value={theme} onChange={(event) => setTheme(event.target.value)} required disabled={!!createdProduct} /></label>
        <label>{purchaseContext ? 'Category' : 'Colorful Life Category'}<select aria-label="Colorful Life Category" value={categoryId} onChange={event => setCategoryId(event.target.value)} required disabled={!!createdProduct || categoriesLoading || !!categoriesError}><option value="">{categoriesLoading ? 'Loading categories…' : 'Select a category'}</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        {categoriesError && <p className="error-message" role="alert">Unable to load categories: {categoriesError}</p>}
        <label>Age recommendation<input value={ageRecommendation} onChange={(event) => setAgeRecommendation(event.target.value)} required disabled={!!createdProduct} /></label>
        <label>Piece count<input type="number" min="1" step="1" value={pieceCount} onChange={(event) => setPieceCount(event.target.value)} required disabled={!!createdProduct} /></label>
        {!purchaseContext && <div className="product-retired-field"><label className="product-retired-control"><span>Retired Set</span><input type="checkbox" checked={isRetired} onChange={(event) => setIsRetired(event.target.checked)} disabled={!!createdProduct} aria-describedby="retired-set-help" /></label><p id="retired-set-help">Mark this set as retired/discontinued by LEGO.</p></div>}
        </>}
        {purchaseContext?.existingProduct && <p>New listing for {purchaseContext.existingProduct.setNumber} · {purchaseContext.existingProduct.title}</p>}
        <label>Condition<select aria-label="Condition" value={condition} onChange={(event) => selectCondition(event.target.value as CreateProductRequest['condition'])} required disabled={!!createdProduct || !!createdUsedOffer || !!purchaseContext}><option value="NEW">New</option><option value="USED_LIKE_NEW" disabled={!!purchaseContext}>New – Outer Box Damage</option></select></label>
        {condition === 'USED_LIKE_NEW' && !purchaseContext ? <>
          <p>New – Outer Box Damage: LEGO has never been built or played with. Contents and internal packaging are complete; only the outer retail box has cosmetic damage.</p>
          <label>Search existing LEGO products<input value={lookupQuery} onChange={event => setLookupQuery(event.target.value)} disabled={isSearching || !!createdUsedOffer} /></label>
          <button type="button" className="button button-secondary" onClick={() => void searchExistingProducts()} disabled={isSearching || !lookupQuery.trim() || !!createdUsedOffer} aria-busy={isSearching}>{isSearching ? 'Searching…' : 'Search products'}</button>
          {lookupResults.length > 0 && <ul aria-label="Product search results">{lookupResults.map(product => <li key={product.id}><button type="button" onClick={() => setSelectedLegoProduct(product)} disabled={!!createdUsedOffer}>{product.setNumber} · {product.title} — {product.usedOfferStatus === 'AVAILABLE' ? 'Available New – Outer Box Damage offer exists' : product.usedOfferStatus === 'HISTORICAL_ONLY' ? 'Historical New – Outer Box Damage offers only' : 'No New – Outer Box Damage offer'}</button></li>)}</ul>}
          {selectedLegoProduct && <section aria-label="Selected LEGO product"><h3>Selected existing product</h3><p>{selectedLegoProduct.setNumber} · {selectedLegoProduct.title}</p><dl><dt>Description</dt><dd>{selectedLegoProduct.description || '—'}</dd><dt>Theme</dt><dd>{selectedLegoProduct.theme}</dd><dt>Category</dt><dd>{selectedLegoProduct.category?.name || '—'}</dd><dt>Age recommendation</dt><dd>{selectedLegoProduct.ageRecommendation}</dd><dt>Piece count</dt><dd>{selectedLegoProduct.pieceCount}</dd><dt>Retired Set</dt><dd>{selectedLegoProduct.isRetired ? 'Yes' : 'No'}</dd></dl>
            {selectedLegoProduct.usedOfferStatus === 'AVAILABLE' && <p role="alert">An available New – Outer Box Damage item already exists for this product. It cannot be reused or changed here.</p>}
          </section>}
          <label>Quantity<input value="1" readOnly aria-readonly="true" /></label>
          <label>Sale price (£)<input type="number" min="0.01" step="0.01" value={usedSalePrice} onChange={event => setUsedSalePrice(event.target.value)} required disabled={!!createdUsedOffer} /></label>
          <label>Damage description<textarea value={damageDescription} onChange={event => setDamageDescription(event.target.value)} maxLength={2000} required disabled={!!createdUsedOffer} /></label>
          {!createdUsedOffer && <label>Condition Photos (1–3 actual photos of this item)<input type="file" accept="image/*,.jpg,.jpeg,.png,.webp" multiple onChange={handleConditionPhotoSelection} /></label>}
          {conditionPhotos.length > 0 && <div className="image-list" aria-label="Condition Photos">{conditionPhotos.map(({ file, previewUrl }, index) => <div className="selected-image" key={`${file.name}-${file.lastModified}-${index}`}><img src={previewUrl} alt={`Condition photo ${index + 1}: ${file.name}`} /><strong>{file.name}</strong>{!createdUsedOffer && <button type="button" onClick={() => setConditionPhotos(current => { const removed = current[index]; if (removed) URL.revokeObjectURL(removed.previewUrl); return current.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>}</div>)}</div>}
          {formError && <p className="error-message" role="alert">{formError}</p>}
          {!createdUsedOffer && <button className="button button-primary" type="submit" disabled={isCreating || selectedLegoProduct?.usedOfferStatus === 'AVAILABLE'} aria-busy={isCreating}>{isCreating ? 'Creating New – Outer Box Damage offer…' : 'Create New – Outer Box Damage offer'}</button>}
          {createdUsedOffer && <><p role="status">New – Outer Box Damage offer created: {createdUsedOffer.id}</p><button className="button button-secondary" type="button" onClick={() => { conditionPhotosRef.current.forEach(photo => URL.revokeObjectURL(photo.previewUrl)); setCreatedUsedOffer(null); setSelectedLegoProduct(null); setLookupResults([]); setLookupQuery(''); setUsedSalePrice(''); setDamageDescription(''); setConditionPhotos([]); setFormError('') }}>Add another New – Outer Box Damage item</button></>}
        </> : condition === 'NEW' && <>
        <label>Original price<input type="number" min="0.01" step="0.01" value={originalPrice} onChange={(event) => setOriginalPrice(event.target.value)} required disabled={!!createdProduct} /></label>
        <label>Sale price<input type="number" min="0.01" step="0.01" value={salePrice} onChange={(event) => setSalePrice(event.target.value)} disabled={!!createdProduct} /></label>
        {purchaseContext ? <p>Initial stock: 0. Stock is added only after approval in Purchase Review.</p> : <label>Current stock<input type="number" min="0" step="1" value={currentStock} onChange={(event) => setCurrentStock(event.target.value)} disabled={!!createdProduct} /></label>}
        {!createdProduct && <label>Product images<input type="file" accept="image/*,.jpg,.jpeg,.png,.webp" multiple onChange={handleImageSelection} /></label>}
        {images.length > 0 && <div className="image-list" aria-label="Selected product images">{images.map((image, index) => <div className="selected-image" key={image.id}>
          <img src={image.previewUrl} alt={image.altText || `Selected product image ${index + 1}`} />
          <div><strong>{index === 0 ? 'Cover image' : `Image ${index + 1}`}</strong><span>{image.status === 'uploading' ? 'Uploading…' : image.status === 'uploaded' ? 'Uploaded' : image.status === 'failed' ? `Failed: ${image.error}` : 'Pending'}</span><label>Alt text<input value={image.altText} onChange={(event) => updateAltText(image.id, event.target.value)} disabled={image.status === 'uploaded'} /></label></div>
          {!createdProduct && <button type="button" onClick={() => removeImage(image.id)}>Remove</button>}
        </div>)}</div>}
        </>}
        {condition === 'NEW' && formError && <p className="error-message" role="alert">{formError}</p>}
        {condition === 'NEW' && !createdProduct && <button className="button button-primary" type="submit" disabled={isCreating} aria-busy={isCreating}>{isCreating ? 'Creating product…' : 'Create product listing'}</button>}
      </form>
      {createdProduct && <div className="upload-summary"><p role="status">Product created. {uploadedCount} of {images.length} images uploaded.</p>{canRetryImages && <button className="button button-primary" type="button" onClick={() => void retryFailedImages()} disabled={isRetryingImages} aria-busy={isRetryingImages}>{isRetryingImages ? 'Retrying images…' : 'Retry failed images'}</button>}{isWorkflowComplete && <><p role="status">Product listing and images are ready.</p><button className="button button-secondary" type="button" onClick={resetWorkflow}>Add another product</button></>}</div>}
    </section>
  )
}

export default AddProduct
