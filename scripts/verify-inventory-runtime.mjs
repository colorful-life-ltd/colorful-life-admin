// No Backend/database. Compile-time bridges and actual Chromium UI use this disposable HTTP fixture only.
import { app } from 'electron'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

async function run() {
  const root = resolve(import.meta.dirname, '..'), folder = mkdtempSync(join(tmpdir(), 'colorful-life-inventory-runtime-'))
  app.setAppPath(root); app.setPath('userData', folder)
  const timestamp = '2026-10-18T12:00:00Z', posts = []
  let currentStock = 10, recorded = null, deductions = 0
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString(), body = raw ? JSON.parse(raw) : null
    let data
    if (req.url === '/auth/login') data = { token: 'inventory-fixture-token', accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(), refreshToken: 'inventory-fixture-refresh', refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() }
    else if (req.url === '/profile') data = { id: 1, email: 'admin@test.invalid', role: 'ADMIN', createdAt: timestamp, updatedAt: timestamp }
    else if (req.url.startsWith('/products?')) data = { items: [], pagination: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 } }
    else if (req.url === '/admin/categories') data = []
    else if (req.url === '/admin/products/product-availability') data = { totalProducts: 1, totalInventory: currentStock, activeProducts: 1, inactiveProducts: 0 }
    else if (req.url.startsWith('/admin/product-listings?')) data = { items: [{ id: 4, condition: 'NEW', active: true, currentStock, availableStock: currentStock - 3, legoProduct: { id: 2, setNumber: '12345', title: 'Runtime inventory car' } }], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } }
    else if (req.url === '/products/4/inventory-movements') data = { listingId: 4, movements: recorded ? [{ ...recorded.outbound.movement, fbaOutbound: { id: 9, shipmentReference: recorded.outbound.shipmentReference, idempotencyKey: recorded.outbound.idempotencyKey } }] : [] }
    else if (req.url === '/inventory/fba-outbounds' && req.method === 'POST') {
      assert.equal(req.headers.authorization, 'Bearer inventory-fixture-token')
      posts.push(body)
      if (!recorded) {
        currentStock -= body.quantity; deductions++
        recorded = { outbound: { ...body, appliedQuantity: body.quantity, shortfall: 0, id: 9, performedByUserId: 1, createdAt: timestamp, movement: { id: 8, listingId: 4, type: 'FBA_OUTBOUND', quantityChange: -body.quantity, note: body.note, performedByUserId: 1, createdAt: timestamp } }, inventory: { productListingId: 4, currentStock, reservedStock: 3, availableStock: currentStock - 3 } }
        // Commit succeeded, response was lost. The next submission must replay this exact key/payload.
        req.socket.destroy(); return
      }
      assert.deepEqual(body, posts[0]); data = { ...recorded, replayed: true }
    } else if (req.url === '/inventory/fba-outbounds/9') data = recorded
    else { res.statusCode = 404; data = { error: 'Unexpected fixture request' } }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  process.env.COLORFUL_LIFE_BACKEND_URL = 'http://127.0.0.1:' + server.address().port
  process.env.ELECTRON_RENDERER_URL = pathToFileURL(join(root, 'dist/index.html')).href
  let window
  const ready = new Promise(r => app.once('browser-window-created', (_event, win) => { window = win; win.hide(); win.webContents.once('did-finish-load', r) }))
  const timeout = setTimeout(() => { console.error('Inventory runtime timed out'); app.exit(1) }, 45000)
  try {
    await import(pathToFileURL(join(root, 'dist-electron/main.js')).href); await ready
    const js = expression => window.webContents.executeJavaScript(expression)
    const until = async expression => { for (let i = 0; i < 150; i++) { if (await js(expression)) return; await new Promise(r => setTimeout(r, 30)) } throw new Error('Runtime condition failed: ' + expression) }
    const click = async label => { const query = `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled)`; await until(query); await js(`(${query}).click()`) }
    const fill = async (selector, value, tag = 'HTMLInputElement') => js(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(${tag}.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', {bubbles:true})); })()`)
    await until("!!document.querySelector('#email')")
    await fill('#email', 'admin@test.invalid'); await fill('#password', 'test')
    await js("document.querySelector('form').requestSubmit()")
    await click('Inventory'); await click('View listing #4')
    await until("document.body.textContent.includes('No recorded movements')")
    assert.equal(await js("document.body.textContent.includes('not a physical shelf count')"), true)
    await fill('.inventory-outbound input[type=number]', '2')
    await fill('.inventory-outbound input:not([type=number])', 'FBA-RUNTIME-1')
    await fill('.inventory-outbound textarea', 'Fixture shipment', 'HTMLTextAreaElement')
    await js("document.querySelector('.inventory-outbound form').requestSubmit(); document.querySelector('.inventory-outbound form').requestSubmit()")
    await until("document.body.textContent.includes('Shipment outcome is not confirmed')")
    assert.equal(posts.length, 1); assert.equal(deductions, 1); assert.equal(app.hasSingleInstanceLock(), true)
    const journalDirectory = join(folder, 'inventory-shipments')
    const journal = JSON.parse(readFileSync(join(journalDirectory, readdirSync(journalDirectory).find(f => f.endsWith('.json'))), 'utf8'))
    assert.equal(journal.state, 'uncertain'); assert.deepEqual(journal.request, posts[0])
    await click('Products'); await click('Inventory')
    await until("document.body.textContent.includes('Outcome is uncertain')")
    await click('Retry saved shipment')
    await until("document.body.textContent.includes('No additional stock was deducted') && document.body.textContent.includes('FBA OUTBOUND')")
    assert.equal(posts.length, 2); assert.deepEqual(posts[0], posts[1]); assert.equal(deductions, 1); assert.equal(currentStock, 8)
    assert.equal(await js("(async () => (await window.adminInventory.getOutbound(9)).outbound.shipmentReference)()"), 'FBA-RUNTIME-1')
    assert.equal(await js('typeof window.require'), 'undefined')
    assert.equal(await js('localStorage.length + sessionStorage.length'), 0)
    writeFileSync(join(folder, 'inventory.png'), (await window.webContents.capturePage()).toPNG())
    console.log('Verified inventory Main/preload/UI, reserved quantities, ledger metadata, duplicate clicks, durable lost-response recovery across navigation, identical-key replay and exactly one fixture deduction.')
    console.log('Runtime screenshot: ' + join(folder, 'inventory.png'))
    clearTimeout(timeout); server.close(); app.exit(0)
  } catch (error) { console.error(error); if (window) console.error(await window.webContents.executeJavaScript('document.body.innerText')); clearTimeout(timeout); server.close(); app.exit(1) }
}
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1) })
