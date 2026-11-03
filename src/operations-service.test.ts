import { expect, it, vi } from 'vitest'
import { OperationsService, validateOperationInput, safeOperationResult } from '../electron/operations-service'
import { AuthError } from '../electron/auth-service'
import { registerOperationsIpc } from '../electron/operations-ipc'
import type { SavedOperation } from '../electron/operations-contract'
import type { OperationJournal } from '../electron/operations-service'
const input={orderId:41,requestId:'123',reason:'Withdraw erroneous cancellation request'}
function fixture() {
  let saved: OperationJournal|SavedOperation|null=null
  const store={read:vi.fn(()=>saved),write:vi.fn((_scope:string,value:OperationJournal|SavedOperation|null)=>{saved=value})}
  const restore=vi.fn().mockResolvedValue({user:{id:2,role:'ADMIN'}})
  const authenticatedFetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({withdrawn:true,requestId:'123'})))
  return {store,restore,authenticatedFetch,service:new OperationsService({restore,authenticatedFetch},store,'https://backend.test')}
}
it('validates allowlisted operations, fields, exact request IDs and penny amounts before I/O',()=>{
  expect(()=>validateOperationInput('https://evil.test',{})).toThrow()
  for (const value of [{...input,requestId:123},{...input,requestId:'01'},{...input,requestId:'9223372036854775808'},{...input,reason:'tiny'},{...input,providerReference:'remote'}]) expect(()=>validateOperationInput('withdrawCancellation',value)).toThrow()
  for (const amount of [0,-1,1.001,Infinity]) expect(()=>validateOperationInput('refund',{orderId:41,paymentId:7,amount,reason:input.reason})).toThrow()
  expect(validateOperationInput('prices',{productListingId:1,originalPrice:10})).toEqual({productListingId:1,originalPrice:10,salePrice:null})
})
it('flushes the exact intent before sending; lost response reuses its original key and prevents payload changes',async()=>{
  const f=fixture(); f.authenticatedFetch.mockRejectedValueOnce(new Error('lost'))
  await expect(f.service.execute('withdrawCancellation',input)).rejects.toThrow('lost')
  expect(await f.service.pending()).toMatchObject([{operation:'withdrawCancellation',input,state:'uncertain'}])
  await expect(f.service.finish('withdrawCancellation',input)).rejects.toThrow('cannot be discarded')
  await expect(f.service.execute('withdrawCancellation',{...input,requestId:'124'})).rejects.toThrow('saved intent')
  await f.service.execute('withdrawCancellation',input)
  const calls=f.authenticatedFetch.mock.calls
  expect(calls).toHaveLength(2)
  expect(calls[0][0]).toBe('/admin/orders/41/withdraw-paid-cancellation')
  expect(calls[0][1].headers['Idempotency-Key']).toBe(calls[1][1].headers['Idempotency-Key'])
  expect(JSON.parse(calls[1][1].body)).toEqual({requestId:'123',reason:input.reason})
  expect(f.store.write.mock.invocationCallOrder[0]).toBeLessThan(f.authenticatedFetch.mock.invocationCallOrder[0])
  expect(await f.service.pending()).toMatchObject([{state:'confirmed'}])
  await f.service.finish('withdrawCancellation',input);expect(await f.service.pending()).toEqual([])
})
it('explains cancellation generation conflicts without switching to another request ID',async()=>{
  const f=fixture();f.authenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify({error:'CANCELLATION_VERSION_CONFLICT'}),{status:409}))
  await expect(f.service.execute('withdrawCancellation',input)).rejects.toThrow('exact active request ID')
  expect(await f.service.pending()).toMatchObject([{state:'rejected',input}])
})
it('blocks uncertain non-idempotent security changes rather than blindly replaying',async()=>{
  const f=fixture(),stock={orderId:41,action:'HOLD',note:'Investigated security evidence'}
  f.authenticatedFetch.mockRejectedValueOnce(new Error('lost'))
  await expect(f.service.execute('securityReview',stock)).rejects.toThrow()
  await expect(f.service.execute('securityReview',stock)).rejects.toThrow('does not guarantee replay')
  expect(f.authenticatedFetch).toHaveBeenCalledTimes(1)
})
it('releases an uncertain refund only after an exact-key NOT_SUBMITTED check and permits a corrected new request',async()=>{
  const f=fixture(),first={orderId:41,paymentId:7,amount:23.99,reason:'Return correction'}
  f.authenticatedFetch.mockRejectedValueOnce(new Error('network unavailable'))
  await expect(f.service.execute('refund',first)).rejects.toThrow('network unavailable')
  const original=(await f.service.pending())[0]
  expect(original).toMatchObject({operation:'refund',state:'uncertain',input:first})
  const proof=()=>new Response(JSON.stringify({state:'NOT_SUBMITTED',requestKey:original.key}))
  f.authenticatedFetch.mockResolvedValueOnce(proof()).mockResolvedValueOnce(new Response(JSON.stringify({state:'RETIRED',requestKey:original.key})))
  expect(await f.service.checkRefundStatus(first,original.key)).toEqual({state:'NOT_SUBMITTED'})
  await f.service.finishUnsubmittedRefund(first,original.key)
  expect(await f.service.pending()).toEqual([])
  f.authenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify({refundId:91,status:'PROCESSING',amount:'23.98',currency:'GBP',provider:'STRIPE'})))
  await f.service.execute('refund',{...first,amount:23.98})
  const corrected=(await f.service.pending())[0]
  expect(corrected).toMatchObject({state:'confirmed',input:{...first,amount:23.98}})
  expect(corrected.key).not.toBe(original.key)
  expect(f.authenticatedFetch.mock.calls.filter(call=>call[1]?.method==='GET')).toHaveLength(1)
  expect(f.authenticatedFetch.mock.calls[1][1].headers['Idempotency-Key']).toBe(original.key)
  expect(f.authenticatedFetch.mock.calls[2][0]).toBe('/orders/41/payments/7/refund-request-retirement')
  expect(f.authenticatedFetch.mock.calls[2][1].headers['Idempotency-Key']).toBe(original.key)
  expect(f.authenticatedFetch.mock.calls[3][1].headers['Idempotency-Key']).toBe(corrected.key)
})
it('does not retire or clear a confirmed refund journal through the unsubmitted path',async()=>{
  const f=fixture(),saved={operation:'refund' as const,input:{orderId:41,paymentId:7,amount:23.98,reason:'Return correction'},key:'12345678-1234-1234-1234-123456789abc',state:'confirmed' as const}
  f.store.write('https://backend.test|2',{version:2,intents:[saved]})
  await expect(f.service.finishUnsubmittedRefund(saved.input,saved.key)).rejects.toThrow('Only an uncertain refund request can be retired')
  expect(await f.service.pending()).toEqual([saved])
  expect(f.authenticatedFetch).not.toHaveBeenCalled()
})
it('local refund validation refuses before creating an intent or sending a request',async()=>{
  const f=fixture()
  await expect(f.service.execute('refund',{orderId:41,paymentId:7,amount:0,reason:'Return correction'})).rejects.toThrow('No request was sent')
  expect(await f.service.pending()).toEqual([])
  expect(f.authenticatedFetch).not.toHaveBeenCalled()
})
it('clears a saved refund after an authentication refusal before refund processing, but not after network ambiguity',async()=>{
  const f=fixture(),payload={orderId:41,paymentId:7,amount:23.98,reason:'Return correction'}
  f.authenticatedFetch.mockRejectedValueOnce(new AuthError('session-invalid','Session expired.','SESSION_INVALID',401))
  await expect(f.service.execute('refund',payload)).rejects.toThrow('No refund was sent to Stripe')
  expect(await f.service.pending()).toEqual([])
  f.authenticatedFetch.mockRejectedValueOnce(new AuthError('network','Unable to reach service.'))
  await expect(f.service.execute('refund',payload)).rejects.toThrow('Unable to reach service')
  expect(await f.service.pending()).toMatchObject([{state:'uncertain',input:payload}])
})
it.each(['uncertain'] as const)('preserves a saved %s refund and its original key after an authentication failure on retry',async state=>{
  const f=fixture(),payload={orderId:41,paymentId:7,amount:23.98,reason:'Return correction'},key='12345678-1234-1234-1234-123456789abc'
  const saved={operation:'refund' as const,input:payload,key,state}
  f.store.write('https://backend.test|2',{version:2,intents:[saved]})
  f.authenticatedFetch.mockRejectedValueOnce(new AuthError('session-invalid','Session expired.','SESSION_INVALID',401))
  await expect(f.service.execute('refund',payload)).rejects.toMatchObject({code:'local-validation',requestSent:false})
  expect(await f.service.pending()).toEqual([saved])
  expect(f.store.write).toHaveBeenLastCalledWith('https://backend.test|2',{version:2,intents:[saved]})
})
it('keeps an uncertain refund when NOT_SUBMITTED evidence is missing, contradictory or for another key',async()=>{
  for(const body of [
    {state:'NOT_SUBMITTED',requestKey:'different-key'},
    {state:'NOT_SUBMITTED',requestKey:'12345678-1234-1234-1234-123456789abc',refundId:9},
    {state:'UNKNOWN',requestKey:'12345678-1234-1234-1234-123456789abc'},
  ]){
    const f=fixture(),payload={orderId:41,paymentId:7,amount:5,reason:'Refund test request'}
    f.authenticatedFetch.mockRejectedValueOnce(new Error('network unavailable'))
    await expect(f.service.execute('refund',payload)).rejects.toThrow()
    const saved=(await f.service.pending())[0]
    f.authenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify({...body,requestKey:body.requestKey==='12345678-1234-1234-1234-123456789abc'?saved.key:body.requestKey})))
    await expect(f.service.checkRefundStatus(payload,saved.key)).rejects.toThrow()
    await expect(f.service.finishUnsubmittedRefund(payload,saved.key)).rejects.toThrow()
    expect(await f.service.pending()).toMatchObject([{key:saved.key,state:'uncertain'}])
  }
})
it('does not clear an uncertain journal when retirement evidence is missing or for another key',async()=>{
  for(const body of [{state:'RETIRED',requestKey:'different-key'},{state:'NOT_SUBMITTED',requestKey:'12345678-1234-1234-1234-123456789abc'},{state:'RETIRED',requestKey:'12345678-1234-1234-1234-123456789abc',refundId:99}]){
    const f=fixture(),payload={orderId:41,paymentId:7,amount:23.99,reason:'Return correction'},key='12345678-1234-1234-1234-123456789abc'
    f.store.write('https://backend.test|2',{version:2,intents:[{operation:'refund',input:payload,key,state:'uncertain'}]})
    f.authenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify(body)))
    await expect(f.service.finishUnsubmittedRefund(payload,key)).rejects.toThrow('did not confirm retirement')
    expect(await f.service.pending()).toMatchObject([{state:'uncertain',key}])
  }
})
it('requires ADMIN and strips private provider outcomes/keys from all returned data',async()=>{
  const f=fixture();f.restore.mockResolvedValueOnce({user:{id:2,role:'CUSTOMER'}})
  await expect(f.service.read('audit',{orderId:41})).rejects.toThrow('ADMIN')
  expect(f.authenticatedFetch).not.toHaveBeenCalled()
  expect(safeOperationResult({refund:{id:7,amount:'5',providerReference:'SECRET',providerOutcome:{secret:'SECRET'},refundIdempotencyKey:'SECRET'},history:[{kind:'REFUND_REVIEW',details:{reason:'Investigated evidence',apiKey:'SECRET'}}]})).toEqual({refund:{id:7,amount:'5'},history:[{kind:'REFUND_REVIEW',details:{reason:'Investigated evidence'}}]})
})
it('validates the IPC boundary and registers no arbitrary URL operation',()=>{
 const handlers=new Map<string, (...args:unknown[])=>unknown>(),f=fixture()
 registerOperationsIpc((channel,handler)=>handlers.set(channel,handler),f.service)
 expect(()=>handlers.get('admin-operations:execute')!({},'__proto__',{})).toThrow()
 expect(()=>handlers.get('admin-operations:execute')!({},'refund',{...input,amount:'5'})).toThrow()
 expect(f.authenticatedFetch).not.toHaveBeenCalled()
})

it('retires legacy return execution without sending or discarding saved evidence',async()=>{
 const f=fixture()
 const legacy:SavedOperation={operation:'authorizeReturn',input:{orderId:41,returnId:10},key:'12345678-1234-1234-1234-123456789abc',state:'uncertain'}
 f.store.write('https://backend.test|2',{version:2,intents:[legacy]});f.store.write.mockClear()
 expect(await f.service.pending()).toEqual([legacy])
 for(const op of ['requestReturn','authorizeReturn','receiveReturn','inspectReturn','completeReturn','cancelReturn'] as const)await expect(f.service.execute(op,{orderId:41,returnId:10})).rejects.toThrow('Returns workspace')
 expect(f.store.write).not.toHaveBeenCalled()
 expect(f.authenticatedFetch).not.toHaveBeenCalled()
 expect(await f.service.pending()).toEqual([legacy])
})
it('refuses to resubmit a confirmed refund and keeps its journal, key and confirmed state unchanged',async()=>{
  const f=fixture(),payload={orderId:41,paymentId:7,amount:23.98,reason:'Return correction'},key='12345678-1234-1234-1234-123456789abc'
  const saved={operation:'refund' as const,input:payload,key,state:'confirmed' as const}
  f.store.write('https://backend.test|2',{version:2,intents:[saved]})
  const writes=f.store.write.mock.calls.length
  await expect(f.service.execute('refund',payload)).rejects.toThrow('a confirmed refund is never submitted again')
  expect(f.authenticatedFetch).not.toHaveBeenCalled()
  expect(f.store.write.mock.calls.length).toBe(writes)
  expect(await f.service.pending()).toEqual([saved])
})
it('keeps the uncertain refund and its original key when a network failure is followed by an authentication failure',async()=>{
  const f=fixture(),payload={orderId:41,paymentId:7,amount:23.98,reason:'Return correction'}
  f.authenticatedFetch.mockRejectedValueOnce(new AuthError('network','Unable to reach the Colorful Life service.'))
  await expect(f.service.execute('refund',payload)).rejects.toMatchObject({code:'network'})
  const [first]=await f.service.pending() as SavedOperation[]
  expect(first).toMatchObject({operation:'refund',input:payload,state:'uncertain'})
  f.authenticatedFetch.mockRejectedValueOnce(new AuthError('session-invalid','Session expired.','SESSION_INVALID',401))
  await expect(f.service.execute('refund',payload)).rejects.toMatchObject({code:'local-validation',requestSent:false})
  expect(await f.service.pending()).toEqual([first])
  const keys=f.authenticatedFetch.mock.calls.map(call=>(call[1] as {headers:Record<string,string>}).headers['Idempotency-Key'])
  expect(keys).toEqual([first.key,first.key])
})
