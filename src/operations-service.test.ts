import { expect, it, vi } from 'vitest'
import { OperationsService, validateOperationInput, safeOperationResult } from '../electron/operations-service'
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
