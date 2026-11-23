import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ run: vi.fn(), stop: vi.fn(), gateway: vi.fn(), denied: false }))
vi.mock('@/lib/auth', () => ({ requireRole: () => ({ user: { role: 'operator', username: 'tester', workspace_id: 7 } }) }))
vi.mock('@/lib/workspace-isolation', () => ({ denyUnscopedResourceForStrictWorkspace: () => mocks.denied ? new Response(null, { status: 403 }) : null }))
vi.mock('@/lib/cli-process', () => ({ runCliProcess: mocks.run, stopCliRun: mocks.stop }))
vi.mock('@/lib/openclaw-gateway', () => ({ callOpenClawGateway: mocks.gateway }))
vi.mock('@/lib/db', () => ({ db_helpers: { logActivity: vi.fn() } }))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: () => null }))
import { promises as fs } from 'node:fs'
import { POST as continueSession } from '../continue/route'
import { POST as controlSession } from '../[id]/control/route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.denied = false
  mocks.run.mockImplementation(async (_command, args) => {
    const outputIndex = args.indexOf('-o')
    if (outputIndex >= 0) await fs.writeFile(args[outputIndex + 1], 'Codex reply')
    return 'Claude reply'
  })
  mocks.stop.mockResolvedValue(true)
})
function request(body: unknown) {
  return new Request('http://localhost/api/sessions/continue', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as any
}
describe('local session controls', () => {
  it('continues Claude directly with stdin and an owned cancellation key', async () => {
    const response = await continueSession(request({ kind: 'claude-code', id: 'synthetic-session', prompt: 'follow up' }))
    expect(response.status).toBe(200)
    expect(mocks.run).toHaveBeenCalledWith(expect.any(String), ['--print', '--resume', 'synthetic-session'],
      expect.objectContaining({ input: 'follow up', runKey: '7:synthetic-session', maxOutputBytes: 1_000_000 }))
  })
  it('keeps Codex prompt off argv and returns the output file', async () => {
    const response = await continueSession(request({ kind: 'codex-cli', id: 'synthetic-session', prompt: 'follow up' }))
    expect(response.status).toBe(200)
    expect(mocks.run).toHaveBeenCalledWith(expect.any(String),
      ['exec', 'resume', 'synthetic-session', '-', '--skip-git-repo-check', '-o', expect.any(String)],
      expect.objectContaining({ input: 'follow up', runKey: '7:synthetic-session' }))
    expect(await response.json()).toEqual({ ok: true, reply: 'Codex reply' })
  })
  it('does not retry a failed resume as a fresh conversation', async () => {
    mocks.run.mockRejectedValue(new Error('CLI exited with code 1'))
    const response = await continueSession(request({ kind: 'claude-code', id: 'synthetic-session', prompt: 'follow up' }))
    expect(response.status).toBe(500)
    expect(mocks.run).toHaveBeenCalledTimes(1)
  })
  it('terminates an owned local session before considering the gateway', async () => {
    const response = await controlSession(request({ action: 'terminate' }), { params: Promise.resolve({ id: 'synthetic-session' }) })
    expect(response.status).toBe(200)
    expect(mocks.stop).toHaveBeenCalledWith('7:synthetic-session')
    expect(mocks.gateway).not.toHaveBeenCalled()
  })
  it('honors isolation denial before touching local runs', async () => {
    mocks.denied = true
    const response = await controlSession(request({ action: 'terminate' }), { params: Promise.resolve({ id: 'synthetic-session' }) })
    expect(response.status).toBe(403)
    expect(mocks.stop).not.toHaveBeenCalled()
  })
})
