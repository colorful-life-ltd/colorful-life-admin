import type { AdminOperationsApi } from './operations-contract.js'
import type { AdminInventoryApi } from './inventory-contract.js'
import type { AdminOrdersApi } from './order-contract.js'
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AdminAuthApi, AdminSessionEndedNotice } from './auth-contract.js'
import type { AdminWindowApi } from './window-contract.js'
import type { AdminProductsApi } from './product-contract.js'
import type { AdminCategoriesApi } from './category-contract.js'
import type { AdminPurchasesApi } from './purchase-contract.js'

// Keep cloneable IPC error envelopes as data until the renderer restores their Error fields.
const forwardIpcResult = <Result,>(request: Promise<Result>): Promise<Result> => request

// Keep the preload as the only future boundary for renderer-to-main IPC.
const adminAuth: AdminAuthApi = {
  login: (credentials) => forwardIpcResult(ipcRenderer.invoke('admin-auth:login', credentials)),
  restore: () => forwardIpcResult(ipcRenderer.invoke('admin-auth:restore')),
  renewSession: () => forwardIpcResult(ipcRenderer.invoke('admin-auth:renew')),
  onSessionRenewed: (listener) => {
    const channelListener = (_event: IpcRendererEvent, accessTokenExpiresAt: string) => listener(accessTokenExpiresAt)
    ipcRenderer.on('admin-auth:session-renewed', channelListener)
    return () => ipcRenderer.removeListener('admin-auth:session-renewed', channelListener)
  },
  onSessionEnded: (listener) => {
    const channelListener = (_event: IpcRendererEvent, notice: AdminSessionEndedNotice) => listener(notice)
    ipcRenderer.on('admin-auth:session-ended', channelListener)
    return () => ipcRenderer.removeListener('admin-auth:session-ended', channelListener)
  },
  logout: () => forwardIpcResult(ipcRenderer.invoke('admin-auth:logout')),
}

contextBridge.exposeInMainWorld('adminAuth', adminAuth)

const adminWindow: AdminWindowApi = {
  maximize: () => forwardIpcResult(ipcRenderer.invoke('admin-window:maximize')),
}

contextBridge.exposeInMainWorld('adminWindow', adminWindow)

const adminProducts: AdminProductsApi = {
  createProduct: (request) => forwardIpcResult(ipcRenderer.invoke('admin-products:create', request)),
  listProducts: () => forwardIpcResult(ipcRenderer.invoke('admin-products:list')),
  listAdminProductListings: () => forwardIpcResult(ipcRenderer.invoke('admin-products:list-admin-product-listings')),
  getProductAvailability: () => forwardIpcResult(ipcRenderer.invoke('admin-products:product-availability')),
  updateProductMetadata: (productId, update) => forwardIpcResult(ipcRenderer.invoke('admin-products:update-metadata', productId, update)),
  listProductImages: (productId) => forwardIpcResult(ipcRenderer.invoke('admin-products:list-product-images', productId)),
  uploadProductImage: (productId, image) => forwardIpcResult(ipcRenderer.invoke('admin-products:upload-image', productId, image)),
  reorderProductImages: (productId, imageIds) => forwardIpcResult(ipcRenderer.invoke('admin-products:reorder-product-images', productId, imageIds)),
  updateProductImageAltText: (productId, imageId, altText) => forwardIpcResult(ipcRenderer.invoke('admin-products:update-product-image-alt-text', productId, imageId, altText)),
  deleteProductImage: (productId, imageId) => forwardIpcResult(ipcRenderer.invoke('admin-products:delete-product-image', productId, imageId)),
  setFeatureProduct: (productId) => forwardIpcResult(ipcRenderer.invoke('admin-products:set-feature', productId)),
  uploadCatalogueArtwork: (productId, image) => forwardIpcResult(ipcRenderer.invoke('admin-products:upload-catalogue-artwork', productId, image)),
  removeCatalogueArtwork: (productId) => forwardIpcResult(ipcRenderer.invoke('admin-products:remove-catalogue-artwork', productId)),
  searchLegoProducts: (query, page, pageSize) => forwardIpcResult(ipcRenderer.invoke('admin-products:lookup-lego-products', query, page, pageSize)),
  createUsedOffer: (productId, input) => forwardIpcResult(ipcRenderer.invoke('admin-products:create-used-offer', productId, input)),
}

contextBridge.exposeInMainWorld('adminProducts', adminProducts)

const adminCategories: AdminCategoriesApi = {
  list: () => forwardIpcResult(ipcRenderer.invoke('admin-categories:list')),
  getProductAvailability: (categoryId) => forwardIpcResult(ipcRenderer.invoke('admin-categories:product-availability', categoryId)),
  create: (input) => forwardIpcResult(ipcRenderer.invoke('admin-categories:create', input)),
  update: (categoryId, update) => forwardIpcResult(ipcRenderer.invoke('admin-categories:update', categoryId, update)),
  uploadArtwork: (categoryId, image) => forwardIpcResult(ipcRenderer.invoke('admin-categories:upload-artwork', categoryId, image)),
  removeArtwork: (categoryId) => forwardIpcResult(ipcRenderer.invoke('admin-categories:remove-artwork', categoryId)),
  uploadThumbnailArtwork: (categoryId, image) => forwardIpcResult(ipcRenderer.invoke('admin-categories:upload-thumbnail-artwork', categoryId, image)),
  removeThumbnailArtwork: (categoryId) => forwardIpcResult(ipcRenderer.invoke('admin-categories:remove-thumbnail-artwork', categoryId)),
}

contextBridge.exposeInMainWorld('adminCategories', adminCategories)

const adminPurchases: AdminPurchasesApi = {
  getManualSupplierOptions: () => forwardIpcResult(ipcRenderer.invoke('admin-purchases:manual-supplier-options')),
  createManual: (input) => forwardIpcResult(ipcRenderer.invoke('admin-purchases:create-manual', input)),
  review: (id) => forwardIpcResult(ipcRenderer.invoke('admin-purchases:review', id)),
  amend: (id, itemId, input) => forwardIpcResult(ipcRenderer.invoke('admin-purchases:amend', id, itemId, input)),
  resolve: (id, groupId, input) => forwardIpcResult(ipcRenderer.invoke('admin-purchases:resolve', id, groupId, input)),
  setInventoryDisposition: (id, groupId, input) => forwardIpcResult(ipcRenderer.invoke('admin-purchases:set-inventory-disposition', id, groupId, input)),
  receive: (id, groupId, input) => forwardIpcResult(ipcRenderer.invoke('admin-purchases:receive', id, groupId, input)),
  searchProducts: (id, query) => forwardIpcResult(ipcRenderer.invoke('admin-purchases:search-products', id, query)),
  createListing: (id, input) => forwardIpcResult(ipcRenderer.invoke('admin-purchases:create-listing', id, input)),
  importPdf: (file) => forwardIpcResult(ipcRenderer.invoke('admin-purchases:import-pdf', file)),
  list: (page, pageSize, search) => forwardIpcResult(ipcRenderer.invoke('admin-purchases:list', page, pageSize, search)),
  get: (purchaseId) => forwardIpcResult(ipcRenderer.invoke('admin-purchases:get', purchaseId)),
  purchaseAnalyticsSummary: () => forwardIpcResult(ipcRenderer.invoke('admin-purchases:analytics-summary')),
  supplierMonthlyAnalytics: (supplierKey) => forwardIpcResult(ipcRenderer.invoke('admin-purchases:supplier-monthly-analytics', supplierKey)),
}

contextBridge.exposeInMainWorld('adminPurchases', adminPurchases)

const adminOrders: AdminOrdersApi = {
  financials: (id) => forwardIpcResult(ipcRenderer.invoke('admin-orders:financials', id)),
  list: (page, pageSize) => forwardIpcResult(ipcRenderer.invoke('admin-orders:list', page, pageSize)),
  get: (id) => forwardIpcResult(ipcRenderer.invoke('admin-orders:get', id)),
  preparing: (id) => forwardIpcResult(ipcRenderer.invoke('admin-orders:preparing', id)),
  dispatch: (id, input) => forwardIpcResult(ipcRenderer.invoke('admin-orders:dispatch', id, input)),
  cancel: (id, reason) => forwardIpcResult(ipcRenderer.invoke('admin-orders:cancel', id, reason)),
}
contextBridge.exposeInMainWorld('adminOrders', adminOrders)

const adminInventory: AdminInventoryApi = {
  list: (page) => forwardIpcResult(ipcRenderer.invoke('admin-inventory:list', page)),
  movements: (id) => forwardIpcResult(ipcRenderer.invoke('admin-inventory:movements', id)),
  getOutbound: (id) => forwardIpcResult(ipcRenderer.invoke('admin-inventory:get-outbound', id)),
  pending: () => forwardIpcResult(ipcRenderer.invoke('admin-inventory:pending')),
  prepare: (input) => forwardIpcResult(ipcRenderer.invoke('admin-inventory:prepare', input)),
  submit: (key) => forwardIpcResult(ipcRenderer.invoke('admin-inventory:submit', key)),
  finish: (key) => forwardIpcResult(ipcRenderer.invoke('admin-inventory:finish', key)),
}
contextBridge.exposeInMainWorld('adminInventory', adminInventory)

const adminOperations: AdminOperationsApi = {
  read: (operation,input) => forwardIpcResult(ipcRenderer.invoke('admin-operations:read',operation,input)),
  execute: (operation,input) => forwardIpcResult(ipcRenderer.invoke('admin-operations:execute',operation,input)),
  pending: () => forwardIpcResult(ipcRenderer.invoke('admin-operations:pending')),
  finish: (operation,input) => forwardIpcResult(ipcRenderer.invoke('admin-operations:finish',operation,input)),
  resolve: (operation,input,decision,note) => forwardIpcResult(ipcRenderer.invoke('admin-operations:resolve',operation,input,decision,note)),
}
contextBridge.exposeInMainWorld('adminOperations',adminOperations)
