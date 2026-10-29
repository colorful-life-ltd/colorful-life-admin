import Returns, {type ReturnsNavigation} from './Returns'
import Operations from './Operations'
import Inventory from './Inventory'
import Orders from './Orders'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import AddProduct from './AddProduct'
import CataloguePresentation from './CataloguePresentation'
import Categories from './Categories'
import Purchases from './Purchases'
import ProductEditor from './ProductEditor'
import type { ProductListing, UsedOfferCreated } from '../electron/product-contract'
import type { AdminSessionView } from '../electron/auth-contract'
import { isAdminIpcError } from '../electron/ipc-error-contract'
import { adminAuth } from './admin-api'
import { useSessionExpiry } from './useSessionExpiry'

type ViewState = 'restoring' | 'signed-out' | 'signed-in'

function App() {
  const [viewState, setViewState] = useState<ViewState>(() => window.adminAuth ? 'restoring' : 'signed-out')
  const [user, setUser] = useState<AdminUser | null>(null)
  const [accessTokenExpiresAt, setAccessTokenExpiresAt] = useState<string | null>(null)
  const [expiryScheduleRevision, setExpiryScheduleRevision] = useState(0)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [isRenewing, setIsRenewing] = useState(false)
  const [renewalError, setRenewalError] = useState('')
  const [renewalUnavailable, setRenewalUnavailable] = useState(false)
  const [presentationRefreshToken, setPresentationRefreshToken] = useState(0)
  const [presentationRefreshCategory, setPresentationRefreshCategory] = useState<number | null>(null)
  const [section, setSection] = useState<'products' | 'edit-products' | 'categories' | 'purchases' | 'orders' | 'inventory' | 'operations' | 'returns'>('products')
  const [returnsNavigation,setReturnsNavigation]=useState<ReturnsNavigation>({orderId:null,status:'REQUESTED',page:1})
  const [orderTarget,setOrderTarget]=useState<number|null>(null)
  const expiryRef = useRef<string | null>(null)
  const sessionRevision = useRef(0)
  const renewalPending = useRef(false)
  const renewButtonRef = useRef<HTMLButtonElement | null>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  const setSessionExpiry = useCallback((expiresAt: string | null) => {
    sessionRevision.current += 1
    setExpiryScheduleRevision(sessionRevision.current)
    expiryRef.current = expiresAt
    setAccessTokenExpiresAt(expiresAt)
  }, [])

  const applySession = useCallback((session: AdminSessionView | null) => {
    sessionRevision.current += 1
    setExpiryScheduleRevision(sessionRevision.current)
    expiryRef.current = session?.accessTokenExpiresAt ?? null
    setAccessTokenExpiresAt(session?.accessTokenExpiresAt ?? null)
    setUser(session?.user ?? null)
  }, [])

  const finishLocalSession = useCallback((message: string) => {
    applySession(null)
    setViewState('signed-out')
    setEmail('')
    setPassword('')
    setError(message)
    setRenewalError('')
    setRenewalUnavailable(false)
    setIsRenewing(false)
    renewalPending.current = false
  }, [applySession])

  const expireCurrentSession = useCallback((scheduledExpiry: string, scheduleRevision: number) => {
    if (expiryRef.current !== scheduledExpiry || sessionRevision.current !== scheduleRevision) return
    finishLocalSession('Your session has expired. Please sign in again.')
    void adminAuth.logout()
  }, [finishLocalSession])

  const isLatestExpiry = useCallback((scheduledExpiry: string, scheduleRevision: number) =>
    expiryRef.current === scheduledExpiry && sessionRevision.current === scheduleRevision, [])
  const { warningOpen, remainingSeconds, dismissWarning: dismissExpiryWarning } = useSessionExpiry(accessTokenExpiresAt, expireCurrentSession, isLatestExpiry, expiryScheduleRevision)

  useEffect(() => {
    if (warningOpen) {
      previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      renewButtonRef.current?.focus()
      return
    }
    if (previouslyFocused.current?.isConnected) previouslyFocused.current.focus()
    previouslyFocused.current = null
  }, [warningOpen])

  useEffect(() => {
    if (!window.adminAuth) return
    return adminAuth.onSessionRenewed((expiresAt) => {
      if (!expiryRef.current) return
      setSessionExpiry(expiresAt)
      dismissExpiryWarning()
      setRenewalError('')
      setRenewalUnavailable(false)
      renewalPending.current = false
      setIsRenewing(false)
    })
  }, [dismissExpiryWarning, setSessionExpiry])

  useEffect(() => {
    if (!window.adminAuth) return
    return adminAuth.onSessionEnded((notice) => finishLocalSession(notice.message))
  }, [finishLocalSession])

  useEffect(() => {
    if (!window.adminAuth) return
    let active = true

    void Promise.resolve().then(() => adminAuth.restore()).then(
      (restoredSession) => {
        if (!active) return
        applySession(restoredSession)
        setViewState(restoredSession ? 'signed-in' : 'signed-out')
      },
      (restoreError: unknown) => {
        if (!active) return
        const message = restoreError instanceof Error ? restoreError.message : 'Unable to restore your session.'
        setError(message)
        setViewState('signed-out')
      },
    )
    return () => { active = false }
  }, [applySession])

  useEffect(() => {
    if (viewState === 'signed-in' && user) {
      void window.adminWindow?.maximize().catch(() => undefined)
    }
  }, [viewState, user])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      const authenticatedSession = await adminAuth.login({ email, password })
      applySession(authenticatedSession)
      setPassword('')
      setError('')
      setViewState('signed-in')
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Sign-in failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRenewSession = async () => {
    if (renewalPending.current || !warningOpen) return
    const currentExpiry = expiryRef.current
    if (!currentExpiry) return
    if (Date.parse(currentExpiry) <= Date.now()) {
      expireCurrentSession(currentExpiry, sessionRevision.current)
      return
    }

    renewalPending.current = true
    const requestRevision = sessionRevision.current
    setIsRenewing(true)
    setRenewalError('')
    try {
      const renewedSession = await adminAuth.renewSession()
      if (sessionRevision.current !== requestRevision || !expiryRef.current) return
      setSessionExpiry(renewedSession.accessTokenExpiresAt)
      dismissExpiryWarning()
      setRenewalUnavailable(false)
    } catch (renewalFailure) {
      if (sessionRevision.current === requestRevision) {
        setRenewalError(renewalFailure instanceof Error ? renewalFailure.message : 'Session renewal failed. Try again before the countdown ends.')
        setRenewalUnavailable(isAdminIpcError(renewalFailure) && renewalFailure.code === 'renewal-unavailable')
      }
    } finally {
      renewalPending.current = false
      setIsRenewing(false)
    }
  }

  const handleLogout = async () => {
    if (isLoggingOut) return
    setIsLoggingOut(true)
    finishLocalSession('')
    setViewState('signed-out')
    try {
      await adminAuth.logout()
    } finally {
      setIsLoggingOut(false)
    }
  }

  const handleProductCreated = (product: ProductListing) => {
    setPresentationRefreshCategory(product.category?.id ?? null)
    setPresentationRefreshToken((current) => current + 1)
  }

  const handleUsedOfferCreated = (_offer: UsedOfferCreated, categoryId: number | null) => {
    setPresentationRefreshCategory(categoryId)
    setPresentationRefreshToken((current) => current + 1)
  }

  if (viewState === 'restoring') {
    return <main className="auth-page"><p className="status-message">Restoring session…</p></main>
  }

  if (viewState === 'signed-in' && user) {
    return (
      <main className="shell">
        <div inert={warningOpen}>
          <header className="shell-header">
            <div><p className="eyebrow">COLORFUL LIFE</p><div className="workspace-title"><h1>Admin workspace</h1><span className="admin-status" aria-label="Administrator access confirmed">✓</span><span className="admin-email">{user.email}</span></div></div>
            <button className="button button-secondary" type="button" onClick={() => void handleLogout()} disabled={isLoggingOut} aria-busy={isLoggingOut}>{isLoggingOut ? 'Signing out…' : 'Sign out'}</button>
          </header>
          <nav className="workspace-nav" aria-label="Admin sections">{([['products','Products'],['edit-products','Edit products'],['categories','Categories'],['purchases','Purchases'],['orders','Orders'],['returns','Returns'],['inventory','Inventory'],['operations','Operator workflows']] as const).map(([key,title])=><button key={key} className={`button ${section===key?'button-primary':'button-secondary'}`} onClick={()=>{if(key==='orders')setOrderTarget(null);setSection(key)}}>{title}</button>)}</nav>
          {section === 'returns' ? <Returns navigation={returnsNavigation} onNavigate={setReturnsNavigation} sessionBlocked={warningOpen} onViewOriginalOrder={id=>{setOrderTarget(id);setSection('orders')}}/> : section === 'operations' ? <Operations sessionBlocked={warningOpen} onViewReturns={id=>{setReturnsNavigation(current=>({...current,orderId:id}));setSection('returns')}} /> : section === 'inventory' ? <Inventory sessionBlocked={warningOpen} /> : section === 'orders' ? <Orders sessionBlocked={warningOpen} initialOrderId={orderTarget} onViewReturns={id=>{setReturnsNavigation(current=>({...current,orderId:id}));setSection('returns')}} /> : section === 'edit-products' ? <ProductEditor /> : section === 'categories' ? <Categories /> : section === 'purchases' ? <Purchases /> : <div className="catalogue-workspace">
            <AddProduct onProductCreated={handleProductCreated} onUsedOfferCreated={handleUsedOfferCreated} />
            <CataloguePresentation refreshToken={presentationRefreshToken} refreshCategory={presentationRefreshCategory} />
          </div>}
        </div>
        {warningOpen && <div className="session-expiry-backdrop">
          <section className="session-expiry-modal" role="dialog" aria-modal="true" aria-labelledby="session-expiry-title">
            <p className="eyebrow">SECURITY</p>
            <h2 id="session-expiry-title">Your session is about to expire</h2>
            <p>For security, your Admin session will expire in:</p>
            <p className="session-expiry-countdown" role="status" aria-live="polite">{remainingSeconds} {remainingSeconds === 1 ? 'second' : 'seconds'}</p>
            {renewalError && <p className="error-message" role="alert">{renewalError}</p>}
            <button ref={renewButtonRef} className="button button-primary" type="button" onClick={() => void handleRenewSession()} disabled={isRenewing || renewalUnavailable} aria-busy={isRenewing}>
              {isRenewing ? 'Renewing…' : 'Renew Session'}
            </button>
          </section>
        </div>}
      </main>
    )
  }

  return (
    <main className="auth-page">
      <div className="auth-layout">
        <section className="identity-panel" aria-label="Colorful Life Admin">
          <div className="brand-mark" aria-hidden="true">CL</div>
          <p className="eyebrow">COLORFUL LIFE</p>
          <h1>Admin workspace</h1>
          <p>Product operations, catalogue management and fulfilment in one calm workspace.</p>
          <span className="identity-rule" aria-hidden="true" />
          <p className="identity-note">Built for the people who keep Colorful Life moving.</p>
        </section>
        <section className="login-card" aria-labelledby="login-title">
          <p className="eyebrow">ADMIN ACCESS</p>
          <h2 id="login-title">Sign in to continue</h2>
          <p className="intro">Use an administrator account to continue.</p>
          <form onSubmit={(event) => void handleSubmit(event)}>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <label htmlFor="password">Password</label>
            <div className="password-field">
              <input id="password" type={isPasswordVisible ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
              <button
                className="password-toggle"
                type="button"
                aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
                onClick={() => setIsPasswordVisible((visible) => !visible)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  {isPasswordVisible ? <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A11.3 11.3 0 0 1 12 5c5.2 0 8.6 4.3 9.8 7a16 16 0 0 1-3.1 4.2M6.2 6.2C4.4 7.6 3.2 9.4 2.2 12c1.2 2.7 4.6 7 9.8 7 1.5 0 2.8-.3 4-.8" /> : <><path d="M2.2 12C3.4 9.3 6.8 5 12 5s8.6 4.3 9.8 7c-1.2 2.7-4.6 7-9.8 7s-8.6-4.3-9.8-7Z" /><circle cx="12" cy="12" r="2.5" /></>}
                </svg>
              </button>
            </div>
            {error && <p className="error-message" role="alert">{error}</p>}
            <button className="button button-primary" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'}</button>
          </form>
        </section>
      </div>
    </main>
  )
}

export default App
