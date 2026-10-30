// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

// The owner's npm runs scripts under Windows PowerShell 5.1 (script-shell=powershell), which has no
// `&&`/`||` chaining. Sequences must go through npm-run-all (run-s) so every shell runs them alike.
const scripts: Record<string, string> = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts

/** Expands run-s steps recursively into the leaf commands, in execution order. */
function steps(name: string): string[] {
  const command = scripts[name]
  expect(command, `missing script ${name}`).toBeDefined()
  const runS = /^run-s (.+)$/.exec(command)
  return runS ? runS[1].split(' ').flatMap(steps) : [name]
}

it('uses no shell-specific command chaining that Windows PowerShell 5.1 rejects', () => {
  for (const [name, command] of Object.entries(scripts)) expect(command, name).not.toMatch(/&&|\|\||;\s/)
})

it('compiles the Electron main process before copying its runtime assets', () => {
  expect(steps('build:electron')).toEqual(['build:electron:tsc', 'build:electron:assets'])
  expect(scripts['build:electron:tsc']).toBe('tsc -p tsconfig.electron.json')
  expect(scripts['build:electron:assets']).toBe('node scripts/copy-electron-assets.mjs')
})

it('copies Electron assets before starting the watch compiler in development', () => {
  expect(steps('dev:electron:compile')).toEqual(['build:electron:assets', 'dev:electron:watch'])
  expect(scripts['dev:electron:watch']).toBe('tsc -p tsconfig.electron.json --watch')
})

it('rebuilds renderer and main process before launching the Sandbox Admin, so stale output cannot run', () => {
  const order = steps('electron:sandbox')
  const launch = order.indexOf('electron:sandbox:launch')
  expect(launch).toBe(order.length - 1)
  for (const step of ['typecheck', 'build:renderer:vite', 'build:electron:tsc', 'build:electron:assets']) {
    expect(order.indexOf(step), step).toBeGreaterThanOrEqual(0)
    expect(order.indexOf(step), step).toBeLessThan(launch)
  }
  expect(scripts['electron:sandbox:launch']).toBe('cross-env COLORFUL_LIFE_CONNECTION_MODE=remote-sandbox electron .')
})

it('builds before packaging', () => {
  expect(steps('package').at(-1)).toBe('package:create')
  expect(steps('package')).toContain('build:electron:assets')
})
