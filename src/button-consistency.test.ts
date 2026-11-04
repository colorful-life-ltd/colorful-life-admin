/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = resolve(process.cwd(), 'src')
const sheets = readdirSync(dir).filter(f => f.endsWith('.css')).map(file => ({ file, css: readFileSync(resolve(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }))
/** Every rule (including those nested in @media) as { file, selectors, body }. */
const rules = sheets.flatMap(({ file, css }) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ file, selectors: sel.replace(/@media[^{]*\{/, '').split(',').map(s => s.trim().replace(/\s+/g, ' ')), body })))
const rule = (selector: string) => rules.find(r => r.file === 'App.css' && r.selectors.includes(selector))?.body ?? ''
const prop = (body: string, name: string) => new RegExp(`(?:^|[;\\s])${name}:\\s*([^;]+)`).exec(body)?.[1].trim()
const tsx = readdirSync(dir).filter(f => f.endsWith('.tsx') && !f.includes('.test.')).map(f => readFileSync(resolve(dir, f), 'utf8')).join('\n')

describe('shared Admin button system', () => {
  it('gives every button one height, type size, weight, radius and centred alignment', () => {
    const base = rule('.button')
    expect(prop(base, 'display')).toBe('inline-flex')
    expect(prop(base, 'align-items')).toBe('center')
    expect(prop(base, 'justify-content')).toBe('center')
    expect(prop(base, 'box-sizing')).toBe('border-box')
    expect(prop(base, 'min-height')).toBe('40px')
    expect(prop(base, 'font-size')).toBe('13px')
    expect(prop(base, 'font-weight')).toBe('700')
    expect(prop(base, 'border-radius')).toBe('9px')
    expect(prop(base, 'margin')).toBe('0')
    // Filled and outlined variants share a border width, so they are the same height.
    expect(prop(base, 'border')).toBe('1.5px solid transparent')
    expect(prop(rule('.button-outline'), 'border')).toMatch(/^1\.5px solid/)
  })
  it('keeps variants to colour only, so primary and secondary align in one action row', () => {
    for (const variant of ['.button-primary', '.button-secondary', '.button-outline']) {
      const owned = rules.filter(r => r.selectors.includes(variant))
      expect(owned.length).toBeGreaterThan(0)
      for (const r of owned) expect(r.body).not.toMatch(/(^|[;\s])(margin[a-z-]*|height|min-height|padding[a-z-]*|font-size):/)
    }
    // Only a form's own stacked submit keeps its separation from the last field.
    const primaryMargins = rules.filter(r => r.selectors.some(s => /\.button-primary$/.test(s)) && /margin/.test(r.body)).flatMap(r => r.selectors)
    expect(primaryMargins).toEqual(['form > .button-primary'])
    expect(prop(rule('.button-primary'), 'background')).toBe('var(--accent)')
    expect(prop(rule('.button-secondary'), 'background')).toBe('var(--surface-muted)')
  })
  it('has hover, focus-visible, disabled and busy states for every variant', () => {
    expect(rule('.button-primary:hover:not(:disabled)')).toContain('background')
    expect(rule('.button-secondary:hover:not(:disabled)')).toContain('background')
    expect(rule('.button-outline:hover:not(:disabled)')).toContain('background')
    expect(prop(rule('.button:focus-visible'), 'outline')).toBe('3px solid var(--focus)')
    expect(prop(rule('.button:disabled'), 'cursor')).toBe('not-allowed')
    expect(prop(rule('.button[aria-busy="true"]'), 'cursor')).toBe('progress')
  })
  it('limits per-screen height overrides to the deliberate exceptions', () => {
    const heights = rules.filter(r => !r.selectors.includes('.button') && r.selectors.some(s => /\.button\b|button-/.test(s)) && /(^|[;\s])(min-)?height:/.test(r.body))
      .map(r => `${r.selectors.find(s => /\.button\b|button-/.test(s))} ${prop(r.body, 'min-height') ?? prop(r.body, 'height')}`)
    expect(heights.sort()).toEqual([
      '.category-actions .button 40px', // fixed-width artwork controls, same height as the rest
      '.connection-panel-compact .button 34px', // compact status banner
      '.login-card .button 46px', // full-width CTA matching the 46px login inputs
      '.manual-purchase-supplier-error .button 34px', // inline retry inside an error message
      '.presentation-actions .button 40px', // three-column card grid, same height as the rest
      '.purchase-history-search .button 42px', // matches the 42px search input beside it
      '.workspace-nav .button 40px', // navigation tabs
    ])
  })
  it('keeps the Confirm Shipment dialog actions in one shared row of shared buttons', () => {
    const row = /<div className="order-actions"><button className="button button-secondary"[^\n]*?>Go back<\/button><button className="button button-primary"/
    expect(tsx).toMatch(row)
    const orderActions = rules.filter(r => r.selectors.includes('.order-actions'))
    expect(orderActions.map(r => prop(r.body, 'align-items'))).toContain('center')
    expect(rules.filter(r => r.selectors.some(s => /\.order-actions .*button/.test(s)))).toEqual([])
  })
})
