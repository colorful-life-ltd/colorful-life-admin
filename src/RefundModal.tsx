import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { adminOperations } from './admin-api'
import { financialHundredths, formatFinancialAmount, refundOutcomeUncertain } from '../electron/order-financials'
import type { OrderFinancials, RefundView } from '../electron/order-financials'
import type { OrderDetail } from '../electron/order-contract'
import type { ReturnCaseView } from '../electron/return-contract'
import type { Operation, OperatorInput, SafeValue, SavedOperation } from '../electron/operations-contract'
import type { PaymentEnvironment } from '../electron/payment-environment'
import { clampRefundCents, completedReturnedItemsCents, orderDeliveryChargeCents, refundCentsText, refundInputCents } from './refund-ux'
import './RefundModal.css'

const reasons = [
  ['CHANGED_MIND', 'Changed mind'], ['FAULTY', 'Faulty'], ['DAMAGED_IN_TRANSIT', 'Damaged in transit'],
  ['WRONG_ITEM', 'Wrong item'], ['NOT_AS_DESCRIBED', 'Not as described'], ['GOODWILL', 'Goodwill'], ['OTHER', 'Other'],
] as const
type RefundResult = { refundId: number; status: RefundView['status']; amount: string; currency: string; provider: string; resolutionCode?: string; reviewRequired?: boolean }
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
function parseRefundResult(value: SafeValue): RefundResult | null {
  if (!record(value) || !Number.isSafeInteger(value.refundId) || Number(value.refundId) <= 0
    || !['SUCCEEDED', 'FAILED', 'PROCESSING'].includes(String(value.status)) || typeof value.amount !== 'string'
    || value.currency !== 'GBP' || value.provider !== 'STRIPE') return null
  try { if (financialHundredths(value.amount, 'GBP') <= 0n) return null } catch { return null }
  return { refundId: Number(value.refundId), status: value.status as RefundView['status'], amount: value.amount, currency: value.currency,
    provider: value.provider, ...(typeof value.resolutionCode === 'string' ? { resolutionCode: value.resolutionCode } : {}),
    ...(typeof value.reviewRequired === 'boolean' ? { reviewRequired: value.reviewRequired } : {}) }
}
function safeValueText(value: SafeValue, depth = 0): string {
  if (depth > 5) return 'Additional details are available in Operator workflows.'
  if (value === null || typeof value !== 'object') return String(value ?? 'Not recorded')
  if (Array.isArray(value)) return value.map(v => safeValueText(v, depth + 1)).join(', ')
  return Object.entries(value).map(([key, item]) => `${key.replaceAll('_', ' ')}: ${safeValueText(item, depth + 1)}`).join(' · ')
}

export default function RefundModal({ detail, order, financials, environment, connectionMode, sessionBlocked = false, onClose, onRefresh, onOpenOperatorWorkflows }: {
  detail: ReturnCaseView; order: OrderDetail | null; financials: OrderFinancials | null; environment: PaymentEnvironment | null
  connectionMode: 'direct' | 'remote-sandbox' | null; sessionBlocked?: boolean; onClose: () => void
  onRefresh: () => Promise<void>; onOpenOperatorWorkflows: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLElement | null>(null), submitting = useRef(false)
  const [phase, setPhase] = useState<'edit' | 'confirm' | 'outcome'>('edit')
  const [amount, setAmount] = useState(''), [reason, setReason] = useState(''), [note, setNote] = useState('')
  const [liveConfirmed, setLiveConfirmed] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<SavedOperation | null>(null), [checkingSaved, setCheckingSaved] = useState(false)
  const [result, setResult] = useState<RefundResult | null>(null), [outcomeText, setOutcomeText] = useState('')
  const [finalize, setFinalize] = useState<{ operation: Operation; input: OperatorInput } | null>(null)
  const [reviewText, setReviewText] = useState('')
  const payment = financials?.payment.state === 'ready' ? financials.payment.value : null
  const refunds = financials?.refunds.state === 'ready' ? financials.refunds.value : null
  const availableCents = useMemo(() => {
    if (!payment) return 0n
    try { return financialHundredths(payment.amount, payment.currency) - financialHundredths(payment.refundedAmount, payment.currency) - financialHundredths(payment.reservedRefundAmount, payment.currency) }
    catch { return 0n }
  }, [payment])
  const returnedCents = order ? completedReturnedItemsCents(detail, order, payment?.currency ?? order.currency) : null
  const deliveryCents = order ? orderDeliveryChargeCents(order) : null
  const inputCents = refundInputCents(amount)
  const env = environment?.stripeEnvironment ?? 'UNKNOWN'
  const mismatch = connectionMode === 'remote-sandbox' && env === 'LIVE'
  const financialsReady = !!financials && financials.consistent && financials.payment.state === 'ready' && financials.refunds.state === 'ready'
  const activeRefund = refunds?.find(r => r.status === 'PROCESSING' || r.reviewRequired || refundOutcomeUncertain(r))
  const safeEnvironment = (env === 'TEST' || env === 'LIVE') && !mismatch
  const noPriorLedgerEvidence = financialsReady && !!payment && refunds?.length === 0
    && financialHundredths(payment.refundedAmount, payment.currency) === 0n
    && financialHundredths(payment.reservedRefundAmount, payment.currency) === 0n
  const submitEnabled = safeEnvironment && financialsReady && !!payment && payment.provider === 'STRIPE'
    && payment.status === 'SUCCEEDED' && !!payment.paidAt && !!payment.paymentIntentReference
    && availableCents > 0n && !activeRefund && !sessionBlocked
  const builtReason = `${detail.reference ?? `Order ${detail.orderId}`} — ${reasons.find(([value]) => value === reason)?.[1] ?? ''}${note.trim() ? ` — ${note.trim()}` : ''}`.trim()

  useEffect(() => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = dialog.current
    if (node && !node.open) node.showModal()
    node?.querySelector<HTMLElement>('[data-refund-focus]')?.focus()
    let active = true
    void adminOperations.pending().then(intents => {
      if (!active) return
      const match = intents.find(s => s.operation === 'refund' && Number(s.input.orderId) === detail.orderId)
      if (!match) return
      setSaved(match)
      if (match.state === 'uncertain' || match.state === 'confirmed') {
        setPhase('outcome')
        setOutcomeText(match.state === 'uncertain'
          ? 'A previous refund request may have reached Stripe. Do not create another request. Use “Check saved request” to retry only that same request.'
          : 'A previous refund request was accepted by the Backend. Review the current order-level refund records below before finishing this Admin record.')
      }
    }).catch(() => { if (active) setOutcomeText('Saved refund history could not be read. Do not start another refund until it is available.') })
    return () => { active = false; node?.close(); trigger.current?.focus() }
  }, [detail.orderId])

  function close() { if (busy) return; onClose() }
  function setAmountCents(value: bigint) { setAmount(refundCentsText(clampRefundCents(value, availableCents))); setError('') }
  function addDelivery() {
    if (deliveryCents === null) return
    const current = inputCents ?? 0n
    setAmountCents(current + deliveryCents)
  }
  function continueToReview(event: FormEvent) {
    event.preventDefault(); setError('')
    if (!submitEnabled) { setError(mismatch ? 'Sandbox is connected to a LIVE Stripe environment. Refund is blocked.' : 'Refund unavailable until payment, environment and refund records are verified.'); return }
    if (inputCents === null) { setError('Enter an amount using pounds and pence, for example 23.98.'); return }
    if (inputCents <= 0n) { setError('Refund amount must be greater than £0.00.'); return }
    if (inputCents > availableCents) { setError(`Amount exceeds the available ${formatFinancialAmount(refundCentsText(availableCents), 'GBP')}.`); return }
    if (!reason) { setError('Choose a refund reason.'); return }
    setPhase('confirm')
  }

  async function execute(operation: Operation, input: OperatorInput, replay = false) {
    if (submitting.current || sessionBlocked) return
    submitting.current = true; setBusy(true); setError('')
    try {
      const response = await adminOperations.execute(operation, input)
      const parsed = parseRefundResult(response)
      setResult(parsed)
      if (parsed) {
        setSaved(null)
        setFinalize({ operation, input })
      } else {
        setFinalize(null)
        const intents = await adminOperations.pending().catch(() => [])
        setSaved(intents.find(s => s.operation === 'refund' && Number(s.input.orderId) === detail.orderId) ?? saved)
      }
      setPhase('outcome')
      setOutcomeText(parsed ? '' : 'The Backend accepted the request, but returned an unrecognized refund result. Keep this saved request and inspect the authoritative payment records; do not submit again.')
      if (parsed) await onRefresh()
      if (replay && !parsed) setOutcomeText('The same saved request was checked, but no conclusive refund result was returned. It remains saved; do not create another refund.')
    } catch (failure) {
      const disposition = record(failure) ? failure.refundSubmissionDisposition : undefined
      const message = failure instanceof Error ? failure.message : 'Refund request outcome could not be verified.'
      setError('')
      if (disposition === 'NOT_SUBMITTED') {
        setPhase('edit')
        setOutcomeText('The Backend confirmed this request was not sent to Stripe. Correct the amount or details and review again.')
        setError(message)
        const intents = await adminOperations.pending().catch(() => [])
        setSaved(intents.find(s => s.operation === 'refund' && Number(s.input.orderId) === detail.orderId) ?? null)
      } else {
        setPhase('outcome')
        setOutcomeText('We could not verify whether this request reached Stripe. The original saved request remains in place; do not submit a new refund.')
        setError(message)
        const intents = await adminOperations.pending().catch(() => [])
        setSaved(intents.find(s => s.operation === 'refund' && Number(s.input.orderId) === detail.orderId) ?? saved)
      }
    } finally { submitting.current = false; setBusy(false) }
  }

  function submitRefund(event: FormEvent) {
    event.preventDefault()
    if (!submitEnabled || !payment || !inputCents || inputCents <= 0n || inputCents > availableCents || !reason) return
    if (env === 'LIVE' && !liveConfirmed) { setError('Confirm that this is a real-money refund before continuing.'); return }
    void execute('refund', { orderId: detail.orderId, paymentId: payment.id, amount: Number(inputCents) / 100, reason: builtReason })
  }

  async function checkSaved() {
    if (!saved || saved.operation !== 'refund') return
    setCheckingSaved(true)
    await execute('refund', saved.input, true)
    setCheckingSaved(false)
  }
  async function reconcile(refund: RefundView) {
    await execute('reconcile', { orderId: detail.orderId, refundId: refund.id })
  }
  async function openReview(refund: RefundView) {
    setBusy(true); setError('')
    try { setReviewText(safeValueText(await adminOperations.read('refundReview', { orderId: detail.orderId, refundId: refund.id }))) }
    catch { setReviewText('Refund review details could not be loaded. Open Operator workflows → Refund reviews for the authoritative review.') }
    finally { setBusy(false) }
  }
  async function finishAndClose() {
    if (busy) return
    if (saved?.state === 'confirmed') {
      setError('Check the same saved request first so its authoritative refund result is displayed before finishing this Admin record.')
      return
    }
    if (saved?.state === 'rejected') {
      if (!noPriorLedgerEvidence) { setError('The authoritative payment records do not prove this rejected attempt created no refund. Keep it and use Operator workflows for review.'); return }
      setBusy(true)
      try {
        await adminOperations.finish('refund', saved.input)
        setSaved(null)
        setPhase('edit')
        setOutcomeText('The declined request was not submitted. You can correct the amount and review it again.')
        setError('')
      }
      catch (e) { setError(e instanceof Error ? e.message : 'The saved request could not be cleared.') }
      finally { setBusy(false) }
      return
    }
    if (finalize) {
      setBusy(true)
      try { await adminOperations.finish(finalize.operation, finalize.input); setSaved(null); setFinalize(null) }
      catch (e) { setError(e instanceof Error ? e.message : 'The recorded Admin request could not be finished.') ; setBusy(false); return }
      setBusy(false)
    }
    await onRefresh()
    onClose()
  }

  const showNewRefundForm = !(saved && (saved.state === 'uncertain' || saved.state === 'confirmed' || saved.state === 'rejected'))
  const liveWarning = env === 'LIVE'
  return <dialog ref={dialog} className="refund-v2" aria-labelledby="refund-v2-title" onCancel={event => { event.preventDefault(); if (!busy) close() }}>
    <header className="refund-v2__header"><div><p className="returns-eyebrow">Customer care</p><h2 id="refund-v2-title">Refund · {detail.reference ?? `Order ${detail.orderId}`}</h2></div><button type="button" className="refund-v2__close" onClick={close} disabled={busy} aria-label="Close refund">×</button></header>
    <div className="refund-v2__body">
      <p className="refund-v2__order">Order #{detail.orderId} · Return {detail.reference ?? 'reference unavailable'}</p>
      {!financialsReady && <p className="refund-v2__block" role="status">Payment and refund records are unavailable or inconsistent. Refund submission is blocked; refresh before continuing.</p>}
      {financialsReady && payment && <dl className="refund-v2__financials">
        <div><dt>Stripe payment reference</dt><dd>{payment.paymentIntentReference ?? 'Unavailable — refund blocked'}</dd></div>
        <div><dt>Captured</dt><dd>{formatFinancialAmount(payment.amount, payment.currency)}</dd></div>
        <div><dt>Already refunded</dt><dd>{formatFinancialAmount(payment.refundedAmount, payment.currency)}</dd></div>
        <div><dt>Pending / reserved</dt><dd>{formatFinancialAmount(payment.reservedRefundAmount, payment.currency)}</dd></div>
        <div><dt>Available to refund</dt><dd>{formatFinancialAmount(refundCentsText(availableCents < 0n ? 0n : availableCents), payment.currency)}</dd></div>
      </dl>}
      {!payment && financialsReady && <p className="refund-v2__block">No payment is recorded for this order.</p>}
      <p className={`refund-v2__environment refund-v2__environment--${env.toLowerCase()}`} role="status">Stripe environment: <strong>{env}</strong>{env === 'TEST' ? ' — no real money moves.' : env === 'LIVE' ? ' — real money will be refunded.' : ' — status is unverified; refund is blocked.'}</p>
      {mismatch && <p className="refund-v2__block" role="alert">Sandbox connection / LIVE Stripe mismatch. New refund submission is blocked.</p>}
      {financialsReady && payment && payment.provider !== 'STRIPE' && <p className="refund-v2__block">This refund workflow supports verified Stripe payments only.</p>}
      {!!refunds?.length && <section className="refund-v2__records" aria-label="Order-level refund records"><h3>Recorded refunds for this order</h3><p>These records apply to the order payment. They are not allocated to individual returned items.</p><ul>{refunds.map(refund => <li key={refund.id}>
        <strong>Refund #{refund.id}: {refund.status} · {formatFinancialAmount(refund.amount, refund.currency)}</strong>
        {refund.status === 'SUCCEEDED' && !refund.reviewRequired && <span> Stripe reports succeeded; this does not confirm when funds reach the customer’s bank.</span>}
        {refund.status === 'PROCESSING' && <span> Pending or unresolved. Do not start another refund.</span>}
        {refund.reviewRequired && <span> Needs review before another refund.</span>}
        {(refund.reviewRequired || refundOutcomeUncertain(refund)) && <button type="button" className="refund-v2__text-button" disabled={busy || sessionBlocked} onClick={() => void openReview(refund)}>View refund review</button>}
        {refund.status === 'PROCESSING' && !refund.reviewRequired && <>{environment?.refundReconciliationEnabled
          ? <button type="button" className="refund-v2__text-button" disabled={busy || sessionBlocked} onClick={() => void reconcile(refund)}>Check refund status</button>
          : <span> Status checking is currently unavailable; the refund remains pending. Use Operator workflows for evidence review.</span>}</>}
      </li>)}</ul></section>}
      {reviewText && <p className="refund-v2__review" role="status">{reviewText}</p>}
      {saved?.state === 'uncertain' && <section className="refund-v2__outcome" role="alert"><h3>Refund status needs checking</h3><p>{outcomeText}</p><p>Saved amount: {typeof saved.input.amount === 'number' ? formatFinancialAmount(String(saved.input.amount), 'GBP') : 'unknown'}. The same saved request will be used.</p><button type="button" className="button button-primary" disabled={busy || checkingSaved || sessionBlocked} onClick={() => void checkSaved()}>{checkingSaved || busy ? 'Checking…' : 'Check saved request'}</button></section>}
      {saved?.state === 'rejected' && <section className="refund-v2__outcome"><h3>Previous request was declined</h3><p>{outcomeText || 'This local record is from an earlier Admin version. It can be cleared only when current, consistent payment records prove that no refund was created or reserved.'}</p><button type="button" className="button button-secondary" disabled={busy || sessionBlocked || !noPriorLedgerEvidence} onClick={() => void finishAndClose()}>{busy ? 'Verifying…' : 'Clear declined request'}</button>{!noPriorLedgerEvidence && <p role="status">Refund or reservation evidence exists, or the financial read is incomplete. Keep the saved request and review it.</p>}</section>}
      {saved?.state === 'confirmed' && <section className="refund-v2__outcome" role="status"><h3>Previous request recorded</h3><p>{outcomeText}</p><p>Check the original request key to display its authoritative refund again. No new key or amount will be created.</p><button type="button" className="button button-primary" disabled={busy || checkingSaved || sessionBlocked} onClick={() => void checkSaved()}>{checkingSaved || busy ? 'Checking…' : 'Check saved request'}</button></section>}
      {phase === 'outcome' && !saved && <section className="refund-v2__outcome" role={result?.status === 'FAILED' ? 'status' : 'status'}>
        <h3>{result?.reviewRequired ? 'Refund needs review' : result?.status === 'SUCCEEDED' ? 'Refund succeeded' : result?.status === 'PROCESSING' ? 'Refund pending' : result?.status === 'FAILED' ? 'Refund failed' : 'Refund status is unverified'}</h3>
        {result ? <p>Refund #{result.refundId} · {result.status} · {formatFinancialAmount(result.amount, result.currency)}{result.resolutionCode ? ` · ${result.resolutionCode.replaceAll('_', ' ').toLowerCase()}` : ''}</p> : <p>{outcomeText}</p>}
        {result?.status === 'SUCCEEDED' && <p>Stripe reports success. The bank settlement time is not reported here.</p>}
        {result?.status === 'PROCESSING' && <p>Do not submit another refund. Check the recorded refund or use review if the provider outcome remains unclear.</p>}
        {error && <p role="alert">{error}</p>}
      </section>}
      {phase === 'edit' && showNewRefundForm && <form id="refund-v2-form" className="refund-v2__form" noValidate onSubmit={continueToReview}>
        <label htmlFor="refund-v2-amount">Refund amount (GBP)</label>
        <input id="refund-v2-amount" data-refund-focus type="text" inputMode="decimal" autoComplete="off" value={amount} aria-describedby="refund-v2-amount-help" disabled={!submitEnabled || busy} onChange={event => { setAmount(event.target.value); setError('') }} />
        <p id="refund-v2-amount-help">Enter an amount up to the available balance. Delivery reimbursement is a separate decision; statutory rights may require it.</p>
        <div className="refund-v2__fill-actions" aria-label="Fill amount controls">
          <button type="button" className="button button-secondary" disabled={!submitEnabled || returnedCents === null || returnedCents <= 0n || busy} onClick={() => returnedCents !== null && setAmountCents(returnedCents)}>Use returned items value</button>
          <button type="button" className="button button-secondary" disabled={!submitEnabled || deliveryCents === null || deliveryCents <= 0n || busy} onClick={addDelivery}>Add delivery charge</button>
          <button type="button" className="button button-secondary" disabled={!submitEnabled || availableCents <= 0n || busy} onClick={() => setAmountCents(availableCents)}>Use full available amount</button>
        </div>
        {returnedCents !== null && <p>Value of completed returned items: {formatFinancialAmount(refundCentsText(returnedCents), payment?.currency ?? 'GBP')} (order-level estimate).</p>}
        {deliveryCents !== null ? <p>Delivery charge in the frozen order record: {formatFinancialAmount(refundCentsText(deliveryCents), payment?.currency ?? 'GBP')}.</p> : <p>Delivery charge is unavailable in the frozen order record; enter any additional delivery amount only after verifying it separately.</p>}
        <label htmlFor="refund-v2-reason">Reason</label>
        <select id="refund-v2-reason" value={reason} disabled={!submitEnabled || busy} onChange={event => setReason(event.target.value)}>
          <option value="">Choose a reason</option>{reasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label htmlFor="refund-v2-note">Optional note</label>
        <textarea id="refund-v2-note" value={note} maxLength={500} disabled={!submitEnabled || busy} onChange={event => setNote(event.target.value)} />
        {error && <p className="refund-v2__error" role="alert">{error}</p>}
        {outcomeText && <p role="status">{outcomeText}</p>}
      </form>}
      {phase === 'confirm' && payment && <section className="refund-v2__confirm" aria-label="Confirm refund details">
        <h3>Review before refunding</h3><dl>
          <div><dt>Amount</dt><dd>{inputCents !== null ? formatFinancialAmount(refundCentsText(inputCents), 'GBP') : 'Invalid amount'}</dd></div>
          <div><dt>Payment</dt><dd>{payment.paymentIntentReference ?? 'Unavailable'}</dd></div>
          <div><dt>Order / return</dt><dd>#{detail.orderId} · {detail.reference ?? 'reference unavailable'}</dd></div>
          <div><dt>Reason</dt><dd>{builtReason}</dd></div>
          <div><dt>Available after this refund</dt><dd>{inputCents !== null ? formatFinancialAmount(refundCentsText(availableCents - inputCents), 'GBP') : 'Unavailable'}</dd></div>
        </dl>
        {liveWarning && <label className="refund-v2__live-confirm"><input type="checkbox" checked={liveConfirmed} onChange={event => setLiveConfirmed(event.target.checked)} disabled={busy} />I understand this LIVE Stripe refund moves real money.</label>}
        {env === 'TEST' && <p className="refund-v2__environment">Stripe TEST: no real money moves.</p>}
        {error && <p role="alert">{error}</p>}
      </section>}
    </div>
    <footer className="refund-v2__footer">
      {phase === 'edit' && <><button type="button" className="button button-secondary" onClick={close} disabled={busy}>Cancel</button><button type="submit" form="refund-v2-form" className="button button-primary" disabled={!submitEnabled || busy || !showNewRefundForm}>Continue</button></>}
      {phase === 'confirm' && <><button type="button" className="button button-secondary" disabled={busy} onClick={() => { setPhase('edit'); setLiveConfirmed(false) }}>Back</button><button type="button" className="button button-primary" disabled={busy || !submitEnabled || env === 'LIVE' && !liveConfirmed} onClick={submitRefund}>{busy ? 'Sending refund…' : `Refund ${inputCents !== null ? formatFinancialAmount(refundCentsText(inputCents), 'GBP') : 'amount'}`}</button></>}
      {phase === 'outcome' && <><button type="button" className="button button-secondary" disabled={busy} onClick={() => void onRefresh()}>Refresh records</button><button type="button" className="button button-secondary" disabled={busy} onClick={onOpenOperatorWorkflows}>Operator workflows</button><button type="button" className="button button-primary" disabled={busy || !!saved && saved.state !== 'rejected' || !!saved && saved.state === 'rejected' && !noPriorLedgerEvidence} onClick={() => void finishAndClose()}>{busy ? 'Saving…' : 'Done'}</button></>}
    </footer>
  </dialog>
}
