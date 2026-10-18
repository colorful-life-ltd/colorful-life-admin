import { expect, it, vi } from 'vitest'
import { isCreateProductRequest, ProductService } from '../electron/product-service'
import { validateListingCreation } from '../electron/purchase-service'
import { isPositivePrice } from '../electron/listing-price'
import type { AuthService } from '../electron/auth-service'

const product = { setNumber: 'PRICE-TEST', title: 'Price test', theme: 'TEST', categoryId: 1, ageRecommendation: '8+', pieceCount: 10, condition: 'NEW' as const, originalPrice: 20 }

it.each([0, -1, 0.001, 0.005, 1.234, NaN, Infinity])('rejects invalid price %s at the privileged boundary and service', async value => {
  const authenticatedFetch = vi.fn()
  const service = new ProductService({ authenticatedFetch } as unknown as AuthService)
  expect(isPositivePrice(value)).toBe(false)
  for (const prices of [{ originalPrice: value }, { salePrice: value }]) {
    expect(isCreateProductRequest({ ...product, ...prices })).toBe(false)
    expect(() => validateListingCreation({ existingProductId: 1, condition: 'NEW', currentStock: 0, originalPrice: 20, ...prices })).toThrow('greater than £0')
    await expect(service.createProduct({ ...product, ...prices })).rejects.toMatchObject({ code: 'validation' })
  }
  await expect(service.createUsedOffer(1, { salePrice: value, damageDescription: 'Creased box', conditionPhotos: [] })).rejects.toMatchObject({ code: 'validation' })
  expect(authenticatedFetch).not.toHaveBeenCalled()
})

it.each([undefined, null, 0.01, 12.34])('retains valid optional promotional prices: %s', salePrice => {
  expect(isCreateProductRequest({ ...product, salePrice })).toBe(true)
  expect(validateListingCreation({ existingProductId: 1, condition: 'NEW', currentStock: 0, originalPrice: 20, salePrice })).toEqual({ existingProductId: 1, condition: 'NEW', currentStock: 0, originalPrice: 20, ...(salePrice === undefined ? {} : { salePrice }) })
})
