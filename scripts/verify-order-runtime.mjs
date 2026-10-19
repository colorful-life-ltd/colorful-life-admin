// Compiled Electron main/preload and production renderer against a disposable HTTP fixture.
import { app } from 'electron'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

async function run() {
  const root = resolve(import.meta.dirname, '..')
  app.setAppPath(root)
  const folder = mkdtempSync(join(tmpdir(), 'colorful-life-order-runtime-'))
  app.setPath('userData', join(folder, 'profile'))
  const requests = []
  let securityReview = true
  let financialMode = 'empty'
  let cancellationLost = false
  const cancellationId = '9007199254740993'
  const timestamp = '2026-10-13T10:00:00Z'
  const order = {
    id: 41, user: { id: 2, firstName: 'Sam', lastName: 'Buyer', email: 'buyer@test.invalid' },
    status: 'CONFIRMED', totalAmount: '25', currency: 'GBP', createdAt: timestamp,
    payment: { status: 'SUCCEEDED', currency: 'GBP', paidAt: timestamp }, paymentStatus: 'SUCCEEDED',
    fulfilmentStage: 'CONFIRMED', preparingAt: null, dispatchedAt: null, shippingCarrier: null, trackingNumber: null,
    cancelledAt: null, actualShippingCost: null,
    deliveryRecipientName: 'Sam Buyer', deliveryLine1: '1 Test Street', deliveryLine2: null,
    deliveryCity: 'London', deliveryCounty: null, deliveryPostcode: 'E1 1AA', deliveryCountryCode: 'GB', deliveryPhone: null,
    orderItems: [{ id: 3, quantity: 2, unitPrice: '12.5', lineTotal: '25', productListing: { id: 4, condition: 'NEW', legoProduct: { id: 5, setNumber: '12345', title: 'Runtime LEGO set' } } }],
    fulfilment: { stage: 'CONFIRMED', preparingAt: null, dispatchedAt: null, shipments: [] }, fulfilmentEvents: [],
  }
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const bodyText = Buffer.concat(chunks).toString()
    const body = bodyText ? JSON.parse(bodyText) : undefined
    requests.push({ path: req.url, method: req.method, auth: req.headers.authorization, key: req.headers['idempotency-key'], body })
    let data
    if (req.url === '/auth/login') data = { token: 'order-runtime-token', accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(), refreshToken: 'order-runtime-refresh', refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() }
    else if (req.url === '/orders/41/payments') data = [{ id: 7, orderId: 41, amount: '25', currency: 'GBP', provider: 'STRIPE', status: 'SUCCEEDED', paidAt: timestamp, refundedAmount: financialMode === 'full' ? '25' : '0', reservedRefundAmount: '0', providerReference: 'DO_NOT_EXPOSE', idempotencyKey: 'DO_NOT_EXPOSE' }]
    else if (req.url === '/orders/41/refunds') {
      if (financialMode === 'failure') { res.statusCode = 503; data = { error: 'Unavailable' } }
      else data = financialMode === 'full' ? [{ id: 8, orderId: 41, paymentId: 7, amount: '25', currency: 'GBP', provider: 'STRIPE', status: 'SUCCEEDED', createdAt: timestamp, reason: 'Fixture refund', performedByUserId: 1, resolutionCode: 'REFUND_SUCCEEDED', reviewRequired: false, providerReference: 'DO_NOT_EXPOSE', providerOutcome: { secret: 'DO_NOT_EXPOSE' } }] : []
    }
    else if (req.url === '/profile') data = { id: 1, email: 'admin@test.invalid', role: 'ADMIN', createdAt: timestamp, updatedAt: timestamp }
    else if (req.url.startsWith('/products?')) data = { items: [], pagination: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 } }
    else if (req.url === '/admin/categories') data = []
    else if (req.url === '/admin/products/product-availability') data = { totalProducts: 0, totalInventory: 0, activeProducts: 0, inactiveProducts: 0 }
    else if (req.url.startsWith('/admin/orders?')) data = { items: [order], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } }
    else if (req.url === '/admin/orders/41') data = order
    else if (req.url === '/admin/orders/41/audit') data = [{id:cancellationId,kind:'PAID_CANCELLATION_REQUESTED',actorId:1,details:{reason:'Runtime exact generation cancellation'},createdAt:timestamp}]
    else if (req.url === '/admin/orders/41/fulfilment/eligibility') data = {eligible:false,reason:'CANCELLATION_PENDING'}
    else if (req.url === '/admin/orders/41/request-paid-cancellation') {
      assert.equal(req.method,'POST'); assert.equal(body.reason,'Runtime exact generation cancellation')
      if (!cancellationLost) {cancellationLost=true;res.destroy();return}
      data={requested:true,replayed:true,requestId:cancellationId,active:true}
    }
    else if (req.url === '/admin/orders/41/withdraw-paid-cancellation') {
      assert.equal(typeof body.requestId,'string'); assert.equal(body.requestId,cancellationId)
      data={withdrawn:true,replayed:false,requestId:cancellationId}
    }
    else if (req.url === '/admin/orders/41/fulfilment/preparing') {
      assert.deepEqual(body, {})
      order.preparingAt = timestamp; order.fulfilmentStage = 'PREPARING'; order.fulfilment.stage = 'PREPARING'; order.fulfilment.preparingAt = timestamp
      data = order
    } else if (req.url === '/admin/orders/41/fulfilment/dispatch') {
      assert.deepEqual(body, { carrier: 'ROYAL_MAIL', trackingNumber: 'AB123456789GB', actualShippingCost: 3.5 })
      if (securityReview) {
        res.statusCode = 409
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: { code: 'ORDER_PAYMENT_NOT_VERIFIED', message: 'Order 41 payment is not verified for fulfilment (SECURITY_REVIEW_REQUIRED)' } }))
        return
      }
      order.status = 'DISPATCHED'; order.fulfilmentStage = 'DISPATCHED'; order.fulfilment.stage = 'DISPATCHED'; order.dispatchedAt = timestamp
      order.fulfilment.shipments = [{ sequence: 1, carrier: 'ROYAL_MAIL', carrierName: 'Royal Mail', trackingNumber: body.trackingNumber, dispatchedAt: timestamp, trackingUrl: 'https://www.royalmail.com/track-your-item#/tracking-results/AB123456789GB', trackingUrlIncludesNumber: true }]
      data = order
    } else { res.statusCode = 404; data = { error: 'Unexpected fixture request' } }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.COLORFUL_LIFE_BACKEND_URL = 'http://127.0.0.1:' + server.address().port
  process.env.ELECTRON_RENDERER_URL = pathToFileURL(join(root, 'dist/index.html')).href
  let window
  const ready = new Promise(resolve => app.once('browser-window-created', (_event, win) => { window = win; win.hide(); win.webContents.once('did-finish-load', resolve) }))
  const timeout = setTimeout(() => { console.error('Order runtime timed out'); app.exit(1) }, 45000)
  try {
    await import(pathToFileURL(join(root, 'dist-electron/main.js')).href)
    await ready
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
      const expression = `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled)`
      await until(expression)
      await js(`(${expression}).click()`)
    }
    const fill = async (id, value) => js(`(() => { const input = document.getElementById(${JSON.stringify(id)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', {bubbles:true})); })()`)
    assert.equal(await js('typeof window.require'), 'undefined')
    assert.equal(requests.some(r => r.path.startsWith('/admin/orders')), false)
    await until("!!document.getElementById('email')")
    await fill('email', 'admin@test.invalid'); await fill('password', 'test')
    await js("document.querySelector('form').requestSubmit()")
    await click('Orders'); await click('View order #41')
    await until("document.body.textContent.includes('Runtime LEGO set')")
    await until("document.body.textContent.includes('£25.00 GBP')")
    assert.equal((await js('(async () => JSON.stringify(await window.adminOrders.financials(41)))()')).includes('DO_NOT_EXPOSE'), false)
    financialMode = 'full'
    await click('Refresh order')
    await until("document.body.textContent.includes('Fully refunded payment.')")
    assert.equal(await js("[...document.querySelectorAll('button')].find(b => b.textContent === 'Confirm Shipment').disabled"), true)
    assert.equal((await js('(async () => JSON.stringify(await window.adminOrders.financials(41)))()')).includes('DO_NOT_EXPOSE'), false)
    financialMode = 'failure'
    await click('Refresh order')
    await until("document.body.textContent.includes('Refund history could not be read.')")
    assert.equal(await js("document.body.textContent.includes('No refund history recorded in this read.')"), false)
    financialMode = 'empty'
    await click('Refresh order')
    await until("document.body.textContent.includes('No refund history recorded in this read.')")
    assert(requests.filter(r => /^\/orders\/41\/(payments|refunds)$/.test(r.path)).every(r => r.method === 'GET' && r.auth === 'Bearer order-runtime-token'))
    // Lost-response recovery across the compiled IPC boundary retains the exact
    // intent and key. Large cancellation generations never become JS numbers.
    const cancellationInput = {orderId:41,reason:'Runtime exact generation cancellation'}
    const lost = await js(`window.adminOperations.execute('requestCancellation',${JSON.stringify(cancellationInput)})`)
    assert.ok(lost.__colorfulLifeAdminIpcError)
    assert.equal((await js('window.adminOperations.pending()')).state,'uncertain')
    const retry = await js(`window.adminOperations.execute('requestCancellation',${JSON.stringify(cancellationInput)})`)
    assert.equal(retry.requestId,cancellationId)
    const attempts=requests.filter(r=>r.path.endsWith('/request-paid-cancellation'))
    assert.equal(attempts.length,2);assert.equal(attempts[0].key,attempts[1].key);assert.deepEqual(attempts[0].body,attempts[1].body)
    await click('Operator workflows')
    await until("document.body.textContent.includes('Saved Request paid cancellation: confirmed')")
    await click('Finish saved action')
    await until("!document.body.textContent.includes('Saved Request paid cancellation: confirmed')")
    const withdrawn = await js(`window.adminOperations.execute('withdrawCancellation',${JSON.stringify({orderId:41,requestId:cancellationId,reason:'Runtime reasoned withdrawal before refund'})})`)
    assert.equal(withdrawn.requestId,cancellationId);assert.equal(withdrawn.withdrawn,true)
    await js('window.adminOperations.finish()')
    await click('Orders');await click('View order #41')
    await until("document.body.textContent.includes('Runtime LEGO set')")
    await click('Mark as Preparing')
    assert.equal(await js("document.querySelector('dialog').matches(':modal')"), true)
    assert.equal(requests.some(r => r.path.endsWith('/preparing')), false)
    await click('Confirm')
    await until("document.body.textContent.includes('Order marked as Preparing.')")
    await click('Confirm Shipment')
    await until("document.querySelector('dialog').matches(':modal') && !!document.getElementById('order-tracking')")
    await fill('order-tracking', 'ab 123456789 gb'); await fill('order-cost', '3.5')
    await click('Confirm')
    await until("document.querySelector('[role=alert]')?.textContent.includes('Dispatch is blocked by a payment security review') && !document.querySelector('dialog').open")
    assert.equal(requests.filter(r => r.path.endsWith('/fulfilment/dispatch')).length, 1)
    assert.equal(order.status, 'CONFIRMED')
    assert.equal(order.fulfilment.shipments.length, 0)
    assert.equal(await js("[...document.querySelectorAll('button')].some(b => /release/i.test(b.textContent))"), false)
    // Only the fixture simulates a separately resolved review; Admin has no release operation.
    securityReview = false
    await click('Confirm Shipment')
    await fill('order-tracking', 'ab 123456789 gb'); await fill('order-cost', '3.5')
    await click('Confirm')
    await until("document.body.textContent.includes('Track shipment 1')")
    assert.equal(await js("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Cancel Order')"), false)
    assert.equal(requests.filter(r => r.path.endsWith('/fulfilment/dispatch')).length, 2)
    assert(requests.filter(r => r.path.startsWith('/admin/orders')).every(r => r.auth === 'Bearer order-runtime-token'))
    writeFileSync(join(folder, 'order-detail.png'), (await window.webContents.capturePage()).toPNG())
    console.log('Verified exact-generation cancellation/withdrawal and durable identical-key lost-response replay, whitelisted read-only financial IPC, exact major-unit amounts, fully-refunded dispatch blocking, failed history recovery, authenticated order IPC, native confirmation dialogs, security-review rejection without retry, Preparing and trusted-carrier Dispatch in compiled Electron.')
    console.log('Runtime screenshot: ' + join(folder, 'order-detail.png'))
    clearTimeout(timeout); server.close(); app.exit(0)
  } catch (error) { console.error(error); clearTimeout(timeout); server.close(); app.exit(1) }
}
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1) })
