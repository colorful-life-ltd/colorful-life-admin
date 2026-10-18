export const priceValidationMessage = 'Selling prices must be greater than £0 and use whole pennies. Leave the optional sale price empty to use the regular price.'

export function isPositivePrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && /^\d+(?:\.\d{1,2})?$/.test(String(value))
}

export function hasValidListingPrices(value: { originalPrice?: unknown; salePrice?: unknown }): boolean {
  return isPositivePrice(value.originalPrice) && (value.salePrice === undefined || value.salePrice === null || isPositivePrice(value.salePrice))
}
