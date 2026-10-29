import type {
  ReturnCaseView,
  ReturnQueue,
} from '../../electron/return-contract'
export const returnCase: ReturnCaseView = {
  orderId: 41,
  reference: 'BB-R-41',
  caseId: 'case-41',
  items: [
    {
      id: 1,
      name: 'Test LEGO set',
      quantity: 3,
      remainingQuantity: 2,
      condition: 'NEW',
    },
  ],
  customer: {
    id: 1,
    email: 'buyer@example.com',
    firstName: 'Sam',
    lastName: 'Buyer',
    deleted: false,
  },
  defaultInstructions: {
    address: [
      'Colorful Life Ltd',
      '3 Hawthorne Drive',
      'Bolton upon Dearne',
      'S63 8NS',
      'United Kingdom',
    ],
    instructions:
      'Pack securely and include reference BB-R-41. Keep proof of postage.',
  },
  submissions: [
    {
      id: 'submission-1',
      requestedAt: '2026-10-29T12:00:00Z',
      lines: [
        {
          id: 10,
          orderItemId: 1,
          quantity: 1,
          reason: 'DEFECTIVE',
          reasonNote: 'Missing parts',
          status: 'REQUESTED',
          requestedAt: '2026-10-29T12:00:00Z',
          authorizedAt: null,
          receivedAt: null,
          inspectedAt: null,
          completedAt: null,
          rejectedAt: null,
          cancelledAt: null,
          rejectionNote: null,
          shippingPayer: null,
          instructions: null,
        },
      ],
    },
  ],
}
export const returnQueue: ReturnQueue = {
  page: 1,
  pageSize: 25,
  total: 1,
  cases: [
    {
      orderId: 41,
      reference: 'BB-R-41',
      createdAt: '2026-10-29T12:00:00Z',
      customer: {
        email: 'buyer@example.com',
        firstName: 'Sam',
        lastName: 'Buyer',
        deletedAt: null,
      },
      statuses: ['REQUESTED'],
    },
  ],
}
