// Real Electron + compiled main/preload + production renderer. Only HTTP is a disposable fixture server.
import { app } from 'electron'
app.disableHardwareAcceleration()
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

async function run() {
const root = resolve(import.meta.dirname, '..')
  app.setAppPath(root)
const review = JSON.parse(readFileSync(join(root, 'src/test-fixtures/purchase-review.json'), 'utf8'))
const requests = []
let failReview = false
const server = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString()
  const body = text ? JSON.parse(text) : undefined
  requests.push({ path: req.url, method: req.method, body, auth: req.headers.authorization })
  let data
  if (req.url === '/auth/login') data = {
    token: 'disposable-runtime-token',
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    refreshToken: 'disposable-runtime-refresh-token',
    refreshExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }
  else if (req.url === '/profile') data = { id: 1, email: 'runtime@test.invalid', role: 'ADMIN', createdAt: '2026-09-21', updatedAt: '2026-09-21' }
  else if (req.url.startsWith('/products?')) data = { items: [], pagination: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 } }
  else if (req.url === '/admin/products/product-availability') data = { totalProducts: 17, totalInventory: 143, activeProducts: 12, inactiveProducts: 5 }
  else if (req.url === '/admin/categories') data = []
  else if (req.url === '/admin/categories/9/product-availability') data = { totalProducts: 3, totalInventory: 9, activeProducts: 2, inactiveProducts: 1 }
  else if (req.url === '/purchases/manual-supplier-options') data = { canonicalSuppliers: ['LEGO', 'Amazon', 'eBay', 'B&M', "Sainsbury's"], customSupplierOption: 'Others' }
  else if (req.url.startsWith('/purchases?')) data = { purchases: [review.purchase], pagination: { page: 1, pageSize: 6, totalItems: 1, totalPages: 1, limit: 6, total: 1 } }
  else if (req.url === '/purchases/1/review' && failReview) { res.statusCode = 500; data = { error: 'Unavailable' } }
  else if (req.url === '/purchases/1/review/products?q=model') data = [{ id: 1, title: 'Display model', setNumber: '75446' }]
  else if (req.url.endsWith('/listing')) { review.revision = 'b'.repeat(64); data = review }
  else if (req.url.endsWith('/items/101')) { review.revision = 'c'.repeat(64); data = review }
  else if (req.url.endsWith('/receive')) {
    assert.deepEqual(Object.keys(body), ['revision'])
    review.revision = 'd'.repeat(64)
    review.groups[0].state = 'RECEIVED'; review.groups[0].canResolve = false; review.groups[0].pendingQuantity = 0
    for (const line of review.groups[0].lines) { line.receivedAt = '2026-09-22'; line.canAmend = false; line.canAmendCost = false }
    data = review
  } else if (req.url === '/purchases/1/review') data = review
  else { res.statusCode = 404; data = { error: 'Unexpected test request' } }
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const folder = mkdtempSync(join(tmpdir(), 'colorful-life-purchase-runtime-'))
app.setPath('userData', join(folder, 'profile'))
process.env.COLORFUL_LIFE_BACKEND_URL = 'http://127.0.0.1:' + server.address().port
process.env.ELECTRON_RENDERER_URL = pathToFileURL(join(root, 'dist/index.html')).href
let window
const ready = new Promise(resolve => app.once('browser-window-created', (_event, win) => {
  window = win; win.show()
  win.webContents.on('preload-error', (_event, path, error) => console.error('Preload failed', path, error))
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error('Renderer:', event.message) })
  win.webContents.once('did-finish-load', resolve)
}))
const timeout = setTimeout(() => { console.error('Electron runtime check timed out'); app.exit(1) }, 45000)
try {
  await import(pathToFileURL(join(root, 'dist-electron/main.js')).href)
  await ready
  assert.equal(window.isMaximized(), false, 'The unauthenticated startup window must remain compact.')
  const js = async expression => {
    try { return await window.webContents.executeJavaScript(expression) }
    catch (error) { console.error('Failed runtime expression:', expression); throw error }
  }
  const until = async expression => {
    for (let n = 0; n < 100; n++) {
      if (await js(expression)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('Runtime condition failed: ' + expression)
  }
  const click = async label => {
    await until(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled)`)
    return js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`)
  }
  assert.equal(window.webContents.getLastWebPreferences().contextIsolation, true)
  assert.equal(window.webContents.getLastWebPreferences().nodeIntegration, false)
  assert.deepEqual(await js(`['getManualSupplierOptions','review','amend','resolve','receive','searchProducts','createListing'].map(k => typeof window.adminPurchases[k])`), Array(7).fill('function'))
  assert.equal(await js("typeof window.require"), 'undefined')
  await until("!!document.querySelector('#email')")
  await js(`for (const [id,value] of [['email','runtime@test.invalid'],['password','test']]) {
    const input = document.getElementById(id)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input,value)
    input.dispatchEvent(new Event('input',{bubbles:true}))
  }`)
  await js("document.querySelector('form').requestSubmit()")
  await until("document.body.textContent.includes('Admin workspace')")
  for (let n = 0; n < 100 && !window.isMaximized(); n++) await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(window.isMaximized(), true, 'Authenticated workspace must maximize its native BrowserWindow.')
  assert.equal(window.isFullScreen(), false, 'Authenticated workspace must use normal window maximization, not fullscreen.')
  window.unmaximize()
  await click('Purchases')
  await until("document.body.textContent.includes('ORDER-1')")
  await click('View details')
  await until("document.body.textContent.includes('Approve & Receive 3')")
  assert.equal(await js("document.querySelectorAll('article').length"), 1)
  assert(await js("document.body.textContent.includes('£209.97')"))
  for (const width of [1200, 480]) {
    window.setSize(width, 1000)
    await new Promise(resolve => setTimeout(resolve, 150))
    const geometry = await js("({width:innerWidth,scroll:document.documentElement.scrollWidth})")
    assert(geometry.scroll <= geometry.width + 1, 'Review must not overflow horizontally')
    writeFileSync(join(folder, 'review-' + width + '.png'), (await window.webContents.capturePage()).toPNG())
  }
  await click('Amend')
  await until("document.body.textContent.includes('Save source line')")
  await js("document.querySelector('.review-line-form').requestSubmit()")
  await until("document.body.textContent.includes('Source line amended')")
  await click('Change Listing')
  await until("document.body.textContent.includes('Link selected listing')")
  await click('Link selected listing')
  await until("document.body.textContent.includes('Listing association saved')")
  await js("void (window.confirm = () => true)")
  await click('Approve & Receive 3')
  await until("document.body.textContent.includes('Purchase item received into inventory')")
  assert.equal(await js("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Approve & Receive'))"), false)
  failReview = true
  await click('Refresh review')
  await until("!!document.querySelector('[role=alert]')")
  failReview = false
  await click('Refresh review')
  await until("document.body.textContent.includes('Review refreshed.')")
  await click('← Purchase History')
  await until("document.body.textContent.includes('Import Purchase Document')")
  const spacing = await js(`(() => {
    const h = document.querySelector('.purchase-import-card h3').getBoundingClientRect()
    const p = document.querySelector('.purchase-import-card .panel-intro').getBoundingClientRect()
    return p.top - h.bottom
  })()`)
  assert(spacing >= 7)
  await js("window.adminCategories.list()")
  assert.deepEqual(await js("window.adminCategories.getProductAvailability(9)"), { totalProducts: 3, totalInventory: 9, activeProducts: 2, inactiveProducts: 1 })
  assert.deepEqual(await js("window.adminProducts.getProductAvailability()"), { totalProducts: 17, totalInventory: 143, activeProducts: 12, inactiveProducts: 5 })
  await js("window.adminProducts.listProducts()")
  await js("window.adminPurchases.searchProducts(1,'model')")
  assert.deepEqual(await js('window.adminPurchases.getManualSupplierOptions()'), {
    canonicalSuppliers: ['LEGO', 'Amazon', 'eBay', 'B&M', "Sainsbury's"], customSupplierOption: 'Others',
  })
  await click('Add Purchase')
  await until(`!![...document.querySelectorAll('#manual-purchase-supplier option')].some(option => option.value === "Sainsbury's")`)
  const selectSupplier = async value => js(`(() => { const select = document.querySelector('#manual-purchase-supplier'); select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  await selectSupplier('Others')
  await until("!!document.querySelector('#manual-purchase-custom-supplier')")
  await js("(() => { const input = document.querySelector('#manual-purchase-custom-supplier'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Local Toy Shop'); input.dispatchEvent(new Event('input',{bubbles:true})); })()")
  window.setSize(1200, 1000)
  await new Promise(resolve => setTimeout(resolve, 150))
  writeFileSync(join(folder, 'manual-purchase-custom-1200.png'), (await window.webContents.capturePage()).toPNG())
  window.setSize(480, 1000)
  await new Promise(resolve => setTimeout(resolve, 150))
  const geometry = await js("({width:innerWidth,scroll:document.documentElement.scrollWidth})")
  assert(geometry.scroll <= geometry.width + 1, 'Add Purchase supplier selector must not overflow horizontally')
  writeFileSync(join(folder, 'manual-purchase-custom-480.png'), (await window.webContents.capturePage()).toPNG())
  await selectSupplier('LEGO')
  assert.equal(await js("!!document.querySelector('#manual-purchase-custom-supplier')"), false)
  assert(requests.filter(r => r.path.startsWith('/purchases/1/review')).every(r => r.auth === 'Bearer disposable-runtime-token'))
  assert(requests.some(r => r.path === '/purchases/manual-supplier-options' && r.auth === 'Bearer disposable-runtime-token'))
  assert(requests.some(r => r.path === '/admin/categories/9/product-availability' && r.auth === 'Bearer disposable-runtime-token'))
  assert(requests.some(r => r.path === '/admin/products/product-availability' && r.auth === 'Bearer disposable-runtime-token'))
  assert(requests.some(r => r.path.endsWith('/receive')))
  console.log('Verified authenticated BrowserWindow maximize, compiled Electron review workflows, existing bridges, and responsive Add Purchase layout.')
  console.log('Runtime screenshots: ' + folder)
  clearTimeout(timeout)
  server.close()
  app.exit(0)
} catch (error) {
  console.error(error)
  clearTimeout(timeout)
  server.close()
  app.exit(1)
}
}
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1) })
