// No real Backend/database: exercise compiled Main/preload in Chromium with local fixtures.
import { app, BrowserWindow, ipcMain, shell } from 'electron'
app.disableHardwareAcceleration()
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

async function run() {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'colorful-life-security-runtime-')))
  const development = process.env.SECURITY_RUNTIME_DEVELOPMENT === '1'
  const root = resolve(import.meta.dirname, '..')
  app.setAppPath(root)
  const handlers = new Map()
  const register = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, handler) => { handlers.set(channel, handler); register(channel, handler) }
  const external = []
  shell.openExternal = async url => { external.push(url) }
  let requests = 0
  let redirected = 0
  const server = createServer((req, res) => {
    requests++
    if (req.url === '/auth/login') { res.writeHead(307, { Location: '/redirected' }); res.end(); return }
    if (req.url === '/redirected') redirected++
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Fixture only' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.COLORFUL_LIFE_BACKEND_URL = `http://127.0.0.1:${server.address().port}`
  if (development) process.env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173'
  else delete process.env.ELECTRON_RENDERER_URL
  const timeout = setTimeout(() => { console.error('Security runtime timed out'); app.exit(1) }, 45000)
  let window
  const consoleMessages = []
  const ready = new Promise(resolve => app.once('browser-window-created', (_event, win) => {
    window = win; win.show(); win.webContents.on('console-message', details => consoleMessages.push(details.message)); win.webContents.once('did-finish-load', resolve)
  }))
  try {
    await import(pathToFileURL(join(root, 'dist-electron/main.js')).href)
    await ready
    const js = source => window.webContents.executeJavaScript(source)
    const until = async source => {
      for (let n = 0; n < 150; n++) {
        if (await js(source)) return
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      throw new Error('Runtime condition failed: ' + source)
    }
    await until("!!document.querySelector('#email')")
    if (development) assert(consoleMessages.some(message => message.includes('[vite] connected.')), 'Vite HMR websocket must connect under the development CSP')
    const trusted = window.webContents.getURL()
    assert.equal(await js('typeof window.require'), 'undefined')
    assert.equal(await js('typeof window.process'), 'undefined')
    assert.equal(await js("Object.keys(localStorage).length + Object.keys(sessionStorage).length"), 0)

    // Enumerate the actual registration set, including auth and maximize, before argument parsing.
    const expectedChannels = [...readFileSync(join(root, 'electron/preload.cts'), 'utf8').matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(match => match[1])
    assert.deepEqual([...handlers.keys()].sort(), expectedChannels.sort())
    for (const [channel, handler] of handlers) {
      for (const event of [
        { sender: window.webContents, senderFrame: null },
        { sender: window.webContents, senderFrame: { url: trusted } },
        { sender: { getURL: () => trusted }, senderFrame: window.webContents.mainFrame },
      ]) {
        const result = await handler(event)
        assert.equal(result.__colorfulLifeAdminIpcError.backendCode, 'FORBIDDEN', channel)
        assert.equal(result.__colorfulLifeAdminIpcError.status, 403, channel)
      }
    }
    assert.equal(requests, 0)
    // A real second BrowserWindow with the same preload and entry document still has no authority.
    const impostor = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: join(root, 'dist-electron/preload.cjs') } })
    await impostor.loadURL(trusted)
    const denied = await impostor.webContents.executeJavaScript('window.adminAuth.restore()')
    assert.equal(denied.__colorfulLifeAdminIpcError.backendCode, 'FORBIDDEN')
    impostor.destroy()
    assert.equal(await js('window.adminAuth.restore()'), null)

    // Prove the effective policy blocks inline/remote scripts, frames and renderer fetches.
    await js(`(() => {
      window.securityViolations = [];
      document.addEventListener('securitypolicyviolation', e => window.securityViolations.push(e.effectiveDirective));
      const inline = document.createElement('script'); inline.textContent = 'window.inlineAttack = true'; document.head.append(inline);
      const remote = document.createElement('script'); remote.src = ${JSON.stringify(process.env.COLORFUL_LIFE_BACKEND_URL + '/evil.js')}; document.head.append(remote);
      const frame = document.createElement('iframe'); frame.src = ${JSON.stringify(process.env.COLORFUL_LIFE_BACKEND_URL + '/evil-frame')}; document.body.append(frame);
      void fetch(${JSON.stringify(process.env.COLORFUL_LIFE_BACKEND_URL + '/renderer-leak')}).catch(() => {});
    })()`)
    await until("window.securityViolations.includes('script-src-elem') && window.securityViolations.includes('frame-src') && window.securityViolations.includes('connect-src')")
    assert.equal(await js('window.inlineAttack'), undefined)
    assert.equal(requests, 0)
    // Product previews must remain usable under the policy; no remote service required.
    assert.equal(await js(`new Promise(resolve => { const img = new Image(); img.onload = () => resolve(true); img.onerror = () => resolve(false); img.src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'], {type:'image/svg+xml'})); })`), true)
    assert((await js("document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]').content")).includes('https://res.cloudinary.com'))
    let cloudinaryAllowed = false
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['https://res.cloudinary.com/*'] }, (_details, done) => { cloudinaryAllowed = true; done({ cancel: true }) })
    await js("const cloudinary = new Image(); cloudinary.src = 'https://res.cloudinary.com/admin41-test/image/upload/fixture.png'; void 0")
    for (let n = 0; n < 100 && !cloudinaryAllowed; n++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(cloudinaryAllowed, true, 'CSP must allow Cloudinary requests before the test intercepts them')
    window.webContents.session.webRequest.onBeforeRequest(null)

    for (const target of [process.env.COLORFUL_LIFE_BACKEND_URL + '/navigation', 'file:///tmp/untrusted-dropped.html', 'data:text/html,untrusted']) {
      const blocked = new Promise(resolve => window.webContents.once('will-navigate', () => resolve()))
      await js(`location.href = ${JSON.stringify(target)}; void 0`)
      // Some schemes are blocked by Chromium before will-navigate is emitted.
      await Promise.race([blocked, new Promise(resolve => setTimeout(resolve, 100))])
      assert.equal(window.webContents.getURL(), trusted)
    }
    // Chromium's native drag/drop path must not replace the privileged document.
    window.webContents.debugger.attach('1.3')
    const data = { items: [{ mimeType: 'text/uri-list', data: process.env.COLORFUL_LIFE_BACKEND_URL + '/dropped-link' }], dragOperationsMask: 1 }
    for (const type of ['dragEnter', 'dragOver', 'drop']) await window.webContents.debugger.sendCommand('Input.dispatchDragEvent', { type, x: 100, y: 100, data })
    window.webContents.debugger.detach()
    assert.equal(window.webContents.getURL(), trusted)
    assert.equal(requests, 0)
    await js("location.hash = 'orders'")
    assert.equal(await js('window.adminAuth.restore()'), null)
    const tracking = 'https://www.royalmail.com/track-your-item#/tracking-results/AB123456789GB'
    await js(`window.open(${JSON.stringify(tracking)})`)
    await until('true')
    assert.deepEqual(external, [tracking])
    await js("window.open('https://evil.test'); window.open('javascript:alert(1)')")
    assert.deepEqual(external, [tracking])
    assert.equal(BrowserWindow.getAllWindows().length, 1)

    // Main fetch must reject a Backend redirect instead of forwarding login credentials.
    const login = await js("window.adminAuth.login({email:'admin@test.invalid', password:'synthetic'})")
    assert.equal(login.__colorfulLifeAdminIpcError.code, 'network')
    assert.equal(requests, 1); assert.equal(redirected, 0)
    if (development) {
      const session = window.webContents.session
      session.webRequest.onBeforeSendHeaders({ urls: ['http://127.0.0.1:5173/'] }, (details, done) => done({ requestHeaders: { ...details.requestHeaders, 'X-Runtime-Redirect': '1' } }))
      let blocked = false
      window.webContents.once('will-redirect', event => { blocked = event.defaultPrevented })
      await window.loadURL(trusted).catch(() => {})
      assert.equal(blocked, true)
      assert.notEqual(window.webContents.getURL(), 'http://127.0.0.1:9/untrusted')
      session.webRequest.onBeforeSendHeaders(null)
    }
    console.log(`Verified ${development ? 'Vite development' : 'compiled file'} security runtime: all ${handlers.size} handlers reject 3 spoofed identities; second-window denial; CSP enforcement; previews; navigation; fragments; tracking; Backend redirect rejection.`)
    clearTimeout(timeout); server.close(); app.exit(0)
  } catch (error) {
    console.error(error); clearTimeout(timeout); server.close(); app.exit(1)
  }
}
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1) })
