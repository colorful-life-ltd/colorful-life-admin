import type { AdminOrdersApi } from '../electron/order-contract.js'
import type { AdminProductsApi } from '../electron/product-contract.js'
import type { AdminCategoriesApi } from '../electron/category-contract.js'
import type { AdminPurchasesApi } from '../electron/purchase-contract.js'
import type { AdminAuthApi } from '../electron/auth-contract.js'
import type { AdminWindowApi } from '../electron/window-contract.js'

declare global {
  interface AdminUser {
    id: number
    email: string
    role: 'ADMIN'
    createdAt: string
    updatedAt: string
  }

  interface Window {
    adminReturns: import('../electron/return-service').AdminReturnsApi
    adminOperations: import('../electron/operations-contract').AdminOperationsApi
    adminInventory: import('../electron/inventory-contract').AdminInventoryApi
    adminOrders: AdminOrdersApi
    adminAuth: AdminAuthApi
    adminWindow: AdminWindowApi
    adminProducts: AdminProductsApi
    adminCategories: AdminCategoriesApi
    adminPurchases: AdminPurchasesApi
  }
}
