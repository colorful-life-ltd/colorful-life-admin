import OrderFinancialDetails from './OrderFinancialDetails'
import { dispatchFinancialWarning } from '../electron/order-financials'
import type { OrderFinancials } from '../electron/order-financials'
import { safeTrackingUrl } from '../electron/tracking-url'
import { useEffect, useRef, useState } from 'react'
import { adminOrders } from './admin-api'
import { canCancel, canFulfil, cancellationReasons } from '../electron/order-contract'
import type { CancellationReason, Carrier, OrderDetail, OrderPage } from '../electron/order-contract'
import { validateDispatch } from '../electron/order-service'
import { isAdminIpcError } from '../electron/ipc-error-contract'
import './Orders.css'

const label = (v: string | null) => v ? v.toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()) : 'Not recorded'
const date = (v: string) => new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
const money = (v: string, currency: string) => new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(Number(v))
const message = (e: unknown) => e instanceof Error ? e.message : 'The order request failed. Please try again.'

const readFinancials = async (id: number): Promise<OrderFinancials> => {
  try { return await adminOrders.financials(id) }
  catch { return { payment: { state: 'error', message: 'Payment information could not be read. Refresh to retry.' }, refunds: { state: 'error', message: 'Refund history could not be read. Refresh to retry.' }, consistent: false } }
}
type Action = 'preparing' | 'dispatch' | 'cancel'
export default function Orders({ sessionBlocked = false }: { sessionBlocked?: boolean }) {
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<OrderPage | null>(null)
  const [id, setId] = useState<number | null>(null)
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [financials, setFinancials] = useState<OrderFinancials | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [revision, setRevision] = useState(0)
  const [action, setAction] = useState<Action | null>(null)
  const [pending, setPending] = useState(false)
  const [carrier, setCarrier] = useState<Carrier>('ROYAL_MAIL')
  const [carrierName, setCarrierName] = useState('')
  const [tracking, setTracking] = useState('')
  const [cost, setCost] = useState('')
  const [reason, setReason] = useState<CancellationReason>('OUT_OF_STOCK')
  const inFlight = useRef(false)
  const generation = useRef(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const priorFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let active = true
    generation.current += 1
    void Promise.resolve().then(async () => {
      if (!active) return
      setLoading(true); setError(''); setOrder(null); setResult(null); setFinancials(null)
      try {
        if (id === null) { const data = await adminOrders.list(page, 20); if (active) setResult(data) }
        else {
          const [data, finance] = await Promise.all([adminOrders.get(id), readFinancials(id)])
          if (active) { setOrder(data); setFinancials(finance) }
        }
      } catch (e) { if (active) setError(message(e)) }
      finally { if (active) setLoading(false) }
    })
    return () => { active = false; generation.current += 1 }
  }, [id, page, revision])

  useEffect(() => {
    if (action && !sessionBlocked) { priorFocus.current = document.activeElement as HTMLElement; dialog.current?.showModal() }
    else { if (dialog.current?.open) dialog.current.close(); if (priorFocus.current?.isConnected) priorFocus.current.focus() }
  }, [action, sessionBlocked])

  const financePayment = financials?.payment.state === 'ready' ? financials.payment.value : undefined
  const summaryMismatch = order && financePayment !== undefined && (order.paymentStatus !== (financePayment?.status ?? null)
    || (order.payment !== null && (order.payment.currency !== financePayment?.currency || order.payment.paidAt !== financePayment?.paidAt)))
  const financialWarning = summaryMismatch ? 'Order and payment reads do not agree. Refresh before dispatching.' : dispatchFinancialWarning(financials)
  const submit = async () => {
    if (!order || !action || inFlight.current || sessionBlocked || (action !== 'cancel' && financialWarning)) return
    const current = generation.current
    const refresh = async () => {
      setFinancials(null)
      const [updated, finance] = await Promise.all([adminOrders.get(order.id), readFinancials(order.id)])
      if (current === generation.current) { setOrder(updated); setFinancials(finance) }
    }
    let input
    try {
      if (action === 'dispatch') {
        if (!cost.trim()) throw new Error('Enter the actual shipping cost.')
        input = validateDispatch({ carrier, trackingNumber: tracking, actualShippingCost: Number(cost), ...(carrier === 'OTHER' ? { carrierName } : {}) })
      }
    } catch (e) { setError(message(e)); return }
    inFlight.current = true; setPending(true); setError(''); setFeedback('')
    try {
      if (action === 'dispatch') await adminOrders.dispatch(order.id, input!)
      else if (action === 'preparing') await adminOrders.preparing(order.id)
      else await adminOrders.cancel(order.id, reason)
      if (current !== generation.current) return
      setAction(null)
      setFeedback(action === 'cancel' ? 'Order cancelled. No refund was performed.' : action === 'dispatch' ? 'Shipment confirmed.' : 'Order marked as Preparing.')
      try { await refresh() }
      catch (e) { setOrder(null); setError(`Action succeeded, but refreshing the order failed. ${message(e)}`) }
    } catch (e) {
      if (current !== generation.current) return
      setError(message(e))
      if (isAdminIpcError(e) && e.status === 409) {
        setAction(null)
        try { await refresh() }
        catch (refreshError) { setOrder(null); setError(`${message(e)} Refresh failed: ${message(refreshError)}`) }
      }
    } finally { inFlight.current = false; setPending(false) }
  }

  return <section className="orders-workspace" aria-labelledby="orders-title">
    <h2 id="orders-title">{id === null ? 'Orders' : `Order #${id}`}</h2>
    <div className="order-actions">
      {id !== null && <button className="button button-secondary" disabled={pending} onClick={() => { setId(null); setFeedback(''); setAction(null) }}>Back to orders</button>}
      <button className="button button-secondary" disabled={pending || loading} onClick={() => setRevision(v => v + 1)}>Refresh {id === null ? 'orders' : 'order'}</button>
    </div>
    {feedback && <p role="status">{feedback}</p>}
    {error && !action && <p className="error-message" role="alert">{error}</p>}
    {loading && <p role="status">Loading {id === null ? 'orders' : 'order'}…</p>}
    {!loading && result && <>
      {result.items.length ? <div className="order-table-scroll"><table><thead><tr>{['Order', 'Customer', 'Date', 'Total', 'Payment', 'Fulfilment', 'Details'].map(t => <th key={t} scope="col">{t}</th>)}</tr></thead><tbody>{result.items.map(o => <tr key={o.id}>
        <td>#{o.id}</td><td>{[o.user.firstName, o.user.lastName].filter(Boolean).join(' ')}<br />{o.user.email}</td><td>{date(o.createdAt)}</td><td>{money(o.totalAmount, o.currency)} {o.currency}</td><td>{label(o.paymentStatus)}</td><td>{label(o.fulfilmentStage ?? o.status)}</td><td><button className="button button-secondary" onClick={() => { setId(o.id); setFeedback('') }}>View order #{o.id}</button></td>
      </tr>)}</tbody></table></div> : <p>No orders found.</p>}
      <nav className="order-actions" aria-label="Order pages"><button className="button button-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {result.pagination.page} of {Math.max(1, result.pagination.totalPages)} · {result.pagination.totalItems} orders</span><button className="button button-secondary" disabled={page >= result.pagination.totalPages || page >= 10000} onClick={() => setPage(p => p + 1)}>Next</button></nav>
    </>}
    {!loading && order && <>
      <p>{order.user.email} · Placed {date(order.createdAt)}</p>
      <dl><dt>Order status</dt><dd>{label(order.status)}</dd><dt>Payment</dt><dd>{label(order.paymentStatus)}{order.payment?.paidAt && ` · ${date(order.payment.paidAt)}`}</dd><dt>Fulfilment</dt><dd>{label(order.fulfilmentStage)}</dd><dt>Total</dt><dd>{money(order.totalAmount, order.currency)} {order.currency}</dd></dl>
      <OrderFinancialDetails data={financials} warning={financialWarning} />
      <h3>Products</h3><ul>{order.orderItems.map(i => <li key={i.id}>{i.productListing.legoProduct.setNumber} · {i.productListing.legoProduct.title} · {label(i.productListing.condition)}<br />{i.quantity} × {money(i.unitPrice, order.currency)} = {money(i.lineTotal, order.currency)}</li>)}</ul>
      <h3>Shipping address</h3><address>{order.deliveryRecipientName}<br />{order.deliveryLine1}<br />{order.deliveryLine2 && <>{order.deliveryLine2}<br /></>}{order.deliveryCity}<br />{order.deliveryCounty && <>{order.deliveryCounty}<br /></>}{order.deliveryPostcode}<br />{order.deliveryCountryCode}{order.deliveryPhone && <><br />{order.deliveryPhone}</>}</address>
      <h3>Shipment details</h3>{order.fulfilment.shipments.length ? order.fulfilment.shipments.map(s => <div key={s.sequence}><p>Shipment {s.sequence} · {s.carrierName} · {s.trackingNumber ?? 'No tracking number'}<br />Dispatched {date(s.dispatchedAt)}</p>{safeTrackingUrl(s.trackingUrl) && <a href={safeTrackingUrl(s.trackingUrl)!} target="_blank" rel="noopener noreferrer">Track shipment {s.sequence}</a>}{s.trackingUrl && !s.trackingUrlIncludesNumber && <p>Enter the displayed tracking number on the carrier’s website.</p>}</div>) : <p>No shipment recorded.</p>}
      {order.actualShippingCost !== null && <p>Actual shipping cost: {money(order.actualShippingCost, order.currency)}</p>}
      <h3>Fulfilment history</h3>{order.fulfilmentEvents.length ? <ol>{order.fulfilmentEvents.map(e => <li key={e.id}>{label(e.action)} · {label(e.fromStage)} → {label(e.toStage)}<br />{date(e.createdAt)} · {e.performedByUser.email} · {label(e.source)}</li>)}</ol> : <p>No fulfilment history recorded.</p>}
      <div className="order-actions">
        {canFulfil(order) && order.fulfilmentStage === 'CONFIRMED' && <button className="button button-primary" disabled={pending || !!financialWarning} onClick={() => { setError(''); setAction('preparing') }}>Mark as Preparing</button>}
        {canFulfil(order) && <button className="button button-primary" disabled={pending || !!financialWarning} onClick={() => { setError(''); setAction('dispatch'); setTracking(''); setCost('') }}>Confirm Shipment</button>}
        {canCancel(order) && <button className="button button-secondary" disabled={pending} onClick={() => { setError(''); setAction('cancel') }}>Cancel Order</button>}
      </div>
      {order.payment !== null && <p>Cancellation is unavailable for orders with a payment record.</p>}
    </>}
    <dialog ref={dialog} className="order-dialog" aria-labelledby="order-confirm-title" onCancel={e => { if (pending) e.preventDefault(); else setAction(null) }}>
      <form onSubmit={e => { e.preventDefault(); void submit() }}>
        <h3 id="order-confirm-title">{action === 'dispatch' ? 'Confirm Shipment' : action === 'cancel' ? 'Cancel Order' : 'Mark as Preparing'}</h3>
        <p>{action === 'cancel' ? 'Confirm cancellation of this order. This action does not refund a payment.' : action === 'dispatch' ? 'Confirm that this order has been shipped. Shipment details cannot be overwritten.' : 'Confirm that preparation of this order has started.'}</p>
        <fieldset disabled={pending}>
          {action === 'dispatch' && <><label htmlFor="order-carrier">Carrier</label><select id="order-carrier" value={carrier} onChange={e => setCarrier(e.target.value as Carrier)}>{(['ROYAL_MAIL', 'EVRI', 'DPD', 'OTHER'] as const).map(c => <option key={c} value={c}>{label(c)}</option>)}</select>{carrier === 'OTHER' && <><label htmlFor="order-carrier-name">Carrier name</label><input id="order-carrier-name" required maxLength={100} value={carrierName} onChange={e => setCarrierName(e.target.value)} /></>}<label htmlFor="order-tracking">Tracking number</label><input id="order-tracking" required maxLength={100} value={tracking} onChange={e => setTracking(e.target.value)} /><label htmlFor="order-cost">Actual shipping cost</label><input id="order-cost" type="number" min="0" max="100000" step="any" required value={cost} onChange={e => setCost(e.target.value)} /></>}
          {action === 'cancel' && <><label htmlFor="order-reason">Cancellation reason</label><select id="order-reason" value={reason} onChange={e => setReason(e.target.value as CancellationReason)}>{cancellationReasons.map(r => <option key={r} value={r}>{label(r)}</option>)}</select></>}
        </fieldset>
        {error && <p className="error-message" role="alert">{error}</p>}
        <div className="order-actions"><button className="button button-secondary" type="button" disabled={pending} onClick={() => { setAction(null); setError('') }}>Go back</button><button className="button button-primary" type="submit" disabled={pending} aria-busy={pending}>{pending ? 'Submitting…' : 'Confirm'}</button></div>
      </form>
    </dialog>
  </section>
}
