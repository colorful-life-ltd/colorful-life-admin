import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const admin = { id: 1, email: 'admin@example.com', role: 'ADMIN' as const, createdAt: '2026-01-01', updatedAt: '2026-01-01' }
const adminSession = { user: admin, accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }

describe('App authentication flow', () => {
  afterEach(() => { cleanup(); vi.useRealTimers() })

  beforeEach(() => {
    window.adminWindow = { maximize: vi.fn().mockResolvedValue(undefined) }
    window.adminAuth = {
      restore: vi.fn().mockResolvedValue(null),
      login: vi.fn().mockResolvedValue(adminSession),
      renewSession: vi.fn().mockResolvedValue({ accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }),
      onSessionRenewed: vi.fn().mockReturnValue(() => undefined),
      onSessionEnded: vi.fn().mockReturnValue(() => undefined),
      logout: vi.fn().mockResolvedValue(undefined),
    }
    window.adminProducts = {
      createProduct: vi.fn(),
      listProducts: vi.fn().mockResolvedValue([]),
      listAdminProductListings: vi.fn().mockResolvedValue([]),
      getProductAvailability: vi.fn().mockResolvedValue({ totalProducts: 0, totalInventory: 0, activeProducts: 0, inactiveProducts: 0 }),
      updateProductMetadata: vi.fn(),
      listProductImages: vi.fn().mockResolvedValue([]),
      uploadProductImage: vi.fn(),
      reorderProductImages: vi.fn().mockResolvedValue([]),
      updateProductImageAltText: vi.fn(),
      deleteProductImage: vi.fn(),
      setFeatureProduct: vi.fn(),
      uploadCatalogueArtwork: vi.fn(),
      removeCatalogueArtwork: vi.fn(),
      searchLegoProducts: vi.fn().mockResolvedValue({ items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } }),
      createUsedOffer: vi.fn(),
    }
    window.adminCategories = { list: vi.fn().mockResolvedValue([{ id: 4, name: 'City', subtitle: null, description: null, imageUrl: null, imagePublicId: null, thumbnailUrl: null, thumbnailPublicId: null }]), getProductAvailability: vi.fn().mockResolvedValue({ totalProducts: 0, totalInventory: 0, activeProducts: 0, inactiveProducts: 0 }), create: vi.fn(), update: vi.fn(), uploadArtwork: vi.fn(), removeArtwork: vi.fn(), uploadThumbnailArtwork: vi.fn(), removeThumbnailArtwork: vi.fn() }
  })

  it('shows the unauthenticated login screen and submits credentials', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: /sign in to continue/i })).toBeTruthy()
    expect(window.adminWindow.maximize).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: admin.email } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Admin workspace' })).toBeInTheDocument())
    await waitFor(() => expect(window.adminWindow.maximize).toHaveBeenCalledOnce())
    expect(screen.getByText(admin.email)).toBeInTheDocument()
    expect(window.adminAuth.login).toHaveBeenCalledWith({ email: admin.email, password: 'secret' })
  })

  it('opens Inventory through the authenticated navigation and returns to Products', async () => {
    window.adminAuth.restore = vi.fn().mockResolvedValue(adminSession)
    window.adminInventory = { list: vi.fn().mockResolvedValue({ items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } }), pending: vi.fn().mockResolvedValue(null), movements: vi.fn(), getOutbound: vi.fn(), prepare: vi.fn(), submit: vi.fn(), finish: vi.fn() }
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Inventory' }))
    expect(await screen.findByRole('heading', { name: 'Inventory Management' })).toBeInTheDocument()
    expect(await screen.findByText('No inventory listings found.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Products' }))
    expect(await screen.findByRole('heading', { name: 'Add product listing' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Inventory Management' })).not.toBeInTheDocument()
  })

  it('falls through to login when the preload bridge is unavailable', async () => {
    Object.defineProperty(window, 'adminAuth', { configurable: true, writable: true, value: undefined })
    render(<App />)
    expect(await screen.findByRole('heading', { name: /sign in to continue/i })).toBeTruthy()
  })

  it('shows the loading submission state', async () => {
    let resolveLogin: (value: typeof adminSession) => void = () => undefined
    window.adminAuth.login = vi.fn().mockReturnValue(new Promise<typeof adminSession>((resolve) => { resolveLogin = resolve }))
    render(<App />)
    await screen.findByRole('heading', { name: /sign in to continue/i })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: admin.email } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    const pendingButton = await screen.findByRole('button', { name: /signing in/i })
    expect(pendingButton).toBeDisabled()
    expect(pendingButton).toHaveAttribute('aria-busy', 'true')
    expect(window.adminWindow.maximize).not.toHaveBeenCalled()
    await act(async () => { resolveLogin(adminSession) })
    await waitFor(() => expect(window.adminWindow.maximize).toHaveBeenCalledOnce())
  })

  it('toggles password visibility without submitting or changing its value', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: /sign in to continue/i })
    const passwordInput = screen.getByLabelText('Password')
    fireEvent.change(passwordInput, { target: { value: 'secret-value' } })
    expect(passwordInput).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(passwordInput).toHaveAttribute('type', 'text')
    expect(passwordInput).toHaveValue('secret-value')
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument()
    expect(window.adminAuth.login).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(passwordInput).toHaveAttribute('type', 'password')
    expect(passwordInput).toHaveValue('secret-value')
    expect(window.adminAuth.login).not.toHaveBeenCalled()
  })

  it('shows authentication errors', async () => {
    window.adminAuth.login = vi.fn().mockRejectedValue(new Error('The email or password is incorrect.'))
    render(<App />)
    await screen.findByRole('heading', { name: /sign in to continue/i })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: admin.email } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('email or password is incorrect')
    expect(window.adminWindow.maximize).not.toHaveBeenCalled()
  })

  it('renders the restored shell and logs out', async () => {
    window.adminAuth.restore = vi.fn().mockResolvedValue(adminSession)
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Admin workspace' })).toBeInTheDocument()
    await waitFor(() => expect(window.adminWindow.maximize).toHaveBeenCalledOnce())
    expect(screen.getByText(admin.email)).toBeInTheDocument()
    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: /sign in to continue/i })).toBeTruthy())
    expect(window.adminAuth.logout).toHaveBeenCalled()
    expect(window.adminWindow.maximize).toHaveBeenCalledOnce()
  })

  it('opens the shared product editing workflow from the Admin navigation', async () => {
    window.adminAuth.restore = vi.fn().mockResolvedValue(adminSession)
    render(<App />)
    await screen.findByRole('heading', { name: 'Admin workspace' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit products' }))
    expect(await screen.findByRole('heading', { name: 'Edit existing product' })).toBeInTheDocument()
    expect(screen.getByLabelText('Set number or product title')).toBeInTheDocument()
  })

  it('keeps Orders behind authentication and opens the order section for an Admin', async () => {
    window.adminOrders = { financials: vi.fn(), list: vi.fn().mockResolvedValue({ items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } }), get: vi.fn(), preparing: vi.fn(), dispatch: vi.fn(), cancel: vi.fn() }
    render(<App />)
    await screen.findByRole('button', { name: 'Sign in' })
    expect(screen.queryByRole('button', { name: 'Orders' })).not.toBeInTheDocument()
    expect(window.adminOrders.list).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Orders' }))
    expect(await screen.findByText('No orders found.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit products' })).toHaveClass('button-secondary')
    expect(screen.getByRole('button', { name: 'Orders' })).toHaveClass('button-primary')
    expect(window.adminOrders.list).toHaveBeenCalledWith(1, 20)
  })

  it('returns to Login immediately while backend logout revocation is pending', async () => {
    window.adminAuth.restore = vi.fn().mockResolvedValue(adminSession)
    let finishLogout: () => void = () => undefined
    window.adminAuth.logout = vi.fn().mockImplementation(() => new Promise<void>(resolve => { finishLogout = resolve }))
    render(<App />)
    await screen.findByRole('heading', { name: 'Admin workspace' })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: /sign in to continue/i })).toBeInTheDocument()
    expect(window.adminAuth.logout).toHaveBeenCalledOnce()
    finishLogout()
  })

  it('renews from the expiry modal without resetting the current Product Editor state', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-09-26T12:00:00.000Z')
    vi.setSystemTime(now)
    const nextExpiry = new Date(now.getTime() + 60 * 60 * 1000).toISOString()
    window.adminAuth.restore = vi.fn().mockResolvedValue({ user: admin, accessTokenExpiresAt: new Date(now.getTime() + 10_000).toISOString() })
    window.adminAuth.renewSession = vi.fn().mockResolvedValue({ accessTokenExpiresAt: nextExpiry })
    const { container } = render(<App />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: 'Edit products' }))
    const search = screen.getByLabelText('Set number or product title')
    fireEvent.change(search, { target: { value: '75318' } })

    act(() => vi.advanceTimersByTime(0))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('10 seconds')
    expect(container.querySelector('.shell > div')).toHaveAttribute('inert')
    fireEvent.click(screen.getByRole('button', { name: 'Renew Session' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(window.adminAuth.renewSession).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Edit existing product' })).toBeInTheDocument()
    expect(screen.getByLabelText('Set number or product title')).toHaveValue('75318')
  })

  it('allows only one in-flight Renew Session request', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-09-26T12:00:00.000Z')
    vi.setSystemTime(now)
    window.adminAuth.restore = vi.fn().mockResolvedValue({ user: admin, accessTokenExpiresAt: new Date(now.getTime() + 30_000).toISOString() })
    let finishRenewal: (value: { accessTokenExpiresAt: string }) => void = () => undefined
    window.adminAuth.renewSession = vi.fn().mockReturnValue(new Promise((resolve) => { finishRenewal = resolve }))
    render(<App />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    act(() => vi.advanceTimersByTime(0))
    const renewButton = screen.getByRole('button', { name: 'Renew Session' })
    fireEvent.click(renewButton)
    fireEvent.click(renewButton)
    expect(window.adminAuth.renewSession).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Renewing…' })).toBeDisabled()
    await act(async () => {
      finishRenewal({ accessTokenExpiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString() })
      await Promise.resolve()
    })
  })

  it('ends the local session at actual token expiry without adding a grace period', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-09-26T12:00:00.000Z')
    vi.setSystemTime(now)
    window.adminAuth.restore = vi.fn().mockResolvedValue({ user: admin, accessTokenExpiresAt: new Date(now.getTime() + 2_000).toISOString() })
    render(<App />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    act(() => vi.advanceTimersByTime(0))
    expect(screen.getByRole('status')).toHaveTextContent('2 seconds')
    act(() => vi.advanceTimersByTime(1_999))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('heading', { name: /sign in to continue/i })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Your session has expired')
    expect(window.adminAuth.logout).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reschedules the warning after a background renewal and ignores the old expiry timer', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-09-26T12:00:00.000Z')
    vi.setSystemTime(now)
    let notifyRenewed: ((expiresAt: string) => void) | undefined
    window.adminAuth.restore = vi.fn().mockResolvedValue({ user: admin, accessTokenExpiresAt: new Date(now.getTime() + 5_000).toISOString() })
    window.adminAuth.onSessionRenewed = vi.fn((listener) => {
      notifyRenewed = listener
      return () => undefined
    })
    render(<App />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    act(() => vi.advanceTimersByTime(0))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    act(() => notifyRenewed?.(new Date(now.getTime() + 60 * 60 * 1000).toISOString()))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(5_000))
    expect(screen.getByRole('heading', { name: 'Admin workspace' })).toBeInTheDocument()
    expect(window.adminAuth.logout).not.toHaveBeenCalled()
  })

  it('cancels expiry timers after manual logout', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-09-26T12:00:00.000Z')
    vi.setSystemTime(now)
    window.adminAuth.restore = vi.fn().mockResolvedValue({ user: admin, accessTokenExpiresAt: new Date(now.getTime() + 120_000).toISOString() })
    render(<App />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(screen.getByRole('heading', { name: /sign in to continue/i })).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(120_000))
    expect(window.adminAuth.logout).toHaveBeenCalledOnce()
  })

  it('shows a session-expired explanation when the main process ends an invalid session', async () => {
    let notifySessionEnded: ((notice: { code: 'SESSION_INVALID'; message: string }) => void) | undefined
    window.adminAuth.restore = vi.fn().mockResolvedValue(adminSession)
    window.adminAuth.onSessionEnded = vi.fn((listener) => {
      notifySessionEnded = listener as typeof notifySessionEnded
      return () => undefined
    })
    render(<App />)
    await screen.findByRole('heading', { name: 'Admin workspace' })

    act(() => notifySessionEnded?.({ code: 'SESSION_INVALID', message: 'Your session has expired. Please sign in again.' }))
    expect(await screen.findByRole('heading', { name: /sign in to continue/i })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Your session has expired')
  })

  it('syncs Presentation Management to the created product category using the backend category ID', async () => {
    const harryPotter = { id: 87, name: 'Harry Potter', subtitle: 'Magic in every build', description: null, imageUrl: null, imagePublicId: null, thumbnailUrl: null, thumbnailPublicId: null }
    window.adminCategories.list = vi.fn().mockResolvedValue([{ id: 4, name: 'City', subtitle: null, description: null, imageUrl: null, imagePublicId: null, thumbnailUrl: null, thumbnailPublicId: null }, harryPotter])
    const createdProduct = {
      id: 321, legoProductId: 654, colorfulLifeCategory: 'HARRY_POTTER' as const, category: harryPotter,
      condition: 'NEW' as const, originalPrice: '19.99', salePrice: null, currentStock: 1, availableStock: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01',
      legoProduct: { id: 654, setNumber: '75966', title: 'Harry Potter Set', description: null, theme: 'Harry Potter', ageRecommendation: '8+', pieceCount: 754, isRetired: false, isFeatureProduct: false, catalogueArtworkUrl: null, catalogueArtworkPublicId: null, productImages: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    }
    window.adminAuth.restore = vi.fn().mockResolvedValue(adminSession)
    window.adminProducts.createProduct = vi.fn().mockResolvedValue(createdProduct)
    window.adminProducts.listAdminProductListings = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{
      id: 321, condition: 'NEW', active: true, usedLifecycle: null, currentStock: 1, availableStock: 1,
      legoProduct: { id: 654, setNumber: '75966', title: 'Harry Potter Set', category: { id: 87, name: 'Harry Potter' }, isFeatureProduct: false, catalogueArtworkUrl: null, catalogueArtworkPublicId: null, productImages: [] },
    }])
    const { container } = render(<App />)
    expect(await screen.findByText('Presentation management')).toBeInTheDocument()
    expect(container.querySelector('.catalogue-workspace')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Set number'), { target: { value: '75966' } })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Harry Potter Set' } })
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'Harry Potter' } })
    fireEvent.change(screen.getByLabelText('Colorful Life Category'), { target: { value: '87' } })
    fireEvent.change(screen.getByLabelText('Age recommendation'), { target: { value: '8+' } })
    fireEvent.change(screen.getByLabelText('Piece count'), { target: { value: '754' } })
    fireEvent.change(screen.getByLabelText('Original price'), { target: { value: '19.99' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create product listing' }).closest('form') as HTMLFormElement)
    expect(await screen.findByText('Harry Potter Set')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Presentation category' })).toHaveValue('87')
    expect(window.adminProducts.listAdminProductListings).toHaveBeenCalledTimes(2)
  })

  it('syncs Presentation Management to the selected LegoProduct category after a Used offer is created', async () => {
    window.adminAuth.restore = vi.fn().mockResolvedValue(adminSession)
    const harryPotter = { id: 87, name: 'Harry Potter', subtitle: 'Magic in every build', description: null, imageUrl: null, imagePublicId: null, thumbnailUrl: null, thumbnailPublicId: null }
    window.adminCategories.list = vi.fn().mockResolvedValue([{ id: 4, name: 'City', subtitle: null, description: null, imageUrl: null, imagePublicId: null, thumbnailUrl: null, thumbnailPublicId: null }, harryPotter])
    window.adminProducts.searchLegoProducts = vi.fn().mockResolvedValue({ items: [{ id: 456, setNumber: '75966', title: 'Existing Harry Potter Set', description: null, theme: 'Harry Potter', ageRecommendation: '8+', pieceCount: 754, category: { id: 87, name: 'Harry Potter' }, isRetired: false, usedOfferStatus: 'NONE' as const }], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } })
    window.adminProducts.createUsedOffer = vi.fn().mockResolvedValue({ id: 77, legoProductId: 456, condition: 'USED_LIKE_NEW' as const, originalPrice: '45.00', salePrice: null, currentStock: 1 as const, usedLifecycle: 'AVAILABLE' as const, damageDescription: 'Creased box' })
    window.adminProducts.listAdminProductListings = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{
      id: 778, condition: 'USED_LIKE_NEW', active: true, usedLifecycle: 'AVAILABLE', currentStock: 1, availableStock: 1,
      legoProduct: { id: 456, setNumber: '75966', title: 'Existing Harry Potter Set', category: { id: 87, name: 'Harry Potter' }, isFeatureProduct: false, catalogueArtworkUrl: null, catalogueArtworkPublicId: null, productImages: [] },
    }])
    render(<App />)
    expect(await screen.findByText('Presentation management')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'USED_LIKE_NEW' } })
    fireEvent.change(screen.getByLabelText('Search existing LEGO products'), { target: { value: '75966' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search products' }))
    fireEvent.click(await screen.findByRole('button', { name: /No New – Outer Box Damage offer/ }))
    fireEvent.change(screen.getByLabelText('Sale price (£)'), { target: { value: '45' } })
    fireEvent.change(screen.getByLabelText('Damage description'), { target: { value: 'Creased box' } })
    fireEvent.change(screen.getByLabelText(/Condition Photos/), { target: { files: [new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70])], 'front.jpg', { type: 'image/jpeg' })] } })
    fireEvent.submit(screen.getByRole('button', { name: 'Create New – Outer Box Damage offer' }).closest('form') as HTMLFormElement)
    expect(await screen.findByText('New – Outer Box Damage offer created: 77')).toBeInTheDocument()
    await waitFor(() => expect(window.adminProducts.listAdminProductListings).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('combobox', { name: 'Presentation category' })).toHaveValue('87')
    expect(screen.getByText('Listing #778 · Set 75966')).toBeInTheDocument()
  })
})
