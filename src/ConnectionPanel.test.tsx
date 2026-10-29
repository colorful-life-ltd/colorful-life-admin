import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ConnectionPanel from './ConnectionPanel'
afterEach(() => { cleanup(); delete window.adminConnection })
it('shows connecting/failed status and an explicit retry without account authorization changes', async () => {
  const ready = vi.fn()
  window.adminConnection = { status: vi.fn().mockResolvedValue({ mode:'remote-sandbox',state:'failed',message:'AWS credentials expired.' }), retry: vi.fn().mockResolvedValue({ mode:'remote-sandbox',state:'connected',message:'Secure Backend connection is ready.' }) }
  render(<ConnectionPanel onReady={ready} />)
  expect(screen.getByRole('status')).toHaveTextContent('Connecting')
  await screen.findByText('Connection Failed'); expect(ready).toHaveBeenCalledWith(false)
  fireEvent.click(screen.getByRole('button',{name:'Retry Connection'}))
  await screen.findByText('Connected'); expect(ready).toHaveBeenCalledWith(true)
  expect(window.adminConnection.retry).toHaveBeenCalledTimes(1)
})
it('keeps direct development mode free of an SSM banner', async () => {
  const ready=vi.fn()
  window.adminConnection = { status: vi.fn().mockResolvedValue({mode:'direct',state:'connected',message:'Direct connection configured.'}),retry:vi.fn() }
  render(<ConnectionPanel onReady={ready} />)
  await waitFor(()=>expect(ready).toHaveBeenCalledWith(true));expect(screen.queryByLabelText('Backend connection')).not.toBeInTheDocument()
})
