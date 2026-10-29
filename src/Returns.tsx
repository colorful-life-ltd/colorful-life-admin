import { useEffect, useRef, useState, type FormEvent } from 'react'
import { adminReturns } from './admin-api'
import {
  returnLabel,
  returnStatuses,
  type ReturnAction,
  type ReturnCaseView,
  type ReturnLine,
  type ReturnQueue,
  type ReturnStatus,
} from '../electron/return-contract'
import './Returns.css'
const date = (s: string) => new Date(s).toLocaleString('en-GB')
const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : 'Unable to load returns. Please retry.'
export type ReturnsNavigation = {
  orderId: number | null
  status: ReturnStatus | ''
  page: number
}
export default function Returns({
  navigation,
  onNavigate,
  onViewOriginalOrder,
  sessionBlocked = false,
}: {
  navigation: ReturnsNavigation
  onNavigate: (next: ReturnsNavigation) => void
  onViewOriginalOrder: (id: number) => void
  sessionBlocked?: boolean
}) {
  const [queue, setQueue] = useState<ReturnQueue | null>(null),
    [detail, setDetail] = useState<ReturnCaseView | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [pending, setPending] = useState(false),
    [selection, setSelection] = useState<{
      line: ReturnLine
      action: ReturnAction
    } | null>(null)
  const busy = useRef(false),
    generation = useRef({ version: 0 })
  useEffect(() => {
    let active = true
    const tracker = generation.current
    tracker.version++
    void Promise.resolve().then(async () => {
      setLoading(true)
      setError('')
      setDetail(null)
      setQueue(null)
      setSelection(null)
      try {
        if (navigation.orderId === null) {
          const q = await adminReturns.list(
            navigation.status || undefined,
            navigation.page,
          )
          if (active) setQueue(q)
        } else {
          const d = await adminReturns.get(navigation.orderId)
          if (active) setDetail(d)
        }
      } catch (e) {
        if (active) setError(errorMessage(e))
      } finally {
        if (active) setLoading(false)
      }
    })
    return () => {
      active = false
      tracker.version++
    }
  }, [navigation.orderId, navigation.status, navigation.page, revision])
  async function submit(body: Record<string, unknown>) {
    if (!selection || !detail || busy.current || sessionBlocked) return
    busy.current = true
    setPending(true)
    setError('')
    const current = generation.current.version
    try {
      const next = await adminReturns.action(
        detail.orderId,
        selection.line.id,
        selection.action,
        body,
      )
      if (current === generation.current.version) {
        setDetail(next)
        setSelection(null)
      }
    } catch (e) {
      if (current === generation.current.version)
        setError(
          `${errorMessage(e)} Refresh to confirm the current state before retrying.`,
        )
    } finally {
      busy.current = false
      if (current === generation.current.version) setPending(false)
    }
  }
  const navigate = (next: Partial<ReturnsNavigation>) =>
    onNavigate({ ...navigation, ...next })
  return (
    <section className="returns-workspace" aria-labelledby="returns-title">
      <header>
        <div>
          <p className="returns-eyebrow">Customer care</p>
          <h2 id="returns-title">
            Returns{detail?.reference ? ` · ${detail.reference}` : ''}
          </h2>
        </div>
        <button
          className="button button-secondary"
          disabled={pending}
          onClick={() => setRevision((r) => r + 1)}
        >
          Refresh
        </button>
      </header>
      {error && !selection && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading returns…</p>}
      {navigation.orderId === null && (
        <label>
          Status{' '}
          <select
            aria-label="Return status filter"
            value={navigation.status}
            disabled={loading || pending}
            onChange={(e) =>
              navigate({ status: e.target.value as ReturnStatus | '', page: 1 })
            }
          >
            <option value="">All statuses</option>
            {returnStatuses.map((s) => (
              <option key={s} value={s}>
                {returnLabel(s)}
              </option>
            ))}
          </select>
        </label>
      )}
      {!loading && queue && (
        <>
          <p>
            {queue.total} return cases · Each reference belongs to one original
            order.
          </p>
          <div className="returns-queue">
            {queue.cases.map((c) => (
              <button
                className="return-queue-card"
                key={c.orderId}
                onClick={() => navigate({ orderId: c.orderId })}
              >
                <strong>{c.reference}</strong>
                <span>
                  Original order #{c.orderId} · {date(c.createdAt)}
                </span>
                <span>
                  {c.customer
                    ? `${c.customer.firstName ?? ''} ${c.customer.lastName ?? ''} · ${c.customer.email}`
                    : 'Deleted customer account'}
                </span>
                <span>
                  {c.statuses.map((s) => (
                    <span
                      className={`return-status return-status--${s.toLowerCase()}`}
                      key={s}
                    >
                      {returnLabel(s)}
                    </span>
                  ))}
                </span>
                <span>Review return →</span>
              </button>
            ))}
          </div>
          {!queue.cases.length && <p>No returns match this filter.</p>}
          <nav aria-label="Return queue pages">
            <button
              className="button button-secondary"
              disabled={navigation.page <= 1}
              onClick={() => navigate({ page: navigation.page - 1 })}
            >
              Previous
            </button>
            <span>Page {queue.page}</span>
            <button
              className="button button-secondary"
              disabled={queue.page * queue.pageSize >= queue.total}
              onClick={() => navigate({ page: navigation.page + 1 })}
            >
              Next
            </button>
          </nav>
        </>
      )}
      {!loading && detail && (
        <>
          <div className="return-navigation">
            <button
              className="button button-primary"
              disabled={pending}
              onClick={() => onViewOriginalOrder(detail.orderId)}
            >
              View Original Order
            </button>
            <button
              className="button button-secondary"
              disabled={pending}
              onClick={() => navigate({ orderId: null })}
            >
              Back to Returns
            </button>
          </div>
          <p>
            Original order #{detail.orderId} ·{' '}
            {detail.customer?.deleted
              ? 'Deleted customer account'
              : `${detail.customer?.firstName ?? ''} ${detail.customer?.lastName ?? ''} · ${detail.customer?.email ?? ''}`}
          </p>
          <p>
            Receiving a return does not issue a refund. Inspection and
            completion remain separate actions.
          </p>
          {!detail.submissions.length && (
            <p>No return requests for this order.</p>
          )}
          {detail.submissions.map((s, index) => (
            <section className="return-submission" key={s.id}>
              <h3>
                Request {index + 1} · {date(s.requestedAt)}
              </h3>
              {s.lines.map((line) => (
                <article className="return-line" key={line.id}>
                  <header>
                    <h4>
                      {detail.items.find((i) => i.id === line.orderItemId)
                        ?.name ?? `Item ${line.orderItemId}`}{' '}
                      × {line.quantity}
                    </h4>
                    <span
                      className={`return-status return-status--${line.status.toLowerCase()}`}
                    >
                      {returnLabel(line.status)}
                    </span>
                  </header>
                  <p>
                    Line #{line.id} · {returnLabel(line.reason)} · Requested{' '}
                    {date(line.requestedAt)}
                  </p>
                  {line.reasonNote && <p>{line.reasonNote}</p>}
                  {line.rejectionNote && <p>Decision: {line.rejectionNote}</p>}
                  {line.instructions && (
                    <Instructions value={line.instructions} />
                  )}
                  <ol className="return-timeline">
                    {[
                      ['Authorised', line.authorizedAt],
                      ['Received', line.receivedAt],
                      ['Inspected', line.inspectedAt],
                      ['Completed', line.completedAt],
                      ['Rejected', line.rejectedAt],
                      ['Cancelled', line.cancelledAt],
                    ].map(
                      ([name, at]) =>
                        at && (
                          <li key={name}>
                            {name}: {date(at)}
                          </li>
                        ),
                    )}
                  </ol>
                  {line.decisionByUserId && (
                    <p>Decision operator #{line.decisionByUserId}</p>
                  )}
                  {line.receivedAt && (
                    <p>
                      Receipt operator #
                      {line.receivedByUserId ?? 'legacy record'} ·{' '}
                      {line.receiptNote ?? 'No receipt note recorded'}
                    </p>
                  )}
                  {line.inspectionNote && (
                    <p>
                      Inspection: {line.inspectionNote} · {line.restockQuantity}{' '}
                      units to restock
                    </p>
                  )}
                  {line.notification && (
                    <p>
                      Authorisation email:{' '}
                      {returnLabel(line.notification.state)}
                      {line.notification.lastErrorCode &&
                        ` · ${returnLabel(line.notification.lastErrorCode)}`}
                    </p>
                  )}
                  <div className="return-actions">
                    {(line.status === 'REQUESTED'
                      ? ['authorize', 'reject', 'cancel']
                      : line.status === 'AUTHORIZED'
                        ? ['receive', 'cancel']
                        : line.status === 'RECEIVED'
                          ? ['inspect']
                          : line.status === 'INSPECTED'
                            ? ['complete']
                            : []
                    ).map((action) => (
                      <button
                        className={`button ${action === 'authorize' || action === 'receive' ? 'button-primary' : 'button-secondary'}`}
                        disabled={pending || sessionBlocked}
                        key={action}
                        onClick={() => {
                          setError('')
                          setSelection({ line, action: action as ReturnAction })
                        }}
                      >
                        {action === 'receive'
                          ? 'Confirm Received'
                          : returnLabel(action)}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          ))}
        </>
      )}
      {selection && detail && !sessionBlocked && (
        <ReturnDecision
          key={`${selection.line.id}:${selection.action}`}
          line={selection.line}
          action={selection.action}
          detail={detail}
          pending={pending}
          error={error}
          onSubmit={submit}
          onClose={() => setSelection(null)}
        />
      )}
    </section>
  )
}
export function Instructions({
  value,
}: {
  value: {
    address: string[]
    instructions: string
    postageInstructions?: string
    shippingPayer?: string
  }
}) {
  return (
    <aside className="return-instructions">
      <h4>Return address and instructions</h4>
      <address>
        {value.address.map((line, i) => (
          <span key={i}>
            {line}
            <br />
          </span>
        ))}
      </address>
      <p>{value.instructions}</p>
      {value.shippingPayer && (
        <p>
          Postage paid by:{' '}
          {value.shippingPayer === 'SELLER' ? 'Colorful Life Ltd' : 'Customer'}
        </p>
      )}
      {value.postageInstructions && <p>{value.postageInstructions}</p>}
    </aside>
  )
}
function ReturnDecision({
  line,
  action,
  detail,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  line: ReturnLine
  action: ReturnAction
  detail: ReturnCaseView
  pending: boolean
  error: string
  onSubmit: (body: Record<string, unknown>) => Promise<void>
  onClose: () => void
}) {
  const [payer, setPayer] = useState<'CUSTOMER' | 'SELLER'>('SELLER'),
    [postage, setPostage] = useState(''),
    [instructions, setInstructions] = useState(
      detail.defaultInstructions?.instructions ?? '',
    ),
    [note, setNote] = useState(''),
    [reviewed, setReviewed] = useState(false),
    [ground, setGround] = useState('OTHER'),
    [condition, setCondition] = useState('AS_NEW'),
    [quantity, setQuantity] = useState(0),
    [receivedAt, setReceivedAt] = useState(() => {
      const now = new Date()
      return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    })
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    node?.showModal()
    return () => node?.close()
  }, [])
  function submit(e: FormEvent) {
    e.preventDefault()
    const body: Record<string, unknown> =
      action === 'authorize'
        ? {
            shippingPayer: payer,
            postageInstructions: postage,
            instructions,
            rightsReviewed: reviewed,
          }
        : action === 'reject'
          ? { ground, note, rightsReviewed: reviewed }
          : action === 'receive'
            ? { receivedAt: new Date(receivedAt).toISOString(), note }
            : action === 'inspect'
              ? {
                  condition,
                  restockQuantity: quantity,
                  ...(note ? { inspectionNote: note } : {}),
                }
              : action === 'cancel'
                ? { note }
                : {}
    void onSubmit(body)
  }
  const fault = [
    'DAMAGED',
    'DEFECTIVE',
    'WRONG_ITEM',
    'NOT_AS_DESCRIBED',
  ].includes(line.reason)
  return (
    <dialog
      ref={dialog}
      className="return-decision"
      aria-labelledby="return-decision-title"
      onCancel={(e) => {
        e.preventDefault()
        if (!pending) onClose()
      }}
    >
      <form onSubmit={submit}>
        {error && <p role="alert">{error}</p>}
        <h3 id="return-decision-title">
          {action === 'receive' ? 'Confirm Received' : returnLabel(action)} ·
          Line #{line.id}
        </h3>
        <p>
          {detail.reference} · Order #{detail.orderId} · {line.quantity} unit(s)
        </p>
        {action === 'authorize' && (
          <>
            <Instructions
              value={{
                address: detail.defaultInstructions?.address ?? [],
                instructions,
                postageInstructions: postage,
                shippingPayer: payer,
              }}
            />
            <label>
              Return postage paid by
              <select
                value={payer}
                onChange={(e) => setPayer(e.target.value as typeof payer)}
              >
                <option value="SELLER">Colorful Life Ltd</option>
                <option value="CUSTOMER" disabled={fault}>
                  Customer
                </option>
              </select>
            </label>
            <p>
              {fault
                ? 'Non-conforming goods: seller pays reasonable return costs.'
                : 'Check the applicable cancellation rights and pre-sale postage disclosure before assigning customer postage.'}
            </p>
            <label>
              Postage arrangements
              <textarea
                required
                minLength={10}
                maxLength={2000}
                value={postage}
                onChange={(e) => setPostage(e.target.value)}
              />
            </label>
            <label>
              Return instructions
              <textarea
                required
                minLength={10}
                maxLength={4000}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </label>
          </>
        )}
        {action === 'reject' && (
          <>
            <p>
              Give the factual, lawful reason. Order age, opened packaging or a
              used listing alone do not remove statutory rights. Fault claims
              need independent assessment.
            </p>
            <label>
              Rejection ground
              <select
                value={ground}
                onChange={(e) => setGround(e.target.value)}
              >
                <option value="OTHER">
                  Other lawful ground — explain below
                </option>
                <option
                  value="OUTSIDE_CANCELLATION_PERIOD"
                  disabled={line.reason !== 'CHANGE_OF_MIND'}
                >
                  Outside applicable cancellation period
                </option>
                <option value="NO_NONCONFORMITY">
                  No non-conformity established
                </option>
                <option value="CUSTOMER_DAMAGE">Customer-caused damage</option>
              </select>
            </label>
          </>
        )}
        {action === 'receive' && (
          <>
            <p>
              Confirm physical receipt only. No refund or stock change is
              performed.
            </p>
            <label>
              Received date and time
              <input
                type="datetime-local"
                required
                value={receivedAt}
                onChange={(e) => setReceivedAt(e.target.value)}
              />
            </label>
          </>
        )}
        {action === 'inspect' && (
          <>
            <label>
              Condition
              <select
                value={condition}
                onChange={(e) => {
                  setCondition(e.target.value)
                  if (e.target.value !== 'AS_NEW') setQuantity(0)
                }}
              >
                {[
                  'AS_NEW',
                  'OPENED_COMPLETE',
                  'DAMAGED',
                  'INCOMPLETE',
                  'WRONG_ITEM_RETURNED',
                  'OTHER',
                ].map((c) => (
                  <option key={c} value={c}>
                    {returnLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Quantity to restock on completion
              <input
                type="number"
                min={0}
                max={condition === 'AS_NEW' ? line.quantity : 0}
                required
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
            </label>
            <p>
              Existing stock-safety rules apply; used offers cannot be restocked
              as new.
            </p>
          </>
        )}
        {['reject', 'receive', 'inspect', 'cancel'].includes(action) && (
          <label>
            {action === 'reject'
              ? 'Reason shown to customer'
              : 'Operator notes'}
            <textarea
              required={action !== 'inspect'}
              minLength={action === 'reject' ? 10 : 1}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        )}
        {['authorize', 'reject'].includes(action) && (
          <label>
            <input
              type="checkbox"
              required
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed the applicable cancellation/faulty-goods rights and
            supporting facts.
          </label>
        )}
        {action === 'complete' && (
          <p>
            Complete this inspected return and apply only its approved restock
            quantity ({line.restockQuantity}). No refund is issued.
          </p>
        )}
        <div className="return-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={onClose}
          >
            Back
          </button>
          <button className="button button-primary" disabled={pending}>
            {pending
              ? 'Saving…'
              : `Confirm ${action === 'receive' ? 'receipt' : action}`}
          </button>
        </div>
      </form>
    </dialog>
  )
}
