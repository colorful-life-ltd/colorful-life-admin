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
it('shows direct mode and its target without SSM status or retry, so an unexpected mode is never silent', async () => {
  const ready=vi.fn()
  const description='mode=direct target=https://build-and-bloom.co.uk/api chosen by COLORFUL_LIFE_BACKEND_URL'
  window.adminConnection = { status: vi.fn().mockResolvedValue({mode:'direct',state:'connected',message:'Direct connection configured.',description}),retry:vi.fn() }
  render(<ConnectionPanel onReady={ready} />)
  await waitFor(()=>expect(ready).toHaveBeenCalledWith(true))
  expect(await screen.findByText(description)).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Direct connection (no SSM tunnel)')
  expect(screen.queryByRole('button',{name:'Retry Connection'})).not.toBeInTheDocument()
})
