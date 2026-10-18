import { hasValidListingPrices, isPositivePrice, priceValidationMessage } from './listing-price.js'
import type { AuthService } from './auth-service.js'
import { readBackendError } from './backend-error.js'
import { colorfulLifeCategoryOptions } from './product-contract.js'
import type { AdminLegoProduct, AdminLegoProductDetails, AdminLegoProductPage, AdminProductListing, BackendCategory, CatalogueArtwork, ColorfulLifeCategory, CreateProductRequest, ImageUploadPayload, ProductAvailabilitySummary, ProductCataloguePage, ProductImage, ProductListing, ProductMetadataUpdate, UsedOfferCreateInput, UsedOfferCreated, UsedOfferStatus } from './product-contract.js'

export type ProductErrorCode = 'validation' | 'conflict' | 'not-found' | 'limit' | 'forbidden' | 'server' | 'malformed-response'

export class ProductError extends Error {
  readonly code: ProductErrorCode
  readonly status: number | null
  readonly backendCode: string | null

  constructor(code: ProductErrorCode, message: string, status: number | null = null, backendCode: string | null = null) {
    super(message)
    this.name = 'ProductError'
    this.code = code
    this.status = status
    this.backendCode = backendCode
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isString = (value: unknown): value is string => typeof value === 'string'
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isNonNegativeInteger = (value: unknown): value is number => isNumber(value) && Number.isInteger(value) && value >= 0
const isNullableString = (value: unknown): value is string | null => isString(value) || value === null

const parseProductAvailabilitySummary = (value: unknown): ProductAvailabilitySummary => {
  if (!isRecord(value) || !isNonNegativeInteger(value.totalProducts) || !isNonNegativeInteger(value.totalInventory) || !isNonNegativeInteger(value.activeProducts) || !isNonNegativeInteger(value.inactiveProducts)) {
    throw new ProductError('malformed-response', 'The server returned invalid product availability counts.')
  }
  return { totalProducts: value.totalProducts, totalInventory: value.totalInventory, activeProducts: value.activeProducts, inactiveProducts: value.inactiveProducts }
}

const parseCategory = (value: unknown): BackendCategory | null => {
  if (value === null) return null
  if (!isRecord(value) || !isNumber(value.id) || !isString(value.name) || !isNullableString(value.subtitle) || !isNullableString(value.description) || !isNullableString(value.imageUrl)) {
    throw new ProductError('malformed-response', 'The server returned an invalid product category response.')
  }
  return { id: value.id, name: value.name, subtitle: value.subtitle, description: value.description, imageUrl: value.imageUrl }
}

const categoryEnum = (category: BackendCategory | null): ColorfulLifeCategory | null => {
  if (!category) return null
  const normalizedName = category.name.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return colorfulLifeCategoryOptions.find(([, label]) => label.replace(/[^a-z0-9]/gi, '').toLowerCase() === normalizedName)?.[0] ?? null
}

const errorForResponse = async (response: Response, operation: 'create' | 'update' | 'upload' | 'catalogue' | 'feature' | 'list' | 'lookup' | 'used'): Promise<ProductError> => {
  const details = await readBackendError(response, 'The Colorful Life service could not complete this request.')
  const { message, code } = details
  if (response.status === 403 || code === 'FORBIDDEN') return new ProductError('forbidden', 'This account cannot manage products.', response.status, code)
  if (response.status === 404) return new ProductError('not-found', operation === 'upload' || operation === 'catalogue' || operation === 'feature' ? 'The LEGO product could not be found.' : message, response.status, code)
  if (response.status === 409) return new ProductError(operation === 'upload' ? 'limit' : 'conflict', message, response.status, code)
  if (response.status === 400) return new ProductError('validation', message, response.status, code)
  if (response.status >= 500 || code === 'INTERNAL_SERVER_ERROR') return new ProductError('server', 'The Colorful Life service is unavailable right now.', response.status, code)
  return new ProductError('server', message, response.status, code)
}

const parseProductImage = (value: unknown, productId?: number): ProductImage => {
  if (!isRecord(value) || !isNumber(value.id) || (!isNumber(value.legoProductId) && productId === undefined) || !isString(value.url) || !isString(value.publicId) || (!isString(value.altText) && value.altText !== null) || !isNumber(value.sortOrder) || (value.createdAt !== undefined && !isString(value.createdAt))) {
    throw new ProductError('malformed-response', 'The server returned an invalid product image response.')
  }
  return {
    id: value.id, legoProductId: isNumber(value.legoProductId) ? value.legoProductId : productId!,
    url: value.url, publicId: value.publicId, altText: value.altText, sortOrder: value.sortOrder,
    ...(isString(value.createdAt) ? { createdAt: value.createdAt } : {}),
  }
}

const parseProductImagesResponse = (value: unknown, productId: number): ProductImage[] => {
  if (!isRecord(value) || !Array.isArray(value.productImages)) throw new ProductError('malformed-response', 'The server returned an invalid product images response.')
  return value.productImages.map(image => parseProductImage(image, productId))
}

const imageBlob = (bytes: Uint8Array, mimeType: string): Blob => {
  // Electron IPC may preserve a Uint8Array view's non-zero byteOffset and larger backing buffer.
  // Copying the view prevents unrelated bytes outside the image from entering the multipart file.
  return new Blob([Uint8Array.from(bytes).buffer as ArrayBuffer], { type: mimeType })
}

interface AdminProductListingsPage {
  items: AdminProductListing[]
  pagination: ProductCataloguePage['pagination']
}

const parseAdminProductListingsPage = (value: unknown): AdminProductListingsPage => {
  if (!isRecord(value) || !Array.isArray(value.items) || !isRecord(value.pagination) || !isNumber(value.pagination.page) || !Number.isInteger(value.pagination.page) || value.pagination.page < 1 || !isNumber(value.pagination.pageSize) || !Number.isInteger(value.pagination.pageSize) || value.pagination.pageSize < 1 || value.pagination.pageSize > 50 || !isNumber(value.pagination.totalItems) || !Number.isInteger(value.pagination.totalItems) || value.pagination.totalItems < 0 || !isNumber(value.pagination.totalPages) || !Number.isInteger(value.pagination.totalPages) || value.pagination.totalPages < 0 || value.pagination.totalPages !== Math.ceil(value.pagination.totalItems / value.pagination.pageSize) || value.pagination.page > Math.max(1, value.pagination.totalPages) || value.items.length > value.pagination.pageSize) {
    throw new ProductError('malformed-response', 'The server returned an invalid Admin product listings response.')
  }
  const items = value.items.map((entry): AdminProductListing => {
    if (!isRecord(entry) || !isNumber(entry.id) || !Number.isInteger(entry.id) || entry.id <= 0 || (entry.condition !== 'NEW' && entry.condition !== 'USED_LIKE_NEW') || typeof entry.active !== 'boolean' || (entry.usedLifecycle !== null && entry.usedLifecycle !== 'AVAILABLE' && entry.usedLifecycle !== 'SOLD' && entry.usedLifecycle !== 'RETIRED') || !isNumber(entry.currentStock) || !Number.isInteger(entry.currentStock) || entry.currentStock < 0 || !isNumber(entry.availableStock) || !Number.isInteger(entry.availableStock) || entry.availableStock < 0 || !isRecord(entry.legoProduct) || !isNumber(entry.legoProduct.id) || !Number.isInteger(entry.legoProduct.id) || entry.legoProduct.id <= 0 || !isString(entry.legoProduct.setNumber) || !isString(entry.legoProduct.title) || typeof entry.legoProduct.isFeatureProduct !== 'boolean' || (!isString(entry.legoProduct.catalogueArtworkUrl) && entry.legoProduct.catalogueArtworkUrl !== null) || (!isString(entry.legoProduct.catalogueArtworkPublicId) && entry.legoProduct.catalogueArtworkPublicId !== null) || !Array.isArray(entry.legoProduct.productImages)) {
      throw new ProductError('malformed-response', 'The server returned an invalid Admin product listing.')
    }
    let category: AdminProductListing['legoProduct']['category'] = null
    if (entry.legoProduct.category !== null) {
      if (!isRecord(entry.legoProduct.category) || !isNumber(entry.legoProduct.category.id) || !Number.isInteger(entry.legoProduct.category.id) || entry.legoProduct.category.id <= 0 || !isString(entry.legoProduct.category.name)) {
        throw new ProductError('malformed-response', 'The server returned an invalid Admin listing category.')
      }
      category = { id: entry.legoProduct.category.id, name: entry.legoProduct.category.name }
    }
    const legoProductId = entry.legoProduct.id as number
    return {
      id: entry.id, condition: entry.condition, active: entry.active, usedLifecycle: entry.usedLifecycle,
      currentStock: entry.currentStock, availableStock: entry.availableStock,
      legoProduct: {
        id: legoProductId, setNumber: entry.legoProduct.setNumber, title: entry.legoProduct.title, category,
        isFeatureProduct: entry.legoProduct.isFeatureProduct,
        catalogueArtworkUrl: entry.legoProduct.catalogueArtworkUrl,
        catalogueArtworkPublicId: entry.legoProduct.catalogueArtworkPublicId,
        productImages: entry.legoProduct.productImages.map(image => parseProductImage(image, legoProductId)),
      },
    }
  })
  return { items, pagination: { page: value.pagination.page, pageSize: value.pagination.pageSize, totalItems: value.pagination.totalItems, totalPages: value.pagination.totalPages } }
}

export const parseProduct = (value: unknown): ProductListing => {
  if (!isRecord(value) || !isNumber(value.id) || !isNumber(value.legoProductId) || !isString(value.condition) || !isString(value.originalPrice) || (!isString(value.salePrice) && value.salePrice !== null) || !isNumber(value.currentStock) || (!isNumber(value.availableStock) && value.availableStock !== undefined) || !isString(value.createdAt) || !isString(value.updatedAt) || !isRecord(value.legoProduct)) {
    throw new ProductError('malformed-response', 'The server returned an invalid product response.')
  }
  const category = parseCategory(value.category)
  const availableStock = value.availableStock === undefined ? value.currentStock : value.availableStock
  const legoProduct = value.legoProduct
  if (!isNumber(legoProduct.id) || !isString(legoProduct.setNumber) || !isString(legoProduct.title) || (!isString(legoProduct.description) && legoProduct.description !== null) || !isString(legoProduct.theme) || !isString(legoProduct.ageRecommendation) || !isNumber(legoProduct.pieceCount) || typeof legoProduct.isRetired !== 'boolean' || typeof legoProduct.isFeatureProduct !== 'boolean' || (!isString(legoProduct.catalogueArtworkUrl) && legoProduct.catalogueArtworkUrl !== null) || (!isString(legoProduct.catalogueArtworkPublicId) && legoProduct.catalogueArtworkPublicId !== null) || !Array.isArray(legoProduct.productImages) || !isString(legoProduct.createdAt) || !isString(legoProduct.updatedAt) || (value.condition !== 'NEW' && value.condition !== 'USED_LIKE_NEW')) {
    throw new ProductError('malformed-response', 'The server returned an invalid product response.')
  }
  const legoProductId = legoProduct.id as number
  return {
    id: value.id, legoProductId: value.legoProductId, colorfulLifeCategory: categoryEnum(category) ?? 'OTHERS', category, condition: value.condition, originalPrice: value.originalPrice, salePrice: value.salePrice,
    currentStock: value.currentStock, availableStock, createdAt: value.createdAt, updatedAt: value.updatedAt,
    legoProduct: {
      id: legoProduct.id, setNumber: legoProduct.setNumber, title: legoProduct.title, description: legoProduct.description,
      theme: legoProduct.theme, ageRecommendation: legoProduct.ageRecommendation, pieceCount: legoProduct.pieceCount,
      isRetired: legoProduct.isRetired, isFeatureProduct: legoProduct.isFeatureProduct,
      catalogueArtworkUrl: legoProduct.catalogueArtworkUrl, catalogueArtworkPublicId: legoProduct.catalogueArtworkPublicId,
      productImages: legoProduct.productImages.map(image => parseProductImage(image, legoProductId)),
      createdAt: legoProduct.createdAt, updatedAt: legoProduct.updatedAt,
    },
  }
}

const parseCataloguePage = (value: unknown): ProductCataloguePage => {
  if (!isRecord(value) || !Array.isArray(value.items) || !isRecord(value.pagination) || !isNumber(value.pagination.page) || !isNumber(value.pagination.pageSize) || !isNumber(value.pagination.totalItems) || !isNumber(value.pagination.totalPages)) {
    throw new ProductError('malformed-response', 'The server returned an invalid product catalogue response.')
  }
  return {
    items: value.items.map((item) => {
      if (isRecord(item) && isRecord(item.legoProduct)) return parseProduct(item)
      // Public catalogue responses are product-level records with nested offers.
      if (!isRecord(item) || !isNumber(item.id) || !isString(item.setNumber) || !isString(item.title) || !Array.isArray(item.offers)) {
        throw new ProductError('malformed-response', 'The server returned an invalid product catalogue response.')
      }
      const categoryValue = item.category
      const category = categoryValue === null ? null : isRecord(categoryValue) && isNumber(categoryValue.id) && isString(categoryValue.name)
        ? { id: categoryValue.id, name: categoryValue.name, subtitle: null, description: null, imageUrl: null }
        : null
      const legoProductId = item.id
      const publicProductId = item.id as number
      const sharedLegoProduct = {
        id: item.id, setNumber: item.setNumber, title: item.title,
        description: isNullableString(item.description) ? item.description : null,
        theme: isString(item.theme) ? item.theme : '', ageRecommendation: isString(item.ageRecommendation) ? item.ageRecommendation : '',
        pieceCount: isNumber(item.pieceCount) ? item.pieceCount : 0,
        isRetired: item.isRetired === true,
        isFeatureProduct: item.isFeatureProduct === true,
        catalogueArtworkUrl: isNullableString(item.catalogueArtworkUrl) ? item.catalogueArtworkUrl : null,
        catalogueArtworkPublicId: isNullableString(item.catalogueArtworkPublicId) ? item.catalogueArtworkPublicId : null,
        productImages: Array.isArray(item.productImages) ? item.productImages.map(image => parseProductImage(image, publicProductId)) : [],
        createdAt: isString(item.createdAt) ? item.createdAt : '', updatedAt: isString(item.updatedAt) ? item.updatedAt : '',
      }
      return item.offers.map((offer): ProductListing => {
        if (!isRecord(offer) || !isNumber(offer.id) || !isString(offer.originalPrice) || (!isString(offer.salePrice) && offer.salePrice !== null) || !isString(offer.condition) || !isNumber(offer.currentStock)) {
          throw new ProductError('malformed-response', 'The server returned an invalid product offer response.')
        }
        return parseProduct({
          ...offer, legoProductId, createdAt: sharedLegoProduct.createdAt, updatedAt: sharedLegoProduct.updatedAt,
          availableStock: isNumber(offer.availableStock) ? offer.availableStock : offer.currentStock,
          category, legoProduct: sharedLegoProduct,
        })
      })
    }).flat(),
    pagination: { page: value.pagination.page, pageSize: value.pagination.pageSize, totalItems: value.pagination.totalItems, totalPages: value.pagination.totalPages },
  }
}

const parseUploadResponse = (value: unknown): ProductImage => {
  if (!isRecord(value) || !('image' in value)) throw new ProductError('malformed-response', 'The server returned an invalid image response.')
  return parseProductImage(value.image)
}

const parseAdminLegoProductDetails = (value: unknown, productId: number): AdminLegoProductDetails => {
  if (!isRecord(value) || value.id !== productId || !isNumber(value.id) || !Number.isInteger(value.id) || value.id <= 0 ||
    !isString(value.setNumber) || !isString(value.title) || (!isString(value.description) && value.description !== null) ||
    !isString(value.theme) || !isString(value.ageRecommendation) || !isNumber(value.pieceCount) || !Number.isInteger(value.pieceCount) || value.pieceCount <= 0 ||
    typeof value.isRetired !== 'boolean' || !isNumber(value.categoryId) || !Number.isInteger(value.categoryId) || value.categoryId <= 0 || !Array.isArray(value.productImages)) {
    throw new ProductError('malformed-response', 'The server returned an invalid updated product response.')
  }
  const category = parseCategory(value.category)
  if (category && category.id !== value.categoryId) throw new ProductError('malformed-response', 'The server returned an inconsistent updated product category.')
  return {
    id: value.id,
    setNumber: value.setNumber,
    title: value.title,
    description: value.description,
    theme: value.theme,
    ageRecommendation: value.ageRecommendation,
    pieceCount: value.pieceCount,
    isRetired: value.isRetired,
    categoryId: value.categoryId,
    category,
    productImages: value.productImages.map(image => parseProductImage(image, productId)),
  }
}

const parseCatalogueArtworkResponse = (value: unknown): CatalogueArtwork => {
  if (!isRecord(value) || !isRecord(value.catalogueArtwork) || !isString(value.catalogueArtwork.url) || !isString(value.catalogueArtwork.publicId)) {
    throw new ProductError('malformed-response', 'The server returned an invalid catalogue artwork response.')
  }
  return { url: value.catalogueArtwork.url, publicId: value.catalogueArtwork.publicId }
}

export class ProductService {
  private readonly authService: AuthService

  constructor(authService: AuthService) {
    this.authService = authService
  }

  async createProduct(request: CreateProductRequest): Promise<ProductListing> {
    if (!hasValidListingPrices(request)) throw new ProductError('validation', priceValidationMessage)
    const response = await this.authService.authenticatedFetch('/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
    if (!response.ok) throw await errorForResponse(response, 'create')
    return parseProduct(await response.json())
  }

  async listProducts(): Promise<ProductListing[]> {
    const first = await this.authService.authenticatedFetch('/products?page=1&pageSize=100')
    if (!first.ok) throw await errorForResponse(first, 'list')
    const firstPage = parseCataloguePage(await first.json())
    if (firstPage.pagination.totalPages <= 1) return firstPage.items
    const pages = await Promise.all(Array.from({ length: firstPage.pagination.totalPages - 1 }, (_, index) => index + 2).map(async (page) => {
      const response = await this.authService.authenticatedFetch(`/products?page=${page}&pageSize=100`)
      if (!response.ok) throw await errorForResponse(response, 'list')
      return parseCataloguePage(await response.json())
    }))
    return [firstPage, ...pages].flatMap((page) => page.items)
  }

  async listAdminProductListings(): Promise<AdminProductListing[]> {
    const pageSize = 50
    const fetchPage = async (page: number) => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      const response = await this.authService.authenticatedFetch(`/admin/product-listings?${params.toString()}`)
      if (!response.ok) throw await errorForResponse(response, 'list')
      const result = parseAdminProductListingsPage(await response.json())
      if (result.pagination.page !== page || result.pagination.pageSize !== pageSize) {
        throw new ProductError('malformed-response', 'The server returned inconsistent Admin product listing pagination.')
      }
      return result
    }

    const firstPage = await fetchPage(1)
    if (firstPage.pagination.totalPages === 0) return firstPage.items
    const pages = [firstPage]
    for (let page = 2; page <= firstPage.pagination.totalPages; page += 1) {
      const nextPage = await fetchPage(page)
      if (nextPage.pagination.totalPages !== firstPage.pagination.totalPages || nextPage.pagination.totalItems !== firstPage.pagination.totalItems) {
        throw new ProductError('malformed-response', 'The server returned inconsistent Admin product listing pagination.')
      }
      pages.push(nextPage)
    }
    const listings = pages.flatMap(page => page.items)
    if (listings.length !== firstPage.pagination.totalItems) {
      throw new ProductError('malformed-response', 'The server returned an incomplete Admin product listing collection.')
    }
    return listings
  }

  async getProductAvailability(): Promise<ProductAvailabilitySummary> {
    const response = await this.authService.authenticatedFetch('/admin/products/product-availability')
    if (!response.ok) throw await errorForResponse(response, 'list')
    return parseProductAvailabilitySummary(await response.json())
  }

  async updateProductMetadata(productId: number, update: ProductMetadataUpdate): Promise<AdminLegoProductDetails> {
    const response = await this.authService.authenticatedFetch(`/admin/products/${productId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update),
    })
    if (!response.ok) throw await errorForResponse(response, 'update')
    return parseAdminLegoProductDetails(await response.json(), productId)
  }

  async searchLegoProducts(query: string, page = 1, pageSize = 20): Promise<AdminLegoProductPage> {
    const params = new URLSearchParams({ q: query, page: String(page), pageSize: String(pageSize) })
    const response = await this.authService.authenticatedFetch(`/admin/products?${params.toString()}`)
    if (!response.ok) throw await errorForResponse(response, 'lookup')
    const value: unknown = await response.json()
    if (!isRecord(value) || !Array.isArray(value.items) || !isRecord(value.pagination) || !isNumber(value.pagination.page) || !isNumber(value.pagination.pageSize) || !isNumber(value.pagination.totalItems) || !isNumber(value.pagination.totalPages)) {
      throw new ProductError('malformed-response', 'The server returned an invalid Admin product lookup response.')
    }
    const items: AdminLegoProduct[] = value.items.map((entry): AdminLegoProduct => {
      if (!isRecord(entry) || !isNumber(entry.id) || !isString(entry.setNumber) || !isString(entry.title) || (!isString(entry.description) && entry.description !== null) || !isString(entry.theme) || !isString(entry.ageRecommendation) || !isNumber(entry.pieceCount) || typeof entry.isRetired !== 'boolean' || !['AVAILABLE', 'HISTORICAL_ONLY', 'NONE'].includes(String(entry.usedOfferStatus))) {
        throw new ProductError('malformed-response', 'The server returned an invalid Admin product lookup item.')
      }
      let category: AdminLegoProduct['category'] = null
      if (entry.category !== null) {
        if (!isRecord(entry.category) || !isNumber(entry.category.id) || !isString(entry.category.name)) throw new ProductError('malformed-response', 'The server returned an invalid Admin product category.')
        category = { id: entry.category.id, name: entry.category.name }
      }
      return { id: entry.id, setNumber: entry.setNumber, title: entry.title, description: entry.description, theme: entry.theme, ageRecommendation: entry.ageRecommendation, pieceCount: entry.pieceCount, category, isRetired: entry.isRetired, usedOfferStatus: entry.usedOfferStatus as UsedOfferStatus }
    })
    return { items, pagination: { page: value.pagination.page, pageSize: value.pagination.pageSize, totalItems: value.pagination.totalItems, totalPages: value.pagination.totalPages } }
  }

  async createUsedOffer(productId: number, input: UsedOfferCreateInput): Promise<UsedOfferCreated> {
    if (!isPositivePrice(input.salePrice)) throw new ProductError('validation', priceValidationMessage)
    const form = new FormData()
    form.append('originalPrice', input.salePrice.toFixed(2))
    form.append('damageDescription', input.damageDescription.trim())
    for (const photo of input.conditionPhotos) {
      const blob = imageBlob(photo.bytes, photo.mimeType)
      form.append('conditionPhotos', blob, photo.filename)
    }
    const response = await this.authService.authenticatedFetch(`/products/${productId}/used-offers`, { method: 'POST', body: form })
    if (!response.ok) throw await errorForResponse(response, 'used')
    const value: unknown = await response.json()
    if (!isRecord(value) || !isNumber(value.id) || !isNumber(value.legoProductId) || value.condition !== 'USED_LIKE_NEW' || !isString(value.originalPrice) || (!isString(value.salePrice) && value.salePrice !== null) || value.currentStock !== 1 || value.usedLifecycle !== 'AVAILABLE' || !isString(value.damageDescription)) {
      throw new ProductError('malformed-response', 'The server returned an invalid Used offer response.')
    }
    return { id: value.id, legoProductId: value.legoProductId, condition: 'USED_LIKE_NEW', originalPrice: value.originalPrice, salePrice: value.salePrice, currentStock: 1, usedLifecycle: 'AVAILABLE', damageDescription: value.damageDescription }
  }

  async listProductImages(productId: number): Promise<ProductImage[]> {
    const response = await this.authService.authenticatedFetch(`/products/by-product/${productId}/images`)
    if (!response.ok) throw await errorForResponse(response, 'upload')
    return parseProductImagesResponse(await response.json(), productId)
  }

  async uploadProductImage(productId: number, image: ImageUploadPayload): Promise<ProductImage> {
    const form = new FormData()
    const blob = imageBlob(image.bytes, image.mimeType)
    form.append('file', blob, image.filename)
    if (image.altText !== undefined) form.append('altText', image.altText)
    const response = await this.authService.authenticatedFetch(`/products/by-product/${productId}/images`, { method: 'POST', body: form })
    if (!response.ok) throw await errorForResponse(response, 'upload')
    return parseUploadResponse(await response.json())
  }

  async reorderProductImages(productId: number, imageIds: number[]): Promise<ProductImage[]> {
    const response = await this.authService.authenticatedFetch(`/products/by-product/${productId}/images/order`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageIds }),
    })
    if (!response.ok) throw await errorForResponse(response, 'upload')
    return parseProductImagesResponse(await response.json(), productId)
  }

  async updateProductImageAltText(productId: number, imageId: number, altText: string | null): Promise<ProductImage> {
    const response = await this.authService.authenticatedFetch(`/products/by-product/${productId}/images/${imageId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ altText }),
    })
    if (!response.ok) throw await errorForResponse(response, 'upload')
    return parseUploadResponse(await response.json())
  }

  async deleteProductImage(productId: number, imageId: number): Promise<void> {
    const response = await this.authService.authenticatedFetch(`/products/by-product/${productId}/images/${imageId}`, { method: 'DELETE' })
    if (!response.ok) throw await errorForResponse(response, 'upload')
  }

  async setFeatureProduct(productId: number): Promise<{ id: number; isFeatureProduct: boolean }> {
    const response = await this.authService.authenticatedFetch(`/products/by-product/${productId}/feature`, { method: 'PATCH' })
    if (!response.ok) throw await errorForResponse(response, 'feature')
    const value: unknown = await response.json()
    if (!isRecord(value) || !isNumber(value.id) || typeof value.isFeatureProduct !== 'boolean') throw new ProductError('malformed-response', 'The server returned an invalid feature product response.')
    return { id: value.id, isFeatureProduct: value.isFeatureProduct }
  }

  async uploadCatalogueArtwork(productId: number, image: ImageUploadPayload): Promise<CatalogueArtwork> {
    const form = new FormData()
    form.append('file', imageBlob(image.bytes, image.mimeType), image.filename)
    const response = await this.authService.authenticatedFetch(`/products/by-product/${productId}/catalogue-artwork`, { method: 'PUT', body: form })
    if (!response.ok) throw await errorForResponse(response, 'catalogue')
    return parseCatalogueArtworkResponse(await response.json())
  }

  async removeCatalogueArtwork(productId: number): Promise<void> {
    const response = await this.authService.authenticatedFetch(`/products/by-product/${productId}/catalogue-artwork`, { method: 'DELETE' })
    if (!response.ok) throw await errorForResponse(response, 'catalogue')
  }
}

export const isImageUploadPayload = (value: unknown): value is ImageUploadPayload => {
  if (!isRecord(value) || !(value.bytes instanceof Uint8Array) || value.bytes.byteLength > 8 * 1024 * 1024 || !isString(value.filename) || value.filename.length === 0 || !isString(value.mimeType) || !['image/jpeg', 'image/png', 'image/webp'].includes(value.mimeType)) return false
  return value.altText === undefined || (isString(value.altText) && value.altText.length <= 300)
}

export const isCreateProductRequest = (value: unknown): value is CreateProductRequest => {
  if (!isRecord(value) || !hasValidListingPrices(value)) return false
  const { pieceCount, condition } = value
  if (!isString(value.setNumber) || !isString(value.title) || !isString(value.theme) || !isString(value.ageRecommendation) || typeof pieceCount !== 'number' || !Number.isInteger(pieceCount) || pieceCount <= 0 || (condition !== 'NEW' && condition !== 'USED_LIKE_NEW') || !isNumber(value.categoryId) || !Number.isInteger(value.categoryId) || value.categoryId <= 0) return false
  const currentStock = value.currentStock
  return (value.description === undefined || isString(value.description)) && (value.isRetired === undefined || typeof value.isRetired === 'boolean') && (currentStock === undefined || (typeof currentStock === 'number' && Number.isInteger(currentStock) && currentStock >= 0))
}

const metadataUpdateKeys = new Set(['setNumber', 'title', 'description', 'theme', 'ageRecommendation', 'pieceCount', 'isRetired', 'categoryId'])

export const isProductMetadataUpdate = (value: unknown): value is ProductMetadataUpdate => {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (keys.length === 0 || keys.some(key => !metadataUpdateKeys.has(key))) return false
  if (value.setNumber !== undefined && (!isString(value.setNumber) || value.setNumber.trim().length === 0)) return false
  if (value.title !== undefined && (!isString(value.title) || value.title.trim().length === 0)) return false
  if (value.description !== undefined && !isString(value.description)) return false
  if (value.theme !== undefined && (!isString(value.theme) || value.theme.trim().length === 0)) return false
  if (value.ageRecommendation !== undefined && (!isString(value.ageRecommendation) || value.ageRecommendation.trim().length === 0)) return false
  if (value.pieceCount !== undefined && (!isNumber(value.pieceCount) || !Number.isInteger(value.pieceCount) || value.pieceCount <= 0)) return false
  if (value.isRetired !== undefined && typeof value.isRetired !== 'boolean') return false
  if (value.categoryId !== undefined && (!isNumber(value.categoryId) || !Number.isInteger(value.categoryId) || value.categoryId <= 0)) return false
  return true
}
