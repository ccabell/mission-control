// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const state = vi.hoisted(() => ({ home: '', read: vi.fn() }))
vi.mock('fs', async importOriginal => {
  const actual = await importOriginal<typeof import('fs')>()
  state.read.mockImplementation(actual.readFileSync)
  return { ...actual, default: { ...actual, readFileSync: state.read }, readFileSync: state.read }
})
vi.mock('@/lib/config', () => ({ config: { get homeDir() { return state.home } } }))
import { scanCodexSessions } from '@/lib/codex-sessions'
afterEach(() => {
  vi.useRealTimers()
  // This test owns the exact directory returned by mkdtempSync.
  if (state.home) rmSync(state.home, { recursive: true, force: true })
})
describe('Codex transcript cache', () => {
  it('reads unchanged files once, expires activity, refreshes changes and removes deleted sessions', () => {
    state.home = mkdtempSync(join(tmpdir(), 'mc-codex-cache-'))
    const root = join(state.home, '.codex', 'sessions')
    mkdirSync(root, { recursive: true })
    const file = join(root, 'synthetic.jsonl')
    const entry = (id: string) => JSON.stringify({ type: 'session_meta', timestamp: new Date().toISOString(), payload: { id, cwd: state.home } })
    writeFileSync(file, entry('first'))
    state.read.mockClear()
    expect(scanCodexSessions()[0]).toMatchObject({ sessionId: 'first', isActive: true })
    expect(scanCodexSessions()[0].sessionId).toBe('first')
    expect(state.read).toHaveBeenCalledTimes(1)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000)
    expect(scanCodexSessions()[0].isActive).toBe(false)
    expect(state.read).toHaveBeenCalledTimes(1)
    writeFileSync(file, entry('changed-session'))
    expect(scanCodexSessions()[0].sessionId).toBe('changed-session')
    expect(state.read).toHaveBeenCalledTimes(2)
    rmSync(file)
    expect(scanCodexSessions()).toEqual([])
  })
})
