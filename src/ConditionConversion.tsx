import { useRef, useState } from 'react'
import { adminProducts } from './admin-api'
import { normalizeImageFile } from './image-normalization'
export default function ConditionConversion({ disabled=false }: {disabled?:boolean}) {
  const [product,setProduct]=useState(''),[source,setSource]=useState(''),[price,setPrice]=useState(''),[damage,setDamage]=useState(''),[reason,setReason]=useState('')
  const [files,setFiles]=useState<File[]>([]),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState(''),[submitted,setSubmitted]=useState(false)
  const lock=useRef(false)
  return <section aria-label="Physical condition conversion"><h3>Convert one NEW unit to New – Outer Box Damage</h3><p>Use this only for complete, unbuilt contents with cosmetic packaging damage. Upload 1–3 photographs of the actual unit. Source available stock is deducted and a fresh physical offer and audit are created atomically. This does not edit historical Used offers.</p>
    <form onSubmit={e=>{e.preventDefault();if(lock.current || disabled || submitted)return;lock.current=true;setBusy(true);setSubmitted(true);void (async()=>{
      try {const result=await adminProducts.createUsedOffer(Number(product),{sourceNewListingId:Number(source),salePrice:Number(price),damageDescription:damage,reasonNote:reason,conditionPhotos:await Promise.all(files.map(normalizeImageFile))});setFeedback(`Converted one unit to physical offer #${result.id}. Refresh inventory and movement history.`)}
      catch(e){setFeedback(`${e instanceof Error ? e.message : 'Conversion outcome unavailable.'} Inspect product offers and the inventory ledger before any further conversion; do not blindly resubmit.`)}
      finally{lock.current=false;setBusy(false)}
    })()}}><fieldset disabled={disabled || busy || submitted}>
      <label>Product ID<input type="number" min="1" step="1" required value={product} onChange={e=>setProduct(e.target.value)}/></label>
      <label>Source NEW listing ID<input type="number" min="1" step="1" required value={source} onChange={e=>setSource(e.target.value)}/></label>
      <label>Physical offer price (GBP)<input type="number" min="0.01" step="0.01" required value={price} onChange={e=>setPrice(e.target.value)}/></label>
      <label>Actual packaging damage<textarea required minLength={1} maxLength={2000} value={damage} onChange={e=>setDamage(e.target.value)}/></label>
      <label>Conversion evidence / reason<textarea required minLength={10} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <label>Condition photographs<input type="file" multiple required accept="image/jpeg,image/png,image/webp" onChange={e=>setFiles(Array.from(e.target.files ?? []))}/></label>
      <button disabled={files.length<1 || files.length>3}>Convert one inspected unit</button>
    </fieldset></form>{feedback && <p role="status">{feedback}</p>}
  </section>
}
