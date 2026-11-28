import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { readObservation } from '@/lib/a360-observations'
import { chatId, readChatHistory, requestChatHistory, receiveChatHistory } from '@/lib/a360-chat-history'

const headers = { 'Cache-Control': 'no-store' }
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status, headers })
  const id = chatId.safeParse(new URL(request.url).searchParams.get('id'))
  if (!id.success) return NextResponse.json({ error: 'Valid Codex chat ID required' }, { status: 400, headers })
  return NextResponse.json({ history: readChatHistory(config.dataDir, auth.user.workspace_id ?? 1, id.data) }, { headers })
}
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status, headers })
  const body = await request.text()
  if (body.length > 200) return NextResponse.json({ error: 'Request too large' }, { status: 413, headers })
  let id
  try { const value = JSON.parse(body); if (Object.keys(value).some(key => key !== 'session_id')) throw Error(); id = chatId.parse(value.session_id) }
  catch { return NextResponse.json({ error: 'Expected only a Codex session_id' }, { status: 400, headers }) }
  const workspace = auth.user.workspace_id ?? 1
  const feed = readObservation(config.dataDir, workspace)
  if (feed.status !== 'Receiving observations' || !feed.snapshot?.sessions?.some(row => row.client === 'codex' && row.id === id)) {
    return NextResponse.json({ error: 'This chat is not in the fresh Windows Codex index. Wait for the publisher to reconnect.' }, { status: 409, headers })
  }
  try { return NextResponse.json({ history: requestChatHistory(config.dataDir, workspace, id) }, { status: 202, headers }) }
  catch { return NextResponse.json({ error: 'History requests are busy; wait for the Windows publisher.' }, { status: 429, headers }) }
}
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status, headers })
  const body = await request.text()
  if (Buffer.byteLength(body) > 180000) return NextResponse.json({ error: 'History receipt too large' }, { status: 413, headers })
  try {
    const history = receiveChatHistory(config.dataDir, auth.user.workspace_id ?? 1, JSON.parse(body))
    return NextResponse.json({ status: history.status, request_id: history.request_id }, { headers })
  } catch { return NextResponse.json({ error: 'Receipt must match a fresh pending history request' }, { status: 409, headers }) }
}
