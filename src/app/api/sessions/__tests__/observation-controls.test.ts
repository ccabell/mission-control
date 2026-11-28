import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ run: vi.fn(), stop: vi.fn(), gateway: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: () => ({user:{workspace_id:1}}) }))
vi.mock('@/lib/a360-mode', () => ({ A360_OBSERVATION_MODE: true }))
vi.mock('@/lib/cli-process', () => ({ runCliProcess:mocks.run, stopCliRun:mocks.stop }))
vi.mock('@/lib/openclaw-gateway', () => ({ callOpenClawGateway:mocks.gateway }))
import { POST as resume } from '../continue/route'
import { POST as control } from '../[id]/control/route'
describe('hosted observation controls', () => {
  it('refuses both resume and control before executing a CLI or contacting a gateway', async () => {
    const body = {kind:'codex-cli',id:'synthetic',prompt:'do not execute',action:'terminate'}
    const request = () => new NextRequest('https://example.test/api/sessions/continue', {method:'POST',body:JSON.stringify(body)})
    expect((await resume(request())).status).toBe(409)
    expect((await control(request(),{params:Promise.resolve({id:'synthetic'})})).status).toBe(409)
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.stop).not.toHaveBeenCalled(); expect(mocks.gateway).not.toHaveBeenCalled()
  })
})
