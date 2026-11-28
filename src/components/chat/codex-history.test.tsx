import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ apiFetch: mocks.api }))
import { CodexHistory } from './codex-history'
const sessionId = '01a1c5f1-afad-7102-a637-c4e2a998f1bb'
beforeEach(() => mocks.api.mockReset())
afterEach(cleanup)
describe('Codex selected history', () => {
  it('does not request or upload history just because a chat is opened', async () => {
    mocks.api.mockResolvedValue({history:null})
    render(<CodexHistory sessionId={sessionId} />)
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1))
    expect(mocks.api).toHaveBeenCalledWith('/api/a360/chat-history?id=' + sessionId)
    expect(screen.getByRole('button', {name:'Load recent history'})).toBeEnabled()
    expect(screen.getByText(/Only this selected chat is read/)).toBeInTheDocument()
  })
  it('loads the selected chat only after a click and shows a dated saved result', async () => {
    mocks.api.mockResolvedValueOnce({history:null})
    mocks.api.mockResolvedValueOnce({history:{status:'available',fetched:'2026-11-28T12:00:00Z',expires:new Date(Date.now()+60000).toISOString(), messages:[{role:'assistant',text:'Synthetic visible result'}]}})
    render(<CodexHistory sessionId={sessionId} />)
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button',{name:'Load recent history'}))
    await waitFor(() => expect(screen.getByText('Synthetic visible result')).toBeInTheDocument())
    expect(mocks.api).toHaveBeenLastCalledWith('/api/a360/chat-history', {method:'POST',body:JSON.stringify({session_id:sessionId})})
    expect(screen.getByRole('status')).toHaveTextContent('does not prove the agent is running')
  })
  it('distinguishes expired delivery from empty or successful history', async () => {
    mocks.api.mockResolvedValue({history:{status:'expired',expires:new Date(Date.now()+60000).toISOString(),messages:[]}})
    render(<CodexHistory sessionId={sessionId} />)
    expect(await screen.findByRole('status')).toHaveTextContent('did not return history within five minutes')
    expect(screen.getByRole('button',{name:'Load recent history'})).toBeEnabled()
  })
})
