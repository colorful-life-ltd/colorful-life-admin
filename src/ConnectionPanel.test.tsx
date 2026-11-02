import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ConnectionPanel from './ConnectionPanel'
afterEach(() => { cleanup(); delete window.adminConnection })

const description = 'mode=remote-sandbox target=http://localhost:3000 -> SSM i-02b28336518077a8f:3001 (profile colorful-life-admin, eu-west-2) chosen by default (no override)'

it('shows a compact failure with Retry, then no banner once the connection is healthy', async () => {
  const ready = vi.fn()
  window.adminConnection = { status: vi.fn().mockResolvedValue({ mode:'remote-sandbox',state:'failed',message:'AWS credentials expired.',description }), retry: vi.fn().mockResolvedValue({ mode:'remote-sandbox',state:'connected',message:'Secure Backend connection is ready.',description }) }
  render(<ConnectionPanel onReady={ready} />)
  expect(screen.getByRole('status')).toHaveTextContent('Connecting to the Backend…')
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection Failed. AWS credentials expired.')
  expect(ready).toHaveBeenCalledWith(false)
  expect(screen.queryByText(/i-02b28336518077a8f|colorful-life-admin|localhost|eu-west-2/)).not.toBeInTheDocument()
  window.adminConnection.status = vi.fn().mockResolvedValue({ mode:'remote-sandbox',state:'connected',message:'Secure Backend connection is ready.',description })
  fireEvent.click(screen.getByRole('button',{name:'Retry Connection'}))
  await waitFor(() => expect(ready).toHaveBeenCalledWith(true))
  await waitFor(() => expect(screen.queryByLabelText('Backend connection')).not.toBeInTheDocument())
  expect(screen.queryByText(/Connected|Secure Backend connection is ready/)).not.toBeInTheDocument()
  expect(window.adminConnection.retry).toHaveBeenCalledTimes(1)
})

it('renders nothing for a healthy tunnel or direct connection and never shows technical identifiers', async () => {
  for (const mode of ['remote-sandbox', 'direct'] as const) {
    const ready = vi.fn()
    window.adminConnection = { status: vi.fn().mockResolvedValue({ mode,state:'connected',message:'Secure Backend connection is ready.',description }), retry: vi.fn() }
    const { unmount } = render(<ConnectionPanel onReady={ready} />)
    await waitFor(() => expect(ready).toHaveBeenCalledWith(true))
    expect(screen.queryByLabelText('Backend connection')).not.toBeInTheDocument()
    expect(screen.queryByText(description)).not.toBeInTheDocument()
    unmount()
  }
})

it('surfaces a later disconnect as a compact actionable failure', async () => {
  const ready = vi.fn()
  const status = vi.fn().mockResolvedValue({ mode:'remote-sandbox',state:'connected',message:'Secure Backend connection is ready.',description })
  window.adminConnection = { status, retry: vi.fn() }
  render(<ConnectionPanel onReady={ready} />)
  await waitFor(() => expect(ready).toHaveBeenCalledWith(true))
  status.mockResolvedValue({ mode:'remote-sandbox',state:'failed',message:'The Backend connection was lost. Retry Connection to reconnect.',description })
  expect(await screen.findByRole('alert', {}, { timeout: 2500 })).toHaveTextContent('The Backend connection was lost.')
  expect(screen.getByRole('button',{name:'Retry Connection'})).toBeInTheDocument()
  expect(ready).toHaveBeenLastCalledWith(false)
})
