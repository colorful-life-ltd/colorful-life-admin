import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { AdminCategory } from '../electron/category-contract'
import type { AdminProductListing, ProductAvailabilitySummary } from '../electron/product-contract'
import { adminCategories, adminProducts } from './admin-api'
import { normalizeImageFile } from './image-normalization'

const maximumArtworkBytes = 8 * 1024 * 1024
const itemsPerPage = 3

const getErrorMessage = (error: unknown): string => error instanceof Error ? error.message : 'The catalogue presentation action failed.'

const sortByPresentationCompletion = (listings: AdminProductListing[]): AdminProductListing[] => [...listings].sort((first, second) => {
  const firstHasArtwork = Boolean(first.legoProduct.catalogueArtworkUrl)
  const secondHasArtwork = Boolean(second.legoProduct.catalogueArtworkUrl)
  if (firstHasArtwork !== secondHasArtwork) return firstHasArtwork ? 1 : -1
  // The Admin feed is ordered by ascending ProductListing ID, so a larger ID is the newest stable row identifier.
  return second.id - first.id || first.legoProduct.id - second.legoProduct.id
})

interface CataloguePresentationProps {
  refreshToken?: number
  refreshCategory?: number | null
}

type AvailabilityScope = number | 'all'
type LoadedAvailability = ProductAvailabilitySummary & { scope: AvailabilityScope }
type AvailabilityError = { scope: AvailabilityScope; message: string }

function CataloguePresentation({ refreshToken = 0, refreshCategory = null }: CataloguePresentationProps) {
  const [listings, setListings] = useState<AdminProductListing[]>([])
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [categoriesError, setCategoriesError] = useState('')
  const [availability, setAvailability] = useState<LoadedAvailability | null>(null)
  const [availabilityError, setAvailabilityError] = useState<AvailabilityError | null>(null)
  const [selectedCategory, setSelectedCategory] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [activeAction, setActiveAction] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  useEffect(() => {
    let cancelled = false
    void adminCategories.list().then(data => { if (!cancelled) setCategories(data) }, loadError => { if (!cancelled) { setCategories([]); setCategoriesError(getErrorMessage(loadError)) } }).finally(() => { if (!cancelled) setCategoriesLoading(false) })
    return () => { cancelled = true }
  }, [])

  const selectedCategoryNoLongerExists = !categoriesLoading && !categoriesError && !!selectedCategory && !categories.some(category => String(category.id) === selectedCategory)
  const activeCategory = selectedCategoryNoLongerExists ? '' : selectedCategory
  const selectedCategoryId = activeCategory ? Number(activeCategory) : null
  const selectedCategoryName = categories.find(category => category.id === selectedCategoryId)?.name
  const availabilityScope: AvailabilityScope = selectedCategoryId ?? 'all'
  const availabilityLabel = selectedCategoryId === null ? 'All categories' : selectedCategoryName ?? 'Selected category'

  useEffect(() => {
    let current = true
    const scope: AvailabilityScope = selectedCategoryId ?? 'all'
    void Promise.resolve().then(() => {
      if (!current) return
      setAvailability(null)
      setAvailabilityError(null)
    })
    const request = selectedCategoryId === null
      ? adminProducts.getProductAvailability()
      : adminCategories.getProductAvailability(selectedCategoryId)
    void request.then((summary) => {
      if (current) setAvailability({ ...summary, scope })
    }, (requestError) => {
      if (current) setAvailabilityError({ scope, message: getErrorMessage(requestError) })
    })

    return () => { current = false }
  }, [selectedCategoryId])

  const loadListings = async ({ category = activeCategory, resetPage = false }: { category?: string; resetPage?: boolean } = {}) => {
    setIsLoading(true)
    setHasLoaded(false)
    setError('')
    try {
      const nextListings = await adminProducts.listAdminProductListings()
      setListings(nextListings)
      setHasLoaded(true)
      if (resetPage) {
        setPage(1)
      } else {
        const categoryCount = nextListings.filter((listing) => !category || String(listing.legoProduct.category?.id) === category).length
        setPage((current) => Math.min(current, Math.max(1, Math.ceil(categoryCount / itemsPerPage))))
      }
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => {
      const hasCategoryContext = refreshToken > 0 && refreshCategory !== null
      const category = hasCategoryContext ? String(refreshCategory) : activeCategory
      if (hasCategoryContext) {
        setSelectedCategory(category)
        setPage(1)
      }
      return loadListings({ category, resetPage: hasCategoryContext })
    })
    // The refresh token intentionally controls this effect; category changes are local and do not reload data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken])

  const orderedListings = sortByPresentationCompletion(listings)
  const visibleListings = activeCategory ? orderedListings.filter((listing) => String(listing.legoProduct.category?.id) === activeCategory) : orderedListings
  const pageCount = Math.max(1, Math.ceil(visibleListings.length / itemsPerPage))
  const currentPage = selectedCategoryNoLongerExists ? 1 : Math.min(page, pageCount)
  const paginatedListings = visibleListings.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  const setFeature = async (productId: number) => {
    if (activeAction !== null) return
    setActiveAction(`feature-${productId}`)
    setError('')
    setFeedback('')
    try {
      await adminProducts.setFeatureProduct(productId)
      setListings(await adminProducts.listAdminProductListings())
      setFeedback('Feature product updated.')
    } catch (actionError) {
      setError(getErrorMessage(actionError))
    } finally {
      setActiveAction(null)
    }
  }

  const uploadArtwork = async (productId: number, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size === 0) { setError(`${file.name} is empty and cannot be uploaded.`); return }
    if (file.size > maximumArtworkBytes) {
      setError(`${file.name} exceeds the 8 MiB image limit.`)
      return
    }
    if (activeAction !== null) return
    setActiveAction(`artwork-${productId}`)
    setError('')
    setFeedback('')
    try {
      const artwork = await adminProducts.uploadCatalogueArtwork(productId, await normalizeImageFile(file))
      setListings((current) => current.map((listing) => listing.legoProduct.id === productId ? {
        ...listing,
        legoProduct: { ...listing.legoProduct, catalogueArtworkUrl: artwork.url, catalogueArtworkPublicId: artwork.publicId },
      } : listing))
      setFeedback('Catalogue artwork saved.')
    } catch (actionError) {
      setError(getErrorMessage(actionError))
    } finally {
      setActiveAction(null)
    }
  }

  const removeArtwork = async (productId: number) => {
    if (activeAction !== null || !window.confirm('Remove this catalogue artwork?')) return
    setActiveAction(`remove-artwork-${productId}`)
    setError('')
    setFeedback('')
    try {
      await adminProducts.removeCatalogueArtwork(productId)
      setListings((current) => current.map((listing) => listing.legoProduct.id === productId ? {
        ...listing,
        legoProduct: { ...listing.legoProduct, catalogueArtworkUrl: null, catalogueArtworkPublicId: null },
      } : listing))
      setFeedback('Catalogue artwork removed.')
    } catch (actionError) {
      setError(getErrorMessage(actionError))
    } finally {
      setActiveAction(null)
    }
  }

  return (
    <section className="product-panel catalogue-presentation" aria-labelledby="catalogue-presentation-title">
      <div className="product-panel-heading"><div><p className="eyebrow">CATALOGUE</p><h2 id="catalogue-presentation-title">Presentation management</h2></div><button className="button button-secondary" type="button" onClick={() => void loadListings()} disabled={isLoading || activeAction !== null} aria-busy={isLoading}>{isLoading ? 'Loading…' : 'Refresh listings'}</button></div>
      <p className="panel-intro">Manage shared product Feature state and catalogue artwork.</p>
      <div className="presentation-category-controls">
        <label className="category-filter">Filter category<select aria-label="Presentation category" value={activeCategory} onChange={(event) => { setSelectedCategory(event.target.value); setPage(1) }} disabled={categoriesLoading || !!categoriesError}><option value="">All categories</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <div className="category-availability" aria-live="polite" aria-busy={availability?.scope !== availabilityScope && availabilityError?.scope !== availabilityScope}>
          {availability?.scope === availabilityScope
            ? <p className="category-availability-summary"><strong>{availabilityLabel}</strong> · {availability.totalProducts} Products · {availability.totalInventory} Inventory · {availability.activeProducts} Active · {availability.inactiveProducts} Inactive</p>
            : availabilityError?.scope === availabilityScope
              ? <p className="error-message" role="alert">Unable to load {selectedCategoryId === null ? 'catalogue' : 'category'} availability: {availabilityError.message}</p>
              : <p className="status-message" role="status">Loading {selectedCategoryId === null ? 'catalogue' : 'category'} availability…</p>}
        </div>
      </div>
      {categoriesLoading && <p className="status-message">Loading categories…</p>}
      {categoriesError && <p className="error-message" role="alert">Unable to load categories: {categoriesError}</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
      {feedback && <p className="success-message" role="status">{feedback}</p>}
      {isLoading && <p className="status-message">Loading catalogue listings…</p>}
      {!isLoading && hasLoaded && visibleListings.length === 0 && <p className="status-message">No listings found for this category.</p>}
      {!isLoading && visibleListings.length > 0 && <>
        <div className="presentation-list" aria-label="Catalogue presentation listings">{paginatedListings.map((listing) => {
        const productId = listing.legoProduct.id
        const featureAction = activeAction === `feature-${productId}`
        const artworkAction = activeAction === `artwork-${productId}`
        const removeAction = activeAction === `remove-artwork-${productId}`
        const artworkUrl = listing.legoProduct.catalogueArtworkUrl
        const isFeatureProduct = listing.legoProduct.isFeatureProduct
        return <article className={`presentation-card${isFeatureProduct ? ' presentation-card-feature' : ''}`} key={listing.id}>
          <div className="presentation-preview">{artworkUrl ? <img src={artworkUrl} alt={`Catalogue artwork for ${listing.legoProduct.title}`} /> : <span>No catalogue artwork</span>}</div>
          <div className="presentation-details"><div className="presentation-heading"><div><h3>{listing.legoProduct.title}</h3><p>Listing #{listing.id} · Set {listing.legoProduct.setNumber}</p></div><span className={`presentation-badge${isFeatureProduct ? ' feature-badge' : ''}`}>{isFeatureProduct ? 'Feature' : 'Standard'}</span></div>
            <p className="presentation-category">{listing.legoProduct.category?.name ?? 'Uncategorized'}</p>
            <p className="artwork-state">{artworkUrl ? 'Catalogue artwork available' : 'No catalogue artwork'}</p>
            <div className="presentation-actions"><button className="button button-primary" type="button" onClick={() => void setFeature(productId)} disabled={activeAction !== null || isFeatureProduct} aria-busy={featureAction}>{featureAction ? 'Saving…' : isFeatureProduct ? 'Current Feature' : 'Make Feature'}</button><label className="button button-secondary upload-artwork-button" aria-busy={artworkAction}>{artworkAction ? 'Uploading…' : artworkUrl ? 'Replace artwork' : 'Upload artwork'}<input type="file" accept="image/*,.jpg,.jpeg,.png,.webp" onChange={(event) => void uploadArtwork(productId, event)} disabled={activeAction !== null} /></label>{artworkUrl && <button className="button button-secondary" type="button" onClick={() => void removeArtwork(productId)} disabled={activeAction !== null} aria-busy={removeAction}>{removeAction ? 'Removing…' : 'Remove artwork'}</button>}</div>
          </div>
        </article>
        })}</div>
        {pageCount > 1 && <nav className="presentation-pagination" aria-label="Presentation listing pages"><button className="button button-secondary" type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage === 1}>Previous</button><span>Page {currentPage} of {pageCount}</span><button className="button button-secondary" type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={currentPage === pageCount}>Next</button></nav>}
      </>}
    </section>
  )
}

export default CataloguePresentation
