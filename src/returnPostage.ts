export type ReturnPostagePayer = 'CUSTOMER' | 'SELLER'
/** Fixed customer-facing postage text, sent in the existing postageInstructions field. */
export const RETURN_POSTAGE_INSTRUCTIONS: Record<ReturnPostagePayer, string> = {
  CUSTOMER:
    'Please arrange and pay for return postage. Use a tracked service and keep proof of postage until your return has been processed.',
  SELLER:
    'Please return the item using a tracked delivery service and keep your proof of postage. We will reimburse reasonable return postage costs in accordance with your statutory rights.',
}
