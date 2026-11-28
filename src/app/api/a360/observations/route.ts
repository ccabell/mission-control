import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { config } from '@/lib/config'
import { eventBus } from '@/lib/event-bus'
import { ingestObservation, readObservation, validateObservation } from '@/lib/a360-observations'
import { pendingChatHistory } from '@/lib/a360-chat-history'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    return NextResponse.json(readObservation(config.dataDir, auth.user.workspace_id ?? 1), { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Observation feed unavailable' }, { status: 503 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  let snapshot
  try {
    const text = await request.text()
    if (Buffer.byteLength(text) > 262144) return NextResponse.json({ error: 'Observation too large' }, { status: 413 })
    snapshot = validateObservation(JSON.parse(text))
  } catch {
    return NextResponse.json({ error: 'Expected fresh metadata-only observation' }, { status: 400 })
  }
  try {
    const added = ingestObservation(getDatabase(), config.dataDir, auth.user.workspace_id ?? 1, snapshot)
    for (const activity of added) eventBus.broadcast('activity.created', activity)
    return NextResponse.json({ generated: snapshot.generated, lanes: snapshot.lanes.length, added: added.length, mode: 'observation-only', historyRequests: pendingChatHistory(config.dataDir, auth.user.workspace_id ?? 1) })
  } catch {
    return NextResponse.json({ error: 'Observation could not be persisted; older snapshots are refused' }, { status: 409 })
  }
}
