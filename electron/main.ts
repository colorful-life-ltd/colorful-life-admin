import { registerOperationsIpc } from './operations-ipc.js'
import { OperationsService } from './operations-service.js'
import { FileJournal } from './inventory-store.js'
import type { SavedOperation } from './operations-contract.js'
import type { OperationJournal } from './operations-service.js'
import { InventoryService } from './inventory-service.js'
import { FileShipmentStore } from './inventory-store.js'
import { registerInventoryIpc } from './inventory-ipc.js'
import { hasValidListingPrices, isPositivePrice, priceValidationMessage } from './listing-price.js'
import { safeTrackingUrl } from './tracking-url.js'
import { OrderService } from './order-service.js'
import { registerOrderIpc } from './order-ipc.js'
import { shell, app, BrowserWindow, ipcMain, Menu, type IpcMainInvokeEvent } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AuthError, AuthService } from './auth-service.js'
import type { LoginCredentials } from './auth-contract.js'
import { isCreateProductRequest, isImageUploadPayload, isProductMetadataUpdate, ProductError, ProductService } from './product-service.js'
import { CategoryError, CategoryService, validateCategoryCreate } from './category-service.js'
import { PurchaseError, PurchaseService, validateAmendment, validateReceipt, validateResolution, validateInventoryDisposition, validateListingCreation } from './purchase-service.js'
import type { ManualPurchaseInput } from './purchase-contract.js'
import { handleEditContextMenu } from './edit-context-menu.js'
import { guardRendererNavigation, secureIpcHandler, trustedRendererUrl } from './renderer-security.js'
import { validateBackendUrl } from './backend-url.js'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const rendererUrl = trustedRendererUrl(join(app.getAppPath(), 'dist', 'index.html'), process.env.ELECTRON_RENDERER_URL, app.isPackaged)
const backendUrl = validateBackendUrl(process.env.COLORFUL_LIFE_BACKEND_URL ?? 'http://localhost:3000')
let mainWindow: BrowserWindow | null = null
const authService = new AuthService(backendUrl, (input, init) => fetch(input, { ...init, redirect: 'error' }), (notice) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('admin-auth:session-ended', notice)
}, (accessTokenExpiresAt) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('admin-auth:session-renewed', accessTokenExpiresAt)
})
const productService = new ProductService(authService)
const categoryService = new CategoryService(authService)
const purchaseService = new PurchaseService(authService)

const handleIpc = <Arguments extends unknown[], Result>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Arguments) => Result | Promise<Result>,
): void => {
  ipcMain.handle(channel, secureIpcHandler(() => mainWindow, rendererUrl, handler))
}

registerOperationsIpc(handleIpc, new OperationsService(authService, new FileJournal<OperationJournal | SavedOperation>(join(app.getPath('userData'), 'operator-intents'), () => app.requestSingleInstanceLock()), backendUrl))

registerOrderIpc(handleIpc, new OrderService(authService))
registerInventoryIpc(handleIpc, new InventoryService(authService, new FileShipmentStore(join(app.getPath('userData'), 'inventory-shipments'), () => app.requestSingleInstanceLock()), backendUrl))

const isLoginCredentials = (value: unknown): value is LoginCredentials =>
  typeof value === 'object' &&
  value !== null &&
  'email' in value &&
  'password' in value &&
  typeof value.email === 'string' &&
  typeof value.password === 'string'

handleIpc('admin-auth:login', async (_event, credentials: unknown) => {
  if (!isLoginCredentials(credentials)) {
    throw new AuthError('validation', 'Invalid sign-in details.')
  }
  return authService.login(credentials)
})

handleIpc('admin-auth:restore', () => authService.restore())
handleIpc('admin-auth:renew', () => authService.renewSession())
handleIpc('admin-auth:logout', () => authService.logout())
handleIpc('admin-window:maximize', (event) => {
  if (mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents) mainWindow.maximize()
})

handleIpc('admin-products:create', async (_event, request: unknown) => {
  if (!isCreateProductRequest(request)) throw new ProductError('validation', typeof request === 'object' && request !== null && !hasValidListingPrices(request) ? priceValidationMessage : 'Invalid product details.')
  return productService.createProduct(request)
})

handleIpc('admin-products:list', () => productService.listProducts())
handleIpc('admin-products:list-admin-product-listings', () => productService.listAdminProductListings())
handleIpc('admin-products:product-availability', () => productService.getProductAvailability())
handleIpc('admin-products:update-metadata', async (_event, productId: unknown, update: unknown) => {
  if (!isProductMetadataUpdate(update)) throw new ProductError('validation', 'Enter valid product details to update.')
  return productService.updateProductMetadata(validateProductId(productId), update)
})

handleIpc('admin-products:lookup-lego-products', async (_event, query: unknown, page: unknown = 1, pageSize: unknown = 20) => {
  if (typeof query !== 'string' || query.trim().length < 1 || query.trim().length > 100 || typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > 10000 || typeof pageSize !== 'number' || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new ProductError('validation', 'Enter a search term of up to 100 characters.')
  }
  return productService.searchLegoProducts(query.trim(), page, pageSize)
})

handleIpc('admin-products:create-used-offer', async (_event, productId: unknown, input: unknown) => {
  if (typeof productId !== 'number' || !Number.isInteger(productId) || productId <= 0 || typeof input !== 'object' || input === null || !('salePrice' in input) || typeof input.salePrice !== 'number' || !isPositivePrice(input.salePrice) || !('damageDescription' in input) || typeof input.damageDescription !== 'string' || input.damageDescription.trim().length < 1 || input.damageDescription.trim().length > 2000 || !('conditionPhotos' in input) || !Array.isArray(input.conditionPhotos) || input.conditionPhotos.length < 1 || input.conditionPhotos.length > 3 || !input.conditionPhotos.every((photo: unknown) => isImageUploadPayload(photo) && photo.bytes.byteLength > 0 && photo.altText === undefined)) {
    throw new ProductError('validation', 'Provide a valid price, damage description, and 1 to 3 condition photos.')
  }
  if ('sourceNewListingId' in input && (typeof input.sourceNewListingId !== 'number' || !Number.isSafeInteger(input.sourceNewListingId) || input.sourceNewListingId < 1 || !('reasonNote' in input) || typeof input.reasonNote !== 'string' || input.reasonNote.trim().length < 10 || input.reasonNote.length > 1000)) throw new ProductError('validation','A conversion requires an exact source listing and reason.')
  return productService.createUsedOffer(productId, input as import('./product-contract.js').UsedOfferCreateInput)
})

const validateProductId = (productId: unknown): number => {
  if (typeof productId !== 'number' || !Number.isInteger(productId) || productId <= 0) throw new ProductError('validation', 'Invalid LEGO product.')
  return productId
}

const validateImageId = (imageId: unknown): number => {
  if (typeof imageId !== 'number' || !Number.isInteger(imageId) || imageId <= 0) throw new ProductError('validation', 'Invalid product image.')
  return imageId
}

const validateCatalogueArtwork = (image: unknown) => {
  if (!isImageUploadPayload(image)) throw new ProductError('validation', 'Invalid catalogue artwork.')
  return image
}

handleIpc('admin-products:list-product-images', async (_event, productId: unknown) => productService.listProductImages(validateProductId(productId)))
handleIpc('admin-products:upload-image', async (_event, productId: unknown, image: unknown) => {
  if (!isImageUploadPayload(image)) throw new ProductError('validation', 'Invalid product image.')
  return productService.uploadProductImage(validateProductId(productId), image)
})
handleIpc('admin-products:reorder-product-images', async (_event, productId: unknown, imageIds: unknown) => {
  if (!Array.isArray(imageIds) || imageIds.some(imageId => typeof imageId !== 'number' || !Number.isInteger(imageId) || imageId <= 0)) throw new ProductError('validation', 'Invalid product image order.')
  return productService.reorderProductImages(validateProductId(productId), imageIds as number[])
})
handleIpc('admin-products:update-product-image-alt-text', async (_event, productId: unknown, imageId: unknown, altText: unknown) => {
  if (altText !== null && (typeof altText !== 'string' || altText.length > 300)) throw new ProductError('validation', 'Invalid product image alt text.')
  return productService.updateProductImageAltText(validateProductId(productId), validateImageId(imageId), altText as string | null)
})
handleIpc('admin-products:delete-product-image', async (_event, productId: unknown, imageId: unknown) => productService.deleteProductImage(validateProductId(productId), validateImageId(imageId)))
handleIpc('admin-products:set-feature', async (_event, productId: unknown) => productService.setFeatureProduct(validateProductId(productId)))
handleIpc('admin-products:upload-catalogue-artwork', async (_event, productId: unknown, image: unknown) => productService.uploadCatalogueArtwork(validateProductId(productId), validateCatalogueArtwork(image)))
handleIpc('admin-products:remove-catalogue-artwork', async (_event, productId: unknown) => productService.removeCatalogueArtwork(validateProductId(productId)))

const validateCategoryId = (categoryId: unknown): number => {
  if (typeof categoryId !== 'number' || !Number.isInteger(categoryId) || categoryId <= 0) throw new CategoryError('validation', 'Invalid category.')
  return categoryId
}

handleIpc('admin-categories:list', () => categoryService.list())
handleIpc('admin-categories:product-availability', async (_event, categoryId: unknown) => categoryService.getProductAvailability(validateCategoryId(categoryId)))
handleIpc('admin-categories:create', (_event, input: unknown) => categoryService.create(validateCategoryCreate(input)))
handleIpc('admin-categories:update', async (_event, categoryId: unknown, update: unknown) => {
  if (typeof update !== 'object' || update === null || typeof (update as Record<string, unknown>).name !== 'string') throw new CategoryError('validation', 'Invalid category details.')
  return categoryService.update(validateCategoryId(categoryId), update as { name: string; subtitle: string | null; description: string | null })
})
handleIpc('admin-categories:upload-artwork', async (_event, categoryId: unknown, image: unknown) => {
  if (!isImageUploadPayload(image)) throw new CategoryError('validation', 'Invalid category artwork.')
  return categoryService.uploadArtwork(validateCategoryId(categoryId), image)
})
handleIpc('admin-categories:remove-artwork', async (_event, categoryId: unknown) => categoryService.removeArtwork(validateCategoryId(categoryId)))
handleIpc('admin-categories:upload-thumbnail-artwork', async (_event, categoryId: unknown, image: unknown) => {
  if (!isImageUploadPayload(image)) throw new CategoryError('validation', 'Invalid category thumbnail artwork.')
  return categoryService.uploadThumbnailArtwork(validateCategoryId(categoryId), image)
})
handleIpc('admin-categories:remove-thumbnail-artwork', async (_event, categoryId: unknown) => categoryService.removeThumbnailArtwork(validateCategoryId(categoryId)))

const validatePurchaseId = (purchaseId: unknown): number => {
  if (typeof purchaseId !== 'number' || !Number.isInteger(purchaseId) || purchaseId <= 0) throw new PurchaseError('validation', 'Invalid purchase.')
  return purchaseId
}
const validateSupplierKey = (supplierKey: unknown): string => {
  if (typeof supplierKey !== 'string' || supplierKey.trim() === '' || supplierKey.length > 200) throw new PurchaseError('validation', 'Invalid supplier selection.')
  return supplierKey
}
const validatePage = (value: unknown, fallback: number): number => value === undefined ? fallback : typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : (() => { throw new PurchaseError('validation', 'Invalid purchase history page.') })()
const validatePageSize = (value: unknown, fallback: number): number => value === undefined ? fallback : typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 6 ? value : (() => { throw new PurchaseError('validation', 'Invalid purchase history page size.') })()
const validatePurchaseSearch = (value: unknown): string | undefined => value === undefined ? undefined : typeof value === 'string' ? value : (() => { throw new PurchaseError('validation', 'Invalid purchase history search.') })()

const validatePdf = (file: unknown): { bytes: Uint8Array; filename: string; mimeType: 'application/pdf' } => {
  if (typeof file !== 'object' || file === null) throw new PurchaseError('validation', 'Choose a PDF purchase document.')
  const value = file as Record<string, unknown>
  if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength === 0 || value.bytes.byteLength > 10 * 1024 * 1024 || typeof value.filename !== 'string' || value.filename.trim() === '' || value.mimeType !== 'application/pdf') throw new PurchaseError('validation', 'Choose a PDF purchase document no larger than 10 MB.')
  return { bytes: value.bytes, filename: value.filename, mimeType: 'application/pdf' }
}

handleIpc('admin-purchases:import-pdf', async (_event, file: unknown) => purchaseService.importPdf(validatePdf(file)))
handleIpc('admin-purchases:manual-supplier-options', () => purchaseService.getManualSupplierOptions())
handleIpc('admin-purchases:create-manual', (_event, input: unknown) => purchaseService.createManual(input as ManualPurchaseInput))
handleIpc('admin-purchases:list', async (_event, page: unknown, pageSize: unknown, search: unknown) => purchaseService.list(validatePage(page, 1), validatePageSize(pageSize, 6), validatePurchaseSearch(search)))
handleIpc('admin-purchases:get', async (_event, purchaseId: unknown) => purchaseService.get(validatePurchaseId(purchaseId)))
handleIpc('admin-purchases:analytics-summary', () => purchaseService.purchaseAnalyticsSummary())
handleIpc('admin-purchases:supplier-monthly-analytics', (_event, supplierKey: unknown) => purchaseService.supplierMonthlyAnalytics(validateSupplierKey(supplierKey)))
handleIpc('admin-purchases:review', (_event, id: unknown) => purchaseService.review(validatePurchaseId(id)))
handleIpc('admin-purchases:amend', (_event, id: unknown, itemId: unknown, input: unknown) => purchaseService.amend(validatePurchaseId(id), validatePurchaseId(itemId), validateAmendment(input)))
handleIpc('admin-purchases:resolve', (_event, id: unknown, groupId: unknown, input: unknown) => purchaseService.resolve(validatePurchaseId(id), validatePurchaseId(groupId), validateResolution(input)))
handleIpc('admin-purchases:set-inventory-disposition', (_event, id: unknown, groupId: unknown, input: unknown) => purchaseService.setInventoryDisposition(validatePurchaseId(id), validatePurchaseId(groupId), validateInventoryDisposition(input)))
handleIpc('admin-purchases:receive', (_event, id: unknown, groupId: unknown, input: unknown) => purchaseService.receive(validatePurchaseId(id), validatePurchaseId(groupId), validateReceipt(input)))
handleIpc('admin-purchases:search-products', (_event, id: unknown, query: unknown) => {
  if (typeof query !== 'string' || !query.trim() || query.length > 100) throw new PurchaseError('validation', 'Enter a product search')
  return purchaseService.searchProducts(validatePurchaseId(id), query.trim())
})
handleIpc('admin-purchases:create-listing', (_event, id: unknown, input: unknown) => purchaseService.createListing(validatePurchaseId(id), validateListingCreation(input)))

const createWindow = (): void => {
  const window = new BrowserWindow({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      preload: join(currentDirectory, 'preload.cjs'),
    },
  })
  guardRendererNavigation(window, rendererUrl)
  window.webContents.setWindowOpenHandler(({ url }) => {
    const trackingUrl = safeTrackingUrl(url)
    if (trackingUrl) void shell.openExternal(trackingUrl).catch(() => undefined)
    return { action: 'deny' }
  })
  mainWindow = window
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  window.webContents.on('context-menu', (event, params) => {
    handleEditContextMenu(event, { ...params.editFlags, isEditable: params.isEditable, x: params.x, y: params.y }, (template, x, y) => {
      Menu.buildFromTemplate(template).popup({ window, x, y })
    })
  })

  void window.loadURL(rendererUrl)
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
