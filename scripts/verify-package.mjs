import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { listPackage } from '@electron/asar'
const resources=process.platform==='darwin' ? join('Colorful Life Admin.app','Contents','Resources') : 'resources'
const archive=join('release',`Colorful Life Admin-${process.platform}-${process.arch}`,resources,'app.asar')
assert.ok(existsSync(archive),'Packaged application archive missing')
const files=listPackage(archive)
assert.ok(files.includes('/dist/index.html'))
assert.ok(files.includes('/dist-electron/main.js'))
assert.ok(files.includes('/dist-electron/preload.cjs'))
assert.ok(existsSync(join(archive+'.unpacked','dist-electron','ssm-job.ps1')),'Windows ownership supervisor must be an unpacked built asset')
assert.ok(!files.some(file=>/(^|\/)(\.env[^/]*|src|electron|contracts|operator-intents|inventory-shipments|node_modules|\.git)(\/|$)/.test(file)))
console.log('Package contains only intended built application assets; no credentials/journals/source.')
