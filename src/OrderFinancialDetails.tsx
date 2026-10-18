import { financialHundredths, formatFinancialAmount, refundOutcomeUncertain } from '../electron/order-financials'
import type { OrderFinancials } from '../electron/order-financials'

const date = (value: string) => new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
export default function OrderFinancialDetails({ data, warning }: { data: OrderFinancials | null; warning: string | null }) {
  const payment = data?.payment.state === 'ready' ? data.payment.value : null
  const refunds = data?.refunds.state === 'ready' ? data.refunds.value : null
  return <section aria-labelledby="order-financial-title">
    <h3 id="order-financial-title">Payment and refunds</h3>
    {!data && <p role="status">Loading payment and refund information…</p>}
    {data?.payment.state === 'error' && <p role="alert">{data.payment.message}</p>}
    {data?.refunds.state === 'error' && <p role="alert">{data.refunds.message}</p>}
    {data?.payment.state === 'ready' && !payment && <p>No payment recorded.</p>}
    {payment && <dl>
      <dt>Payment provider</dt><dd>{payment.provider}</dd>
      <dt>Payment amount</dt><dd>{formatFinancialAmount(payment.amount, payment.currency)}</dd>
      <dt>Recorded payment status</dt><dd>{payment.status}</dd>
      <dt>Paid timestamp</dt><dd>{payment.paidAt ? date(payment.paidAt) : 'Not recorded'}</dd>
      <dt>Total refunded</dt><dd>{formatFinancialAmount(payment.refundedAmount, payment.currency)}</dd>
      <dt>Reserved for pending or unresolved refunds</dt><dd>{formatFinancialAmount(payment.reservedRefundAmount, payment.currency)}</dd>
    </dl>}
    {payment && data?.consistent && <p>{financialHundredths(payment.refundedAmount, payment.currency) === 0n ? 'No completed refunds recorded.'
      : financialHundredths(payment.refundedAmount, payment.currency) === financialHundredths(payment.amount, payment.currency) ? 'Fully refunded payment.' : 'Partially refunded payment.'}</p>}
    <h4>Refund history</h4>
    {refunds && (refunds.length ? <ul>{refunds.map(refund => <li key={refund.id}>
      Refund #{refund.id} · {formatFinancialAmount(refund.amount, refund.currency)} · Recorded status: {refund.status}<br />
      {refund.reviewRequired || (refund.status !== 'PROCESSING' && refundOutcomeUncertain(refund)) ? 'Review required — outcome must not be treated as conclusive.' : refund.status === 'PROCESSING' ? 'Pending or unresolved — no definitive outcome confirmed.' : 'Recorded terminal outcome.'}
      {refund.resolutionCode && <> Resolution: {refund.resolutionCode}.</>}<br />
      {date(refund.createdAt)} · Admin #{refund.actorId}<br />{refund.reason ?? 'No reason recorded.'}
    </li>)}</ul> : <p>No refund history recorded in this read.</p>)}
    {warning && <p role="status">{warning}</p>}
    <p>Payment and refund history are separate reads and may change. Refresh order to recheck. The Backend checks payment eligibility, security holds and refund restrictions when dispatch is requested.</p>
  </section>
}
