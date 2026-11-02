import { useEffect, useState } from 'react'
import type { ConnectionStatus } from '../electron/connection-contract'
import { adminConnection } from './admin-api'
export default function ConnectionPanel({ onReady }: { onReady: (ready: boolean) => void }) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  useEffect(() => {
    if (!window.adminConnection) return
    let active = true
    const poll = async () => {
      try {
        const next = await adminConnection.status()
        if (active) { setStatus(next); onReady(next.state === 'connected') }
      } catch { if (active) { onReady(false); setStatus({ mode: 'remote-sandbox', state: 'failed', message: 'Connection status is unavailable. Restart Admin.' }) } }
    }
    void poll(); const timer = setInterval(() => { void poll() }, 1000)
    return () => { active = false; clearInterval(timer) }
  }, [onReady])
  // A healthy connection needs no banner; technical details (mode, target, instance, profile)
  // stay in the development terminal log. Only progress and actionable failures are shown.
  if (!window.adminConnection || status?.mode === 'direct' || status?.state === 'connected') return null
  const state = status?.state ?? 'connecting'
  if (state === 'connecting') return <aside className="connection-panel connection-panel-compact" aria-label="Backend connection">
    <p role="status">Connecting to the Backend…</p>
  </aside>
  return <aside className="connection-panel connection-panel-compact connection-panel-failed" aria-label="Backend connection">
    <p role="alert"><strong>Connection Failed.</strong> {status?.message}</p>
    <button className="button button-secondary" type="button" onClick={() => {
      setStatus({ mode: 'remote-sandbox', state: 'connecting', message: 'Connecting securely to the Backend…' }); onReady(false)
      void adminConnection.retry().then(next => { setStatus(next); onReady(next.state === 'connected') }, () => setStatus({ mode: 'remote-sandbox', state: 'failed', message: 'Connection retry failed. Restart Admin.' }))
    }}>Retry Connection</button>
  </aside>
}
