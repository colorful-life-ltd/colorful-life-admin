import { useEffect, useState } from 'react'
import type { ConnectionMode, ConnectionStatus } from '../electron/connection-contract'
import { adminConnection } from './admin-api'

const PRODUCTION_TITLE = 'PRODUCTION — Build & Bloom Admin'

/** Persistent, non-dismissible identification of the Production environment. */
function ProductionBanner() {
  return <div className="production-banner" role="note" aria-label="Production environment">
    <strong>PRODUCTION</strong> <span>Live store: real customers, orders and money.</span>
  </div>
}

/** A mode of null means it was never reported: show a neutral failure, never assume Sandbox. */
type PanelStatus = Omit<ConnectionStatus, 'mode'> & { mode: ConnectionMode | null }

export default function ConnectionPanel({ onReady }: { onReady: (ready: boolean) => void }) {
  const [status, setStatus] = useState<PanelStatus | null>(null)
  // A status or retry failure keeps the last reported mode: never assume Sandbox (no silent fallback).
  const failWith = (message: string) => setStatus(previous => ({ mode: previous?.mode ?? null, state: 'failed', message }))
  useEffect(() => {
    if (!window.adminConnection) return
    let active = true
    const poll = async () => {
      try {
        const next = await adminConnection.status()
        if (active) { setStatus(next); onReady(next.state === 'connected') }
      } catch { if (active) { onReady(false); failWith('Connection status is unavailable. Restart Admin.') } }
    }
    void poll(); const timer = setInterval(() => { void poll() }, 1000)
    return () => { active = false; clearInterval(timer) }
  }, [onReady])
  const production = status?.mode === 'remote-production'
  useEffect(() => {
    if (!production) return
    const previous = document.title
    document.title = PRODUCTION_TITLE
    return () => { document.title = previous }
  }, [production])
  if (!window.adminConnection || status?.mode === 'direct') return null
  const state = status?.state ?? 'connecting'
  const banner = production ? <ProductionBanner /> : null
  if (state === 'connected') return banner
  if (state === 'awaiting-confirmation') return <>{banner}
    <aside className="connection-panel connection-panel-compact connection-panel-production" aria-label="Backend connection">
      <p role="status">This Admin is configured for the <strong>Production</strong> store. Nothing is sent until you connect.</p>
      <button className="button button-primary" type="button" onClick={() => {
        onReady(false)
        void adminConnection.confirmProduction().then(next => { setStatus(next); onReady(next.state === 'connected') }, () => failWith('Production connection could not start. Restart Admin.'))
      }}>Connect to Production</button>
    </aside></>
  if (state === 'connecting') return <>{banner}<aside className="connection-panel connection-panel-compact" aria-label="Backend connection">
    <p role="status">{production ? 'Connecting to the Production Backend…' : 'Connecting to the Backend…'}</p>
  </aside></>
  return <>{banner}<aside className="connection-panel connection-panel-compact connection-panel-failed" aria-label="Backend connection">
    <p role="alert"><strong>Connection Failed.</strong> {status?.message}</p>
    <button className="button button-secondary" type="button" onClick={() => {
      setStatus(previous => ({ mode: previous?.mode ?? null, state: 'connecting', message: 'Connecting securely to the Backend…' })); onReady(false)
      void adminConnection.retry().then(next => { setStatus(next); onReady(next.state === 'connected') }, () => failWith('Connection retry failed. Restart Admin.'))
    }}>Retry Connection</button>
  </aside></>
}
