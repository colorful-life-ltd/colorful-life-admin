import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Operations from './Operations'
const api={pending:vi.fn(),read:vi.fn(),execute:vi.fn(),finish:vi.fn()}
beforeEach(()=>{vi.clearAllMocks();Object.assign(window,{adminOperations:api});api.pending.mockResolvedValue(null);api.read.mockResolvedValue([]);api.execute.mockResolvedValue({withdrawn:true,requestId:'9007199254740993'});api.finish.mockResolvedValue(undefined)})
afterEach(cleanup)
it('submits an exact string cancellation generation and refreshes audit, eligibility and order after success',async()=>{
 render(<Operations orderId={41}/> )
 fireEvent.change(screen.getByLabelText('Workflow'),{target:{value:'withdrawCancellation'}})
 fireEvent.change(screen.getByLabelText('Exact cancellation request ID from audit'),{target:{value:'9007199254740993'}})
 fireEvent.change(screen.getByLabelText('Reason (at least 10 characters)'),{target:{value:'Withdraw mistaken cancellation request'}})
 fireEvent.click(screen.getByRole('checkbox'))
 fireEvent.click(screen.getByRole('button',{name:'Withdraw paid cancellation'}))
 await waitFor(()=>expect(api.execute).toHaveBeenCalledWith('withdrawCancellation',{orderId:41,requestId:'9007199254740993',reason:'Withdraw mistaken cancellation request'}))
 await waitFor(()=>expect(api.read).toHaveBeenCalledWith('audit',{orderId:41}))
 expect(api.read).toHaveBeenCalledWith('eligibility',{orderId:41})
 expect(screen.getByText('9007199254740993')).toBeTruthy()
})
it('shows version conflicts and never replaces the request ID or initiates a refund automatically',async()=>{
 api.execute.mockRejectedValueOnce(new Error('Cancellation request changed. Refresh audit history.'))
 render(<Operations orderId={41}/> )
 fireEvent.change(screen.getByLabelText('Workflow'),{target:{value:'withdrawCancellation'}})
 fireEvent.change(screen.getByLabelText('Exact cancellation request ID from audit'),{target:{value:'123'}})
 fireEvent.change(screen.getByLabelText('Reason (at least 10 characters)'),{target:{value:'Withdraw mistaken cancellation request'}})
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Withdraw paid cancellation'}))
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Refresh audit history'))
 expect(api.execute).toHaveBeenCalledTimes(1)
 expect(screen.getByLabelText<HTMLInputElement>('Exact cancellation request ID from audit').value).toBe('123')
})
it('requires session availability and explicit confirmation for write operations',()=>{
 render(<Operations sessionBlocked orderId={41}/> )
 fireEvent.change(screen.getByLabelText('Workflow'),{target:{value:'stocktake'}})
 expect(screen.getByRole<HTMLButtonElement>('button',{name:'Reconcile physical stocktake'}).disabled).toBe(true)
 expect(api.execute).not.toHaveBeenCalled()
})
it('offers safe recovery of saved uncertainty and no discard button',async()=>{
 api.pending.mockResolvedValue({operation:'withdrawCancellation',input:{orderId:41,requestId:'123',reason:'Withdraw mistaken cancellation'},key:'saved-key',state:'uncertain'})
 render(<Operations/>)
 await waitFor(()=>expect(screen.getByText(/Saved Withdraw paid cancellation: uncertain/)).toBeTruthy())
 expect(screen.queryByRole('button',{name:'Finish saved action'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Load saved intent'}))
 expect(screen.getByLabelText<HTMLInputElement>('Exact cancellation request ID from audit').value).toBe('123')
 expect(api.execute).not.toHaveBeenCalled()
})
