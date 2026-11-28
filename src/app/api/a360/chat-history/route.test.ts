import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
const state = vi.hoisted(() => ({ directory: '', role: 'operator', workspace: 1, fresh: true }))
vi.mock('@/lib/config', () => ({ config: { get dataDir() { return state.directory } } }))
vi.mock('@/lib/auth', () => ({ requireRole: (_request: unknown, role: string) => state.role === 'none'
  ? { error: 'Authentication required', status: 401 }
  : state.role === 'viewer' && role === 'operator' ? { error: 'Operator required', status: 403 }
  : { user: { workspace_id: state.workspace } } }))
const id = '01a1c5f1-afad-7102-a637-c4e2a998f1bb'
vi.mock('@/lib/a360-observations', () => ({ readObservation: () => ({ status: state.fresh ? 'Receiving observations' : 'Stale', snapshot: { sessions: [{ client: 'codex', id: '01a1c5f1-afad-7102-a637-c4e2a998f1bb' }] } }) }))
import { GET, POST, PUT } from './route'
function request(method: string, body?: unknown, query = '') { return new NextRequest('https://example.test/api/a360/chat-history' + query, {
  method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
}) }
beforeEach(() => { state.directory = mkdtempSync(join(tmpdir(), 'a360-history-route-')); state.role = 'operator'; state.workspace = 1; state.fresh = true })
afterEach(() => rmSync(state.directory, { recursive: true }))
describe('selected Codex history API', () => {
  it('requires sign-in for every method and an operator for requests and uploads', async () => {
    state.role = 'none'
    expect((await GET(request('GET', undefined, '?id=' + id))).status).toBe(401)
    expect((await POST(request('POST', {session_id:id}))).status).toBe(401)
    expect((await PUT(request('PUT', {}))).status).toBe(401)
    state.role = 'viewer'
    expect((await POST(request('POST', {session_id:id}))).status).toBe(403)
    expect((await PUT(request('PUT', {}))).status).toBe(403)
  })
  it('rejects stale sources, arbitrary IDs, extra fields and path traversal', async () => {
    state.fresh = false
    expect((await POST(request('POST', {session_id:id}))).status).toBe(409)
    state.fresh = true
    expect((await POST(request('POST', {session_id:'00000000-0000-4000-8000-000000000000'}))).status).toBe(409)
    expect((await POST(request('POST', {session_id:id,path:'private'}))).status).toBe(400)
    expect((await GET(request('GET', undefined, '?id=../secret'))).status).toBe(400)
  })
  it('round-trips only the selected receipt, caches nothing publicly and isolates its workspace', async () => {
    const accepted = await POST(request('POST', {session_id:id}))
    expect(accepted.status).toBe(202)
    const {history} = await accepted.json()
    const receipt = {session_id:id, request_id:history.request_id, fetched:new Date().toISOString(), status:'available', messages:[{role:'assistant', text:'Synthetic result'}]}
    expect((await PUT(request('PUT',receipt))).status).toBe(200)
    const read = await GET(request('GET',undefined,'?id='+id))
    expect(read.headers.get('Cache-Control')).toBe('no-store')
    expect((await read.json()).history.messages[0].text).toBe('Synthetic result')
    state.workspace = 2
    expect((await (await GET(request('GET',undefined,'?id='+id))).json()).history).toBeNull()
    expect((await PUT(request('PUT',receipt))).status).toBe(409)
  })
})
