import contract from '../contracts/integration-v1.json'
import { expect,it } from 'vitest'
import { parseRefunds } from '../electron/order-financials'
import { parseOutbound } from '../electron/inventory-service'
import { readBackendError } from '../electron/backend-error'
it('accepts the Backend-owned external refund actor and FBA shortfall contract',()=>{
 expect(contract.version).toBe(1)
 expect(parseRefunds([contract.externalRefund],41)[0]).toMatchObject({actorId:null,amount:'5.00'})
 expect(parseOutbound(contract.shortfallOutbound).outbound).toMatchObject({quantity:12,appliedQuantity:9,shortfall:3})
 const zero=structuredClone(contract.shortfallOutbound);zero.outbound.appliedQuantity=0;zero.outbound.shortfall=12;zero.outbound.movement.quantityChange=0
 expect(parseOutbound(zero).outbound.appliedQuantity).toBe(0)
 zero.outbound.movement.quantityChange=-12;expect(()=>parseOutbound(zero)).toThrow()
})
it('preserves structured Backend fulfilment reasons',async()=>{
 expect(await readBackendError(new Response(JSON.stringify(contract.fulfilmentError),{status:409}),'Fallback')).toMatchObject({code:'ORDER_PAYMENT_NOT_VERIFIED',reason:'CANCELLATION_PENDING'})
})
