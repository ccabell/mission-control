import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ read: vi.fn(() => []) }))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, default: { ...actual, readdirSync: mocks.read }, readdirSync: mocks.read }
})
vi.mock('@/lib/config', () => ({ config: { claudeHome: 'synthetic' } }))
vi.mock('@/lib/db', () => ({ getDatabase: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))
import { syncClaudeSessions } from '@/lib/claude-sessions'

describe('Claude history refresh', () => {
  it('coalesces concurrent forced scans and permits another after completion', async () => {
    const first = syncClaudeSessions(true)
    const second = syncClaudeSessions(true)
    expect(second).toBe(first)
    expect(await first).toEqual({ ok: true, message: 'No Claude sessions found' })
    expect(mocks.read).toHaveBeenCalledTimes(1)
    await syncClaudeSessions()
    expect(mocks.read).toHaveBeenCalledTimes(1)
    await syncClaudeSessions(true)
    expect(mocks.read).toHaveBeenCalledTimes(2)
  })
})
