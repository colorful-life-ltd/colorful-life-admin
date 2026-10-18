import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createHash } from 'node:crypto'
import { rendererCsp } from './electron/content-security-policy.js'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'renderer-csp',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        // Hash Vite/React's development preamble instead of allowing arbitrary inline scripts.
        const hashes = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
          .map(match => createHash('sha256').update(match[1]).digest('base64'))
        const origin = context.server ? 'http://127.0.0.1:5173' : undefined
        return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: rendererCsp(origin, hashes) }, injectTo: 'head-prepend' }]
      },
    },
  }],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
})
