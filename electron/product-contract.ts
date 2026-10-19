export type ListingCondition = 'NEW' | 'USED_LIKE_NEW'
export type ColorfulLifeCategory = 'HARRY_POTTER' | 'STAR_WARS' | 'FRIENDS' | 'CITY' | 'DISNEY' | 'MARVEL' | 'JURASSIC_WORLD' | 'FLOWERS_AND_BOTANICALS' | 'NINJAGO' | 'HEROES' | 'VEHICLES' | 'CREATOR' | 'OTHERS'

export const colorfulLifeCategoryOptions = [
  ['HARRY_POTTER', 'Harry Potter'], ['STAR_WARS', 'Star Wars'], ['FRIENDS', 'Friends'], ['CITY', 'City'], ['DISNEY', 'Disney'], ['MARVEL', 'Marvel'],
  ['JURASSIC_WORLD', 'Jurassic World'], ['FLOWERS_AND_BOTANICALS', 'Flowers & Botanicals'], ['NINJAGO', 'Ninjago'], ['HEROES', 'Heroes'], ['VEHICLES', 'Vehicles'], ['CREATOR', 'Creator'], ['OTHERS', 'Others'],
] as const satisfies ReadonlyArray<readonly [ColorfulLifeCategory, string]>

export interface CreateProductRequest {
  setNumber: string
  title: string
  description?: string
  theme: string
  categoryId: number
  ageRecommendation: string
  pieceCount: number
  condition: ListingCondition
  originalPrice: number
  salePrice?: number | null
  currentStock?: number
  isRetired?: boolean
}

export interface LegoProduct {
  id: number
  setNumber: string
  title: string
  description: string | null
  theme: string
  ageRecommendation: string
  pieceCount: number
  isRetired: boolean
  isFeatureProduct: boolean
  catalogueArtworkUrl: string | null
  catalogueArtworkPublicId: string | null
  productImages: ProductImage[]
  createdAt: string
  updatedAt: string
}

export interface BackendCategory {
  id: number
  name: string
  subtitle: string | null
  description: string | null
  imageUrl: string | null
}

export interface ProductImage {
  id: number
  legoProductId: number
  url: string
  publicId: string
  altText: string | null
  sortOrder: number
  createdAt?: string
}

export interface ProductListing {
  id: number
  legoProductId: number
  colorfulLifeCategory: ColorfulLifeCategory
  category: BackendCategory | null
  condition: ListingCondition
  originalPrice: string
  salePrice: string | null
  currentStock: number
  availableStock: number
  createdAt: string
  updatedAt: string
  legoProduct: LegoProduct
}

export interface ImageUploadPayload {
  bytes: Uint8Array
  filename: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  altText?: string
}

export interface CatalogueArtwork {
  url: string
  publicId: string
}

export interface ProductCataloguePage {
  items: ProductListing[]
  pagination: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
  }
}

export interface ProductAvailabilitySummary {
  totalProducts: number
  totalInventory: number
  activeProducts: number
  inactiveProducts: number
}

/** Admin listing rows with shared presentation owned by the nested LegoProduct. */
export interface AdminProductListing {
  id: number
  condition: ListingCondition
  active: boolean
  usedLifecycle: 'AVAILABLE' | 'SOLD' | 'RETIRED' | null
  currentStock: number
  availableStock: number
  legoProduct: {
    id: number
    setNumber: string
    title: string
    category: { id: number; name: string } | null
    isFeatureProduct: boolean
    catalogueArtworkUrl: string | null
    catalogueArtworkPublicId: string | null
    productImages: ProductImage[]
  }
}

export type UsedOfferStatus = 'AVAILABLE' | 'HISTORICAL_ONLY' | 'NONE'

export interface AdminLegoProduct {
  id: number
  setNumber: string
  title: string
  description: string | null
  theme: string
  ageRecommendation: string
  pieceCount: number
  category: { id: number; name: string } | null
  isRetired: boolean
  usedOfferStatus: UsedOfferStatus
}

export interface AdminLegoProductPage {
  items: AdminLegoProduct[]
  pagination: ProductCataloguePage['pagination']
}

export interface ProductMetadataUpdate {
  setNumber?: string
  title?: string
  description?: string
  theme?: string
  ageRecommendation?: string
  pieceCount?: number
  isRetired?: boolean
  categoryId?: number
}

/** Updated shared catalogue data returned by PATCH /admin/products/:productId. */
export interface AdminLegoProductDetails {
  id: number
  setNumber: string
  title: string
  description: string | null
  theme: string
  ageRecommendation: string
  pieceCount: number
  isRetired: boolean
  categoryId: number
  category: BackendCategory | null
  productImages: ProductImage[]
}

export interface UsedConditionPhoto {
  bytes: Uint8Array
  filename: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
}

export interface UsedOfferCreateInput {
  sourceNewListingId?: number
  reasonNote?: string
  salePrice: number
  damageDescription: string
  conditionPhotos: UsedConditionPhoto[]
}

export interface UsedOfferCreated {
  id: number
  legoProductId: number
  condition: 'USED_LIKE_NEW'
  originalPrice: string
  salePrice: string | null
  currentStock: 1
  usedLifecycle: 'AVAILABLE'
  damageDescription: string
}

export interface AdminProductsApi {
  createProduct(request: CreateProductRequest): Promise<ProductListing>
  listProducts(): Promise<ProductListing[]>
  listAdminProductListings(): Promise<AdminProductListing[]>
  getProductAvailability(): Promise<ProductAvailabilitySummary>
  updateProductMetadata(productId: number, update: ProductMetadataUpdate): Promise<AdminLegoProductDetails>
  listProductImages(productId: number): Promise<ProductImage[]>
  uploadProductImage(productId: number, image: ImageUploadPayload): Promise<ProductImage>
  reorderProductImages(productId: number, imageIds: number[]): Promise<ProductImage[]>
  updateProductImageAltText(productId: number, imageId: number, altText: string | null): Promise<ProductImage>
  deleteProductImage(productId: number, imageId: number): Promise<void>
  setFeatureProduct(productId: number): Promise<{ id: number; isFeatureProduct: boolean }>
  uploadCatalogueArtwork(productId: number, image: ImageUploadPayload): Promise<CatalogueArtwork>
  removeCatalogueArtwork(productId: number): Promise<void>
  searchLegoProducts(query: string, page?: number, pageSize?: number): Promise<AdminLegoProductPage>
  createUsedOffer(productId: number, input: UsedOfferCreateInput): Promise<UsedOfferCreated>
}
