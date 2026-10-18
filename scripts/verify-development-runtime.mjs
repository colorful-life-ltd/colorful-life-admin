import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import electron from 'electron'
const server = await createServer({ plugins: [{
  name: 'security-runtime-redirect-fixture',
  configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (!req.headers['x-runtime-redirect']) { next(); return }
      res.writeHead(302, { Location: 'http://127.0.0.1:9/untrusted' }); res.end()
    })
  },
}] })
try {
  await server.listen()
  const child = spawn(electron, ['scripts/verify-security-runtime.mjs'], { stdio: 'inherit', env: { ...process.env, SECURITY_RUNTIME_DEVELOPMENT: '1' } })
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)) })
  process.exitCode = code
} finally { await server.close() }
