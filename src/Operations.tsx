import ConditionConversion from './ConditionConversion'
import { useEffect, useRef, useState } from 'react'
import { adminOperations } from './admin-api'
import { operations, type Field, type InvestigationDecision, type Operation, type OperationSpec, type OperatorInput, type SafeValue, type SavedOperation } from '../electron/operations-contract'
const message = (e: unknown) => e instanceof Error ? e.message : 'Operator request failed. Refresh authoritative history.'
const label = (key: string) => key.replace(/([A-Z])/g,' $1').replaceAll('_',' ')
// Explicit-choice and optional fields start blank: nothing is sent unless the operator picks it.
const choices = (f: Field) => f.type === 'boolean' ? (f.optional ? ['', 'true'] : ['', 'false', 'true']) : f.choose ? ['', ...(f.options ?? [])] : [...(f.options ?? [])]
const choiceLabel = (f: Field, v: string) => v === '' ? (f.optional ? 'Not confirmed' : 'Choose…') : f.type === 'boolean' ? (f.optional ? 'Confirmed' : v === 'true' ? 'Yes' : 'No') : label(v)
const target = (s: SavedOperation) => ['orderId','returnId','refundId','receiptId','productListingId','productId','sourceProductListingId','provider'].filter(k => s.input[k] !== undefined).map(k => `${label(k)} ${String(s.input[k])}`).join(', ')
function Result({ value }: { value: SafeValue }) {
  if (value === null) return <span>Not recorded</span>
  if (Array.isArray(value)) return value.length ? <ol>{value.map((v,i) => <li key={i}><Result value={v} /></li>)}</ol> : <p>No records in this page.</p>
  if (typeof value === 'object') return <dl>{Object.entries(value).map(([k,v]) => <div key={k}><dt>{label(k)}</dt><dd><Result value={v} /></dd></div>)}</dl>
  return <span>{typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value)}</span>
}
export default function Operations({ sessionBlocked = false, orderId, listingId, onViewReturns }: { sessionBlocked?: boolean; orderId?: number; listingId?: number; onViewReturns?:(orderId:number)=>void }) {
  const [op,setOp] = useState<Operation>(orderId ? 'audit' : listingId ? 'inventory' : 'audit')
  const [values,setValues] = useState<Record<string,string>>({orderId:String(orderId ?? ''),productListingId:String(listingId ?? ''),page:'1',afterId:'0'})
  const [saved,setSaved] = useState<SavedOperation[]>([]), [result,setResult] = useState<SafeValue|null>(null)
  const [investigating,setInvestigating] = useState<SavedOperation|null>(null), [decision,setDecision] = useState<InvestigationDecision|''>(''), [note,setNote] = useState('')
  const [error,setError] = useState(''), [busy,setBusy] = useState(false), [confirm,setConfirm] = useState(false)
  const lock = useRef(false), generation = useRef(0)
  const spec: OperationSpec = operations[op]
  useEffect(() => {
    let active = true
    if (!window.adminOperations) return
    void adminOperations.pending().then(s => { if (active) setSaved(s) }, e => { if (active) setError(message(e)) })
    const currentGeneration = generation.current
    return () => { active = false; generation.current = currentGeneration + 1 }
  }, [])
  async function refreshSaved() { try { setSaved(await adminOperations.pending()) } catch (e) { setError(message(e)) } }
  async function resolveSaved() {
    if (!investigating || !decision || lock.current || sessionBlocked) return
    lock.current = true; setBusy(true); setError('')
    try { setResult(await adminOperations.resolve(investigating.operation, investigating.input, decision, note)); setInvestigating(null) }
    catch (e) { setError(message(e)) }
    finally { await refreshSaved(); lock.current = false; setBusy(false) }
  }
  function restore(s: SavedOperation) { if((operations[s.operation] as OperationSpec).retired){setError('Use the Returns workspace; the saved legacy intent remains available for investigation.');return} setOp(s.operation); setValues(Object.fromEntries(Object.entries(s.input).map(([k,v]) => [k,Array.isArray(v) ? v.join('\n') : v === null ? '' : String(v)]))); setConfirm(false); setError('') }
  const run = async () => {
    if (lock.current || sessionBlocked) return
    const input: OperatorInput = {}
    for (const f of spec.fields) {
      const v = values[f.name] ?? choices(f)[0] ?? ''
      if (f.optional && !v.trim()) continue
      if (!v.trim() && (f.choose || f.options)) { setError(`Choose ${f.label}. No request was sent.`); return }
      input[f.name] = ['id','integer','money'].includes(f.type) ? Number(v) : f.type === 'boolean' ? v === 'true' : f.type === 'references' ? v.split('\n').map(s => s.trim()).filter(Boolean) : v
    }
    lock.current = true; setBusy(true); setError(''); setResult(null)
    const current = generation.current
    try {
      const response = spec.method === 'GET' ? await adminOperations.read(op,input) : await adminOperations.execute(op,input)
      if (current !== generation.current) return
      setResult(response); setConfirm(false)
      if (spec.method !== 'GET' && typeof input.orderId === 'number') {
        try {
          const [audit,eligibility,order] = await Promise.all(['audit','eligibility','order'].map(read => adminOperations.read(read as Operation,{orderId:input.orderId!})))
          if (current === generation.current) setResult({result:response,audit,eligibility,order})
        } catch { if (current === generation.current) setError('Action was recorded, but refreshed history is unavailable. Do not resubmit; refresh the order and audit.') }
      }
    } catch (e) { if (current === generation.current) setError(message(e)) }
    finally {
      try { const s = await adminOperations.pending(); if (current === generation.current) setSaved(s) } catch (e) { if (current === generation.current) setError(message(e)) }
      lock.current = false; if (current === generation.current) setBusy(false)
    }
  }
  return <section aria-label="Operator workflows">
    <h2>Operator workflows</h2>
    <p>Manage returns in the Returns workspace, where the original order and return instructions are shown before each action.</p>
    <p>Paid cancellation is staged: request intent → chosen refund → cancel/restock after full finality. Reads do not release holds. Refresh authoritative history after every change.</p>
    {saved.length > 0 && <aside aria-label="Saved operator intents"><h3>Saved intents</h3><p>Each saved intent blocks only the same operation on the same target.</p><ul>{saved.map(s => <li key={s.key}>
      <p role="status">Saved {operations[s.operation].label}{target(s) && ` (${target(s)})`}: {s.state}. {s.state === 'uncertain' && ((operations[s.operation] as OperationSpec).replaySafe ? 'Retry with the same saved intent; do not create a replacement request.' : 'Investigate authoritative history, then record whether it was applied.')}</p>
      {!(operations[s.operation] as OperationSpec).retired && <button disabled={busy || sessionBlocked} onClick={() => restore(s)}>Load saved intent</button>}
      {(operations[s.operation] as OperationSpec).retired && <p>Legacy return intent retained. Inspect the case in Returns before recording the investigated outcome.</p>}
      {(operations[s.operation] as OperationSpec).retired && onViewReturns && typeof s.input.orderId==='number' && <button disabled={busy||sessionBlocked} onClick={()=>onViewReturns(Number(s.input.orderId))}>View Returns</button>}
      {s.state !== 'uncertain' && <button disabled={busy || sessionBlocked} onClick={() => { void adminOperations.finish(s.operation,s.input).then(refreshSaved,e => setError(message(e))) }}>Finish saved action</button>}
      {s.state === 'uncertain' && !(operations[s.operation] as OperationSpec).replaySafe && <button disabled={busy || sessionBlocked} onClick={() => { setInvestigating(s); setDecision(''); setNote(''); setError('') }}>Record investigated outcome</button>}
    </li>)}</ul></aside>}
    {investigating && <form aria-label="Record investigated outcome" onSubmit={e => { e.preventDefault(); void resolveSaved() }}><fieldset disabled={busy || sessionBlocked}>
      <p>Check the order audit, eligibility and current record before deciding. This records an immutable audit entry and never repeats or reverses the action.</p>
      <label>Investigated outcome<select required value={decision} onChange={e => setDecision(e.target.value as InvestigationDecision|'')}><option value="">Choose…</option><option value="APPLIED">Applied: authoritative history shows the change</option><option value="NOT_APPLIED">Not applied: authoritative history shows no change</option></select></label>
      <label>Investigation evidence (at least 10 characters)<textarea required value={note} onChange={e => setNote(e.target.value)} /></label>
      <button type="submit" disabled={!decision || note.trim().length < 10}>Record outcome and clear intent</button><button type="button" onClick={() => setInvestigating(null)}>Cancel</button>
    </fieldset></form>}
    <label>Workflow<select disabled={busy} value={op} onChange={e => {setOp(e.target.value as Operation);setConfirm(false);setResult(null);setError('')}}>{(['Orders','Inventory','Products','Reviews'] as const).map(group => <optgroup key={group} label={group}>{(Object.entries(operations) as [Operation,OperationSpec][]).filter(([,s])=>s.group===group&&!s.retired).map(([key,s]) => <option key={key} value={key}>{s.label}</option>)}</optgroup>)}</select></label>
    {spec.help && <p>{spec.help}</p>}
    <form onSubmit={e => {e.preventDefault();void run()}}><fieldset disabled={busy || sessionBlocked}>
      {spec.fields.map(f => <label key={f.name}>{f.label}{f.options || f.type === 'boolean' ? <select required={!f.optional && (f.choose || f.type === 'boolean')} value={values[f.name] ?? choices(f)[0]} onChange={e=>{setValues(v=>({...v,[f.name]:e.target.value}));setConfirm(false)}}>{choices(f).map(v=><option key={v} value={v}>{choiceLabel(f,v)}</option>)}</select> : f.type === 'references' ? <textarea required value={values[f.name] ?? ''} onChange={e=>{setValues(v=>({...v,[f.name]:e.target.value}));setConfirm(false)}} /> : <input required={!f.optional} type={['id','integer','money'].includes(f.type) ? 'number' : 'text'} min={f.type==='integer' ? 0 : f.type==='money' ? 0.01 : f.type==='id' ? 1 : undefined} step={f.type==='money' ? '0.01' : 1} minLength={f.type==='reason' ? 10 : undefined} maxLength={1000} value={values[f.name] ?? ''} onChange={e=>{setValues(v=>({...v,[f.name]:e.target.value}));setConfirm(false)}} />}</label>)}
      {spec.method !== 'GET' && <label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)} required />I have checked this intent, identity and evidence and confirm this action.</label>}
      <button type="submit" disabled={busy || sessionBlocked || (spec.method!=='GET' && !confirm)}>{busy ? 'Waiting for authoritative result…' : spec.label}</button>
    </fieldset></form>
    {spec.group === 'Inventory' && <ConditionConversion disabled={sessionBlocked || busy} />}
    {error && <p role="alert">{error}</p>}
    {result !== null && <section aria-label="Authoritative operator result"><h3>Recorded service result</h3><Result value={result}/></section>}
  </section>
}
