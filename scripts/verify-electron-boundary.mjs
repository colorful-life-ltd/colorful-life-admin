import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const preloadSource = readFileSync(resolve('electron', 'preload.cts'), 'utf8')
const mainSource = readFileSync(resolve('electron', 'main.ts'), 'utf8')
const rendererApiSource = readFileSync(resolve('src', 'admin-api.ts'), 'utf8')
const builtPreloadSource = readFileSync(resolve('dist-electron', 'preload.cjs'), 'utf8')
const builtMainSource = readFileSync(resolve('dist-electron', 'main.js'), 'utf8')
const editMenuSource = readFileSync(resolve('electron', 'edit-context-menu.ts'), 'utf8')
const builtEditMenuSource = readFileSync(resolve('dist-electron', 'edit-context-menu.js'), 'utf8')
const channels = [...preloadSource.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((match) => match[1])
const maximizeWindowBridge = "maximize: () => forwardIpcResult(ipcRenderer.invoke('admin-window:maximize'))"
if (!preloadSource.includes("contextBridge.exposeInMainWorld('adminWindow'") || !builtPreloadSource.includes("exposeInMainWorld('adminWindow'") || !preloadSource.includes(maximizeWindowBridge) || !builtPreloadSource.includes("ipcRenderer.invoke('admin-window:maximize')") || !mainSource.includes("handleIpc('admin-window:maximize', (event) => {") || !mainSource.includes('event.sender === mainWindow.webContents') || !mainSource.includes('mainWindow.maximize()') || !builtMainSource.includes("handleIpc('admin-window:maximize'") || !builtMainSource.includes('mainWindow.maximize()')) {
  throw new Error('Authenticated workspace window maximize must use the native BrowserWindow maximize action through the typed Electron bridge.')
}

if (!preloadSource.includes("contextBridge.exposeInMainWorld('adminAuth'")) {
  throw new Error('The preload must expose the typed adminAuth bridge.')
}
if (preloadSource.includes("exposeInMainWorld('electron'") || preloadSource.includes("exposeInMainWorld('ipcRenderer'")) {
  throw new Error('The preload must not expose raw Electron objects.')
}
if (JSON.stringify(channels) !== JSON.stringify(['admin-auth:login', 'admin-auth:restore', 'admin-auth:renew', 'admin-auth:logout', 'admin-window:maximize', 'admin-products:create', 'admin-products:list', 'admin-products:list-admin-product-listings', 'admin-products:product-availability', 'admin-products:update-metadata', 'admin-products:list-product-images', 'admin-products:upload-image', 'admin-products:reorder-product-images', 'admin-products:update-product-image-alt-text', 'admin-products:delete-product-image', 'admin-products:set-feature', 'admin-products:upload-catalogue-artwork', 'admin-products:remove-catalogue-artwork', 'admin-products:lookup-lego-products', 'admin-products:create-used-offer', 'admin-categories:list', 'admin-categories:product-availability', 'admin-categories:create', 'admin-categories:update', 'admin-categories:upload-artwork', 'admin-categories:remove-artwork', 'admin-categories:upload-thumbnail-artwork', 'admin-categories:remove-thumbnail-artwork', 'admin-purchases:manual-supplier-options', 'admin-purchases:create-manual', 'admin-purchases:review', 'admin-purchases:amend', 'admin-purchases:resolve', 'admin-purchases:set-inventory-disposition', 'admin-purchases:receive', 'admin-purchases:search-products', 'admin-purchases:create-listing', 'admin-purchases:import-pdf', 'admin-purchases:list', 'admin-purchases:get', 'admin-purchases:analytics-summary', 'admin-purchases:supplier-monthly-analytics', 'admin-orders:list', 'admin-orders:get', 'admin-orders:preparing', 'admin-orders:dispatch', 'admin-orders:cancel', 'admin-inventory:list', 'admin-inventory:movements', 'admin-inventory:get-outbound', 'admin-inventory:pending', 'admin-inventory:prepare', 'admin-inventory:submit', 'admin-inventory:finish'])) {
  throw new Error(`Unexpected exposed IPC channels: ${channels.join(', ')}`)
}
if (!mainSource.includes('contextIsolation: true') || !mainSource.includes('nodeIntegration: false')) {
  throw new Error('Electron renderer security settings are not enabled.')
}
if (!mainSource.includes("webContents.on('context-menu'") || !mainSource.includes('handleEditContextMenu(event, { ...params.editFlags')) {
  throw new Error('Electron must limit the native edit context menu to editable targets.')
}
if (!editMenuSource.includes("role: 'cut'") || !editMenuSource.includes("role: 'copy'") || !editMenuSource.includes("role: 'paste'") || !editMenuSource.includes("role: 'selectAll'") || !editMenuSource.includes('if (!isEditable) return null')) {
  throw new Error('The edit context menu must contain only native editing actions and ignore non-editable targets.')
}
if (mainSource.includes('before-input-event') || preloadSource.includes('clipboard') || preloadSource.includes('contextMenu')) {
  throw new Error('Context-menu support must not intercept keyboard shortcuts or expose clipboard APIs.')
}
if (!mainSource.includes("preload: join(currentDirectory, 'preload.cjs')")) {
  throw new Error('Electron must load the CommonJS-compatible preload output.')
}

if (!preloadSource.includes("contextBridge.exposeInMainWorld('adminProducts'")) {
  throw new Error('The preload must expose the typed adminProducts bridge.')
}
if (!preloadSource.includes("contextBridge.exposeInMainWorld('adminPurchases'")) {
  throw new Error('The preload must expose the typed adminPurchases bridge.')
}
if (!builtPreloadSource.includes("exposeInMainWorld('adminPurchases'")) {
  throw new Error('The compiled preload must expose the adminPurchases bridge.')
}
if (!builtMainSource.includes("webContents.on('context-menu'") || !builtEditMenuSource.includes("role: 'selectAll'")) {
  throw new Error('The compiled Electron main process must include the native edit context menu.')
}
if (!builtPreloadSource.includes('admin-categories:create') || !builtMainSource.includes("handleIpc('admin-categories:create'")) {
  throw new Error('The compiled Electron boundary must expose category creation.')
}
const categoryThumbnailUploadBridge = "uploadThumbnailArtwork: (categoryId, image) => forwardIpcResult(ipcRenderer.invoke('admin-categories:upload-thumbnail-artwork', categoryId, image))"
const categoryThumbnailDeleteBridge = "removeThumbnailArtwork: (categoryId) => forwardIpcResult(ipcRenderer.invoke('admin-categories:remove-thumbnail-artwork', categoryId))"
for (const [bridge, channel] of [[categoryThumbnailUploadBridge, 'admin-categories:upload-thumbnail-artwork'], [categoryThumbnailDeleteBridge, 'admin-categories:remove-thumbnail-artwork']]) {
  if (!preloadSource.includes(bridge) || !builtPreloadSource.includes(channel) || !mainSource.includes(`handleIpc('${channel}'`) || !builtMainSource.includes(`handleIpc('${channel}'`)) {
    throw new Error(`The Electron boundary must expose and handle ${channel}.`)
  }
}
const categoryAvailabilityBridge = "getProductAvailability: (categoryId) => forwardIpcResult(ipcRenderer.invoke('admin-categories:product-availability', categoryId))"
if (!preloadSource.includes(categoryAvailabilityBridge) || !builtPreloadSource.includes("ipcRenderer.invoke('admin-categories:product-availability', categoryId)") || !mainSource.includes("handleIpc('admin-categories:product-availability', async (_event, categoryId: unknown) => categoryService.getProductAvailability(validateCategoryId(categoryId)))") || !builtMainSource.includes("handleIpc('admin-categories:product-availability'")) {
  throw new Error('Category availability must use the validated category service through the typed Electron bridge.')
}
const globalAvailabilityBridge = "getProductAvailability: () => forwardIpcResult(ipcRenderer.invoke('admin-products:product-availability'))"
if (!preloadSource.includes(globalAvailabilityBridge) || !builtPreloadSource.includes("ipcRenderer.invoke('admin-products:product-availability')") || !mainSource.includes("handleIpc('admin-products:product-availability', () => productService.getProductAvailability())") || !builtMainSource.includes("handleIpc('admin-products:product-availability'")) {
  throw new Error('Global product availability must use the ProductService through the typed Electron bridge.')
}
const purchaseHistoryBridge = "list: (page, pageSize, search) => forwardIpcResult(ipcRenderer.invoke('admin-purchases:list', page, pageSize, search))"
const purchaseHistoryHandler = "handleIpc('admin-purchases:list', async (_event, page: unknown, pageSize: unknown, search: unknown) => purchaseService.list(validatePage(page, 1), validatePageSize(pageSize, 6), validatePurchaseSearch(search)))"
if (!preloadSource.includes(purchaseHistoryBridge) || !builtPreloadSource.includes("ipcRenderer.invoke('admin-purchases:list', page, pageSize, search)")) {
  throw new Error('Purchase History must pass page, pageSize, and search through the typed preload bridge.')
}
if (!mainSource.includes(purchaseHistoryHandler) || !builtMainSource.includes("purchaseService.list(validatePage(page, 1), validatePageSize(pageSize, 6), validatePurchaseSearch(search))")) {
  throw new Error('Purchase History IPC must validate and forward page, pageSize, and search.')
}
for (const channel of ['admin-purchases:manual-supplier-options', 'admin-purchases:create-manual', 'admin-purchases:review', 'admin-purchases:amend', 'admin-purchases:resolve', 'admin-purchases:set-inventory-disposition', 'admin-purchases:receive', 'admin-purchases:search-products', 'admin-purchases:create-listing', 'admin-purchases:import-pdf', 'admin-purchases:list', 'admin-purchases:get', 'admin-purchases:analytics-summary', 'admin-purchases:supplier-monthly-analytics']) {
  if (!builtPreloadSource.includes(channel)) throw new Error('Compiled preload missing ' + channel)
  if (!builtMainSource.includes(`handleIpc('${channel}'`)) {
    throw new Error(`The compiled main process must register ${channel}.`)
  }
}
for (const channel of ['admin-products:list-admin-product-listings', 'admin-products:update-metadata', 'admin-products:lookup-lego-products', 'admin-products:create-used-offer']) {
  if (!preloadSource.includes(channel) || !mainSource.includes(`handleIpc('${channel}'`)) {
    throw new Error(`The source Electron boundary must register ${channel}.`)
  }
  if (!builtPreloadSource.includes(channel) || !builtMainSource.includes(`handleIpc('${channel}'`)) {
    throw new Error(`The compiled Electron boundary must register ${channel}.`)
  }
}
if (!mainSource.includes("'/admin/products?") || !mainSource.includes("'/products/${productId}/used-offers'")) {
  // Request URLs are deliberately constructed inside ProductService, behind the IPC boundary.
  const productServiceSource = readFileSync(resolve('electron', 'product-service.ts'), 'utf8')
  if (!productServiceSource.includes("/admin/products?") || !productServiceSource.includes("/used-offers`")) {
    throw new Error('The Used workflow must use the Admin product lookup and dedicated Used-offer service endpoints.')
  }
}
if (preloadSource.includes('readFile') || preloadSource.includes('readdir') || preloadSource.includes('writeFile')) {
  throw new Error('The preload must not expose filesystem access.')
}
const securitySource = readFileSync(resolve('electron', 'renderer-security.ts'), 'utf8')
const builtSecuritySource = readFileSync(resolve('dist-electron', 'renderer-security.js'), 'utf8')
if (!securitySource.includes('serializeIpcError') || !preloadSource.includes('forwardIpcResult') || !rendererApiSource.includes('restoreIpcError')) {
  throw new Error('Structured service errors must survive main IPC serialization, preload forwarding, and renderer restoration.')
}
if ((mainSource.match(/ipcMain\.handle\(/g) ?? []).length !== 1 || !mainSource.includes('ipcMain.handle(channel, secureIpcHandler(() => mainWindow, rendererUrl, handler))') || !builtMainSource.includes('secureIpcHandler(() => mainWindow, rendererUrl, handler)') || !builtSecuritySource.includes('assertTrustedSender(event, getWindow(), trusted)')) {
  throw new Error('Every privileged handler must validate the trusted window and main frame before executing.')
}
for (const event of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
  if (!builtSecuritySource.includes(`'${event}'`)) throw new Error(`Missing compiled navigation guard: ${event}`)
}
const builtHtml = readFileSync(resolve('dist', 'index.html'), 'utf8').replaceAll('&apos;', "'").replaceAll('&#39;', "'")
if (!builtHtml.includes('Content-Security-Policy') || !builtHtml.includes("script-src 'self'") || builtHtml.includes('unsafe-inline') || builtHtml.includes('unsafe-eval') || !builtHtml.includes('https://res.cloudinary.com')) {
  throw new Error('Packaged renderer must have a restrictive CSP with Cloudinary image support.')
}

console.log('Verified the narrow Electron authentication boundary.')

const orderIpcSource = readFileSync(resolve('dist-electron', 'order-ipc.js'), 'utf8')
const orderServiceSource = readFileSync(resolve('dist-electron', 'order-service.js'), 'utf8')
if (!builtPreloadSource.includes("exposeInMainWorld('adminOrders'") || !builtMainSource.includes('registerOrderIpc(handleIpc, new OrderService(authService))')) {
  throw new Error('The compiled order bridge must use the authenticated order service.')
}
for (const operation of ['list', 'get', 'preparing', 'dispatch', 'cancel']) {
  if (!builtPreloadSource.includes(`admin-orders:${operation}`) || !orderIpcSource.includes(`admin-orders:${operation}`)) {
    throw new Error(`Missing compiled order IPC operation: ${operation}`)
  }
}
if (!orderServiceSource.includes('/fulfilment/dispatch') || !orderServiceSource.includes('/seller-cancel')) {
  throw new Error('The compiled order service must use the supported fulfilment and seller cancellation APIs.')
}

const inventoryIpc = readFileSync(resolve('electron', 'inventory-ipc.ts'), 'utf8')
for (const channel of ['list', 'movements', 'get-outbound', 'pending', 'prepare', 'submit', 'finish']) {
  if (!inventoryIpc.includes(`handle('admin-inventory:${channel}'`) || !builtPreloadSource.includes(`admin-inventory:${channel}`)) throw new Error('Missing inventory boundary: ' + channel)
}
if (!mainSource.includes('registerInventoryIpc(handleIpc,')) throw new Error('Inventory IPC must use the trusted-sender wrapper')
