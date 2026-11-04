import assert from 'node:assert/strict'
import test from 'node:test'
import { isForbiddenPackageEntry, normalizeAsarEntryPath } from './verify-package-paths.mjs'

test('normalizes Windows ASAR entry separators without changing the path', () => {
  assert.equal(normalizeAsarEntryPath('\\dist\\index.html'), '/dist/index.html')
  assert.equal(normalizeAsarEntryPath('\\dist-electron\\preload.cjs'), '/dist-electron/preload.cjs')
})

test('preserves POSIX ASAR entry paths', () => {
  assert.equal(normalizeAsarEntryPath('/dist/index.html'), '/dist/index.html')
})

test('applies the same forbidden-entry checks to Windows and POSIX paths', () => {
  for (const entry of ['\\src\\main.ts', '/src/main.ts', '\\.env.production', '/node_modules/pkg/index.js']) {
    assert.equal(isForbiddenPackageEntry(normalizeAsarEntryPath(entry)), true, entry)
  }
  for (const entry of ['\\dist\\index.html', '/dist-electron/main.js']) {
    assert.equal(isForbiddenPackageEntry(normalizeAsarEntryPath(entry)), false, entry)
  }
})
