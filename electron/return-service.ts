import type { AuthService } from './auth-service.js'
import { readBackendError } from './backend-error.js'
import {
  returnStatuses,
  type ReturnAction,
  type ReturnCaseView,
  type ReturnQueue,
  type ReturnStatus,
} from './return-contract.js'
import { validateOrderId, validatePage, OrderError } from './order-service.js'
export interface AdminReturnsApi {
  list(status?: ReturnStatus, page?: number): Promise<ReturnQueue>
  get(orderId: number): Promise<ReturnCaseView>
  action(
    orderId: number,
    lineId: number,
    action: ReturnAction,
    body: Record<string, unknown>,
  ): Promise<ReturnCaseView>
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const invalid = () =>
  new OrderError('validation', 'Invalid return data. Refresh and try again.')
export function parseReturnCase(
  value: unknown,
  orderId: number,
): ReturnCaseView {
  if (
    !record(value) ||
    value.orderId !== orderId ||
    !(value.reference === null || typeof value.reference === 'string') ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.submissions) ||
    !record(value.defaultInstructions) ||
    !Array.isArray(value.defaultInstructions.address) ||
    !value.defaultInstructions.address.every((x) => typeof x === 'string') ||
    typeof value.defaultInstructions.instructions !== 'string' ||
    !record(value.customer)
  )
    throw invalid()
  for (const item of value.items) {
    if (
      !record(item) ||
      typeof item.name !== 'string' ||
      !Number.isSafeInteger(item.remainingQuantity) ||
      Number(item.remainingQuantity) < 0
    )
      throw invalid()
    validateOrderId(item.id)
  }
  for (const submission of value.submissions) {
    if (
      !record(submission) ||
      typeof submission.id !== 'string' ||
      typeof submission.requestedAt !== 'string' ||
      !Array.isArray(submission.lines)
    )
      throw invalid()
    for (const line of submission.lines) {
      if (
        !record(line) ||
        !returnStatuses.includes(line.status as ReturnStatus) ||
        !Number.isSafeInteger(line.quantity) ||
        Number(line.quantity) < 1 ||
        typeof line.reason !== 'string'
      )
        throw invalid()
      validateOrderId(line.id)
      validateOrderId(line.orderItemId)
    }
  }
  return value as unknown as ReturnCaseView
}
export function validateReturnAction(
  action: unknown,
  body: unknown,
): { action: ReturnAction; body: Record<string, unknown> } {
  const fields: Record<string, string[]> = {
    authorize: [
      'shippingPayer',
      'postageInstructions',
      'instructions',
      'rightsReviewed',
    ],
    reject: ['ground', 'note', 'rightsReviewed'],
    receive: ['receivedAt', 'note'],
    cancel: ['note'],
    inspect: ['condition', 'restockQuantity', 'inspectionNote'],
    complete: [],
  }
  if (
    typeof action !== 'string' ||
    !Object.hasOwn(fields, action) ||
    !record(body) ||
    Object.keys(body).some((k) => !fields[action].includes(k))
  )
    throw invalid()
  for (const value of Object.values(body))
    if (
      typeof value === 'string' &&
      (value.length > 4000 || value.includes('\0'))
    )
      throw invalid()
  if (['authorize', 'reject'].includes(action) && body.rightsReviewed !== true)
    throw invalid()
  if (
    action === 'authorize' &&
    (!['CUSTOMER', 'SELLER'].includes(String(body.shippingPayer)) ||
      typeof body.postageInstructions !== 'string' ||
      body.postageInstructions.trim().length < 10 ||
      typeof body.instructions !== 'string' ||
      body.instructions.trim().length < 10)
  )
    throw invalid()
  if (
    ['reject', 'receive', 'cancel'].includes(action) &&
    (typeof body.note !== 'string' ||
      body.note.trim().length < (action === 'reject' ? 10 : 1))
  )
    throw invalid()
  if (
    action === 'reject' &&
    ![
      'OUTSIDE_CANCELLATION_PERIOD',
      'NO_NONCONFORMITY',
      'CUSTOMER_DAMAGE',
      'OTHER',
    ].includes(String(body.ground))
  )
    throw invalid()
  if (
    action === 'receive' &&
    (typeof body.receivedAt !== 'string' ||
      !Number.isFinite(Date.parse(body.receivedAt)))
  )
    throw invalid()
  if (
    action === 'inspect' &&
    (![
      'AS_NEW',
      'OPENED_COMPLETE',
      'DAMAGED',
      'INCOMPLETE',
      'WRONG_ITEM_RETURNED',
      'OTHER',
    ].includes(String(body.condition)) ||
      !Number.isInteger(body.restockQuantity) ||
      Number(body.restockQuantity) < 0)
  )
    throw invalid()
  return { action: action as ReturnAction, body }
}
export class ReturnService implements AdminReturnsApi {
  private readonly auth: Pick<AuthService, 'authenticatedFetch'>
  constructor(auth: Pick<AuthService, 'authenticatedFetch'>) {
    this.auth = auth
  }
  private async request(path: string, body?: Record<string, unknown>) {
    const response = await this.auth.authenticatedFetch(
      path,
      body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
    )
    if (!response.ok) {
      const error = await readBackendError(
        response,
        'The return request failed. Refresh before retrying.',
      )
      throw new OrderError('api', error.message, error.code, response.status)
    }
    return response.json() as Promise<unknown>
  }
  async list(status?: ReturnStatus, page = 1): Promise<ReturnQueue> {
    if (status !== undefined && !returnStatuses.includes(status))
      throw invalid()
    validatePage(page, 100000)
    const value = await this.request(
      `/admin/returns?page=${page}${status ? `&status=${status}` : ''}`,
    )
    if (
      !record(value) ||
      !Array.isArray(value.cases) ||
      !Number.isInteger(value.total) ||
      Number(value.total) < 0 ||
      value.page !== page ||
      !Number.isInteger(value.pageSize)
    )
      throw invalid()
    for (const c of value.cases) {
      if (
        !record(c) ||
        typeof c.reference !== 'string' ||
        !Array.isArray(c.statuses) ||
        !c.statuses.every((s) => returnStatuses.includes(s as ReturnStatus))
      )
        throw invalid()
      validateOrderId(c.orderId)
    }
    return value as unknown as ReturnQueue
  }
  async get(orderId: number) {
    validateOrderId(orderId)
    return parseReturnCase(
      await this.request(`/admin/returns/${orderId}`),
      orderId,
    )
  }
  async action(
    orderId: number,
    lineId: number,
    action: ReturnAction,
    body: Record<string, unknown>,
  ) {
    validateOrderId(orderId)
    validateOrderId(lineId)
    const input = validateReturnAction(action, body)
    return parseReturnCase(
      await this.request(
        `/admin/returns/${orderId}/lines/${lineId}/${input.action}`,
        input.body,
      ),
      orderId,
    )
  }
}
