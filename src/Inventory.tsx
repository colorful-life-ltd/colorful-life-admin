import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { adminInventory } from './admin-api'
import type { InventoryMovement, InventoryPage, PendingShipment } from '../electron/inventory-contract'
import './Inventory.css'

const errorMessage = (e: unknown) => e instanceof Error ? e.message : 'Inventory request failed. Refresh or retry the saved shipment.'
const displayType = (v: string) => v.replaceAll('_', ' ')
export default function Inventory({ sessionBlocked = false }: { sessionBlocked?: boolean }) {
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0)
  const [data, setData] = useState<InventoryPage | null>(null), [loading, setLoading] = useState(true), [listError, setListError] = useState('')
  const [selected, setSelected] = useState<number | null>(null), [movements, setMovements] = useState<InventoryMovement[]>([])
  const [historyLoading, setHistoryLoading] = useState(false), [historyError, setHistoryError] = useState('')
  const [pending, setPending] = useState<PendingShipment | null>(null), [journalLoading, setJournalLoading] = useState(true), [journalError, setJournalError] = useState('')
  const [quantity, setQuantity] = useState(''), [reference, setReference] = useState(''), [note, setNote] = useState('')
  const [sending, setSending] = useState(false), [error, setError] = useState('')
  const inFlight = useRef(false), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let active = true
    void Promise.resolve().then(async () => {
      if (!active) return
      setLoading(true); setListError(''); setData(null)
      try { const result = await adminInventory.list(page); if (active) setData(result) }
      catch (e) { if (active) setListError(errorMessage(e)) }
      finally { if (active) setLoading(false) }
    })
    return () => { active = false }
  }, [page, revision])
  useEffect(() => {
    let active = true
    void adminInventory.pending().then(result => { if (active) { setPending(result); if (result) setSelected(result.request.productListingId) } }, e => { if (active) setJournalError(errorMessage(e)) }).finally(() => { if (active) setJournalLoading(false) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    let active = true
    void Promise.resolve().then(async () => {
      if (!active) return
      setMovements([]); setHistoryError('')
      if (selected === null) { setHistoryLoading(false); return }
      setHistoryLoading(true)
      try { const result = await adminInventory.movements(selected); if (active) setMovements(result) }
      catch (e) { if (active) setHistoryError(errorMessage(e)) }
      finally { if (active) setHistoryLoading(false) }
    })
    return () => { active = false }
  }, [selected, revision])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (inFlight.current || sessionBlocked || journalLoading || journalError || pending?.state === 'confirmed') return
    if (!pending && (selected === null || !Number.isInteger(Number(quantity)) || Number(quantity) <= 0 || !reference.trim() || !note.trim())) { setError('Select a listing and enter a positive whole quantity, shipment reference and required note.'); return }
    inFlight.current = true; setSending(true); setError('')
    try {
      const saved = pending ?? await adminInventory.prepare({ productListingId: selected!, quantity: Number(quantity), shipmentReference: reference, note })
      if (mounted.current) setPending(saved)
      const result = await adminInventory.submit(saved.request.idempotencyKey)
      if (mounted.current) { setPending(result); setSelected(result.request.productListingId); setRevision(r => r + 1) }
    } catch (e) {
      if (mounted.current) setError(errorMessage(e))
      // Main may have saved the request even if an IPC/network response was lost.
      try { const saved = await adminInventory.pending(); if (mounted.current) setPending(saved) }
      catch (journalFailure) { if (mounted.current) setJournalError(errorMessage(journalFailure)) }
    } finally { inFlight.current = false; if (mounted.current) setSending(false) }
  }
  const finish = async () => {
    if (!pending || inFlight.current || sessionBlocked) return
    inFlight.current = true; setSending(true); setError('')
    try { await adminInventory.finish(pending.request.idempotencyKey); if (mounted.current) { setPending(null); setQuantity(''); setReference(''); setNote('') } }
    catch (e) { if (mounted.current) setError(errorMessage(e)) }
    finally { inFlight.current = false; if (mounted.current) setSending(false) }
  }
  const listing = data?.items.find(l => l.productListingId === selected)
  return <section className="inventory-workspace" aria-labelledby="inventory-title">
    <div className="product-panel-heading"><div><p className="eyebrow">OPERATIONS</p><h2 id="inventory-title">Inventory Management</h2></div><button className="button button-secondary" onClick={() => setRevision(r => r + 1)} disabled={loading || sending}>Refresh inventory and ledger</button></div>
    <p>Current stock already excludes confirmed website sales, including orders not yet dispatched. It is not a physical shelf count. Reserved stock belongs to pending website orders. Available stock = current − reserved.</p>
    <p>Amazon shipments deduct available home stock only. Amazon warehouse balances are not managed here.</p>
    {listError && <p role="alert" className="error-message">{listError}</p>}
    {loading && <p role="status">Loading inventory…</p>}
    {!loading && data?.items.length === 0 && <p>No inventory listings found.</p>}
    {data && <><div className="inventory-table-scroll"><table className="inventory-table"><caption>Local inventory by listing. SKU unavailable; use set numbers and listing IDs to identify stock.</caption><thead><tr><th>Product / listing</th><th>Condition</th><th>Current</th><th>Reserved</th><th>Available</th><th>Action</th></tr></thead><tbody>{data.items.map(l => <tr key={l.productListingId}><th scope="row">{l.title}<small>Set {l.setNumber} · Product #{l.productId} · Listing #{l.productListingId}</small></th><td>{l.condition === 'NEW' ? 'New' : 'Used physical offer'}{!l.active && ' · Inactive'}</td><td>{l.currentStock}</td><td>{l.reservedStock}</td><td>{l.availableStock}</td><td><button className="button button-secondary" aria-pressed={selected === l.productListingId} onClick={() => setSelected(l.productListingId)}>View listing #{l.productListingId}</button></td></tr>)}</tbody></table></div>
      <nav aria-label="Inventory pages"><button className="button button-secondary" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>Previous inventory page</button><span>Page {page} of {Math.max(1, data.pagination.totalPages)}</span><button className="button button-secondary" disabled={page >= data.pagination.totalPages || loading} onClick={() => setPage(p => p + 1)}>Next inventory page</button></nav></>}
    {selected !== null && <section aria-labelledby="movement-title"><h3 id="movement-title">Movement ledger · Listing #{selected}</h3><p>Recorded movements only. Missing opening balances or historical movements are not reconstructed.</p>
      {historyLoading && <p role="status">Loading movement ledger…</p>}{historyError && <p role="alert" className="error-message">{historyError}</p>}
      {!historyLoading && !historyError && movements.length === 0 && <p>No recorded movements for this listing.</p>}
      {!historyLoading && !historyError && movements.length > 0 && <div className="inventory-table-scroll"><table className="inventory-table"><caption>Inventory movements for listing #{selected}</caption><thead><tr><th>Type</th><th>Quantity</th><th>Timestamp</th><th>Actor</th><th>Note</th><th>FBA reference</th></tr></thead><tbody>{movements.map(m => <tr key={m.id}><td>{displayType(m.type)}</td><td>{m.quantityChange > 0 ? '+' : ''}{m.quantityChange}</td><td><time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString('en-GB')}</time></td><td>User #{m.performedByUserId}</td><td>{m.note || 'Not recorded'}</td><td>{m.fbaOutbound?.shipmentReference ?? '—'}</td></tr>)}</tbody></table></div>}
    </section>}
    <section className="inventory-outbound" aria-labelledby="outbound-title"><h3 id="outbound-title">Home-to-Amazon FBA outbound</h3>
      {journalLoading && <p role="status">Checking for a saved shipment…</p>}{journalError && <p role="alert" className="error-message">{journalError} Reopen Inventory after resolving the problem. No new shipment can be submitted.</p>}
      {pending && <p>Saved shipment for Listing #{pending.request.productListingId} · Key: <code>{pending.request.idempotencyKey}</code>. Payload is locked to prevent a second deduction.</p>}
      {pending?.state === 'uncertain' && <p role="status">Outcome is uncertain. Retry this saved shipment with the same key, even if stock has changed. Do not record these goods as a new shipment.</p>}
      {pending?.state === 'confirmed' && <p role="status" className="success-message">{pending.result?.replayed ? 'Shipment already recorded. No additional stock was deducted.' : 'Outbound shipment recorded successfully.'} Reference: {pending.request.shipmentReference}. Recorded result: current {pending.result?.inventory.currentStock}, reserved {pending.result?.inventory.reservedStock}, available {pending.result?.inventory.availableStock}. The overview and ledger are refreshed separately.</p>}
      {error && <p role="alert" className="error-message">{error}</p>}
      <form onSubmit={e => void submit(e)}>
        <fieldset disabled={sending || !!pending || sessionBlocked || journalLoading || !!journalError}><legend>{pending ? `Saved listing #${pending.request.productListingId}` : listing ? `${listing.title} · Listing #${listing.productListingId}` : 'Select a New listing above'}</legend>
          <label>Outbound quantity<input type="number" min="1" max="2147483647" step="1" required value={pending?.request.quantity ?? quantity} onChange={e => setQuantity(e.target.value)} /></label>
          <label>Shipment reference<input required maxLength={200} value={pending?.request.shipmentReference ?? reference} onChange={e => setReference(e.target.value)} /></label>
          <label>Required shipment note<textarea required maxLength={2000} value={pending?.request.note ?? note} onChange={e => setNote(e.target.value)} /></label>
        </fieldset>
        {!pending && listing?.condition === 'USED_LIKE_NEW' && <p>Used physical offers are not supported for FBA outbound.</p>}
        <button className="button button-primary" type="submit" disabled={sending || sessionBlocked || journalLoading || !!journalError || pending?.state === 'confirmed' || (!pending && (!listing || listing.condition !== 'NEW'))} aria-busy={sending}>{sending ? 'Recording shipment…' : pending?.state === 'confirmed' ? 'Shipment recorded' : pending ? 'Retry saved shipment' : 'Record outbound shipment'}</button>
      </form>
      {pending && pending.state !== 'uncertain' && <button className="button button-secondary" disabled={sending || sessionBlocked} onClick={() => void finish()}>{pending.state === 'confirmed' ? 'Start another physical shipment' : pending.state === 'rejected' ? 'Discard rejected request and edit' : 'Cancel unsent shipment'}</button>}
    </section>
  </section>
}
