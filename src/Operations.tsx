import ConditionConversion from './ConditionConversion'
import { useEffect, useRef, useState } from 'react'
import { adminOperations } from './admin-api'
import { operations, type Operation, type OperationSpec, type OperatorInput, type SafeValue, type SavedOperation } from '../electron/operations-contract'
const message = (e: unknown) => e instanceof Error ? e.message : 'Operator request failed. Refresh authoritative history.'
const label = (key: string) => key.replace(/([A-Z])/g,' $1').replaceAll('_',' ')
function Result({ value }: { value: SafeValue }) {
  if (value === null) return <span>Not recorded</span>
  if (Array.isArray(value)) return value.length ? <ol>{value.map((v,i) => <li key={i}><Result value={v} /></li>)}</ol> : <p>No records in this page.</p>
  if (typeof value === 'object') return <dl>{Object.entries(value).map(([k,v]) => <div key={k}><dt>{label(k)}</dt><dd><Result value={v} /></dd></div>)}</dl>
  return <span>{typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value)}</span>
}
export default function Operations({ sessionBlocked = false, orderId, listingId }: { sessionBlocked?: boolean; orderId?: number; listingId?: number }) {
  const [op,setOp] = useState<Operation>(orderId ? 'audit' : listingId ? 'inventory' : 'audit')
  const [values,setValues] = useState<Record<string,string>>({orderId:String(orderId ?? ''),productListingId:String(listingId ?? ''),page:'1',afterId:'0'})
  const [saved,setSaved] = useState<SavedOperation|null>(null), [result,setResult] = useState<SafeValue|null>(null)
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
  function restore(s: SavedOperation) { setOp(s.operation); setValues(Object.fromEntries(Object.entries(s.input).map(([k,v]) => [k,Array.isArray(v) ? v.join('\n') : v === null ? '' : String(v)]))); setConfirm(false); setError('') }
  const run = async () => {
    if (lock.current || sessionBlocked) return
    const input: OperatorInput = {}
    for (const f of spec.fields) {
      const v = values[f.name] ?? f.options?.[0] ?? (f.type === 'boolean' ? 'false' : '')
      if (f.optional && !v.trim()) continue
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
    <p>Paid cancellation is staged: request intent → chosen refund → cancel/restock after full finality. Reads do not release holds. Refresh authoritative history after every change.</p>
    {saved && <aside><p role="status">Saved {operations[saved.operation].label}: {saved.state}. {saved.state === 'uncertain' && 'Keep the same intent. Do not create a replacement request.'}</p><button disabled={busy || sessionBlocked} onClick={() => restore(saved)}>Load saved intent</button>
      {saved.state !== 'uncertain' && <button disabled={busy || sessionBlocked} onClick={() => { void adminOperations.finish().then(() => {setSaved(null);setResult(null)},e => setError(message(e))) }}>Finish saved action</button>}
    </aside>}
    <label>Workflow<select disabled={busy} value={op} onChange={e => {setOp(e.target.value as Operation);setConfirm(false);setResult(null);setError('')}}>{(['Orders','Inventory','Products','Reviews'] as const).map(group => <optgroup key={group} label={group}>{(Object.entries(operations) as [Operation,OperationSpec][]).filter(([,s])=>s.group===group).map(([key,s]) => <option key={key} value={key}>{s.label}</option>)}</optgroup>)}</select></label>
    {spec.help && <p>{spec.help}</p>}
    <form onSubmit={e => {e.preventDefault();void run()}}><fieldset disabled={busy || sessionBlocked}>
      {spec.fields.map(f => <label key={f.name}>{f.label}{f.options || f.type === 'boolean' ? <select value={values[f.name] ?? f.options?.[0] ?? 'false'} onChange={e=>{setValues(v=>({...v,[f.name]:e.target.value}));setConfirm(false)}}>{(f.options ?? ['false','true']).map(v=><option key={v} value={v}>{label(v)}</option>)}</select> : f.type === 'references' ? <textarea required value={values[f.name] ?? ''} onChange={e=>{setValues(v=>({...v,[f.name]:e.target.value}));setConfirm(false)}} /> : <input required={!f.optional} type={['id','integer','money'].includes(f.type) ? 'number' : 'text'} min={f.type==='integer' ? 0 : f.type==='money' ? 0.01 : f.type==='id' ? 1 : undefined} step={f.type==='money' ? '0.01' : 1} minLength={f.type==='reason' ? 10 : undefined} maxLength={1000} value={values[f.name] ?? ''} onChange={e=>{setValues(v=>({...v,[f.name]:e.target.value}));setConfirm(false)}} />}</label>)}
      {spec.method !== 'GET' && <label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)} required />I have checked this intent, identity and evidence and confirm this action.</label>}
      <button type="submit" disabled={busy || sessionBlocked || (spec.method!=='GET' && !confirm)}>{busy ? 'Waiting for authoritative result…' : spec.label}</button>
    </fieldset></form>
    {spec.group === 'Inventory' && <ConditionConversion disabled={sessionBlocked || busy} />}
    {error && <p role="alert">{error}</p>}
    {result !== null && <section aria-label="Authoritative operator result"><h3>Recorded service result</h3><Result value={result}/></section>}
  </section>
}
