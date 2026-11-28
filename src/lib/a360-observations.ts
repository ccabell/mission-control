import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { z } from 'zod'

const name = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/)
const date = z.string().datetime({ offset: true })
const status = z.enum(['queued', 'delivering', 'delivered', 'acked', 'done', 'blocked', 'expired', 'stalled', 'undeliverable', 'declined'])
export const observationSchema = z.object({
  schema: z.literal('a360-relay-observations/1'),
  generated: date,
  host: z.literal('windows-primary'),
  lanes: z.array(z.object({
    name, client: z.enum(['claude', 'codex', 'kiro', 'unknown']),
    session_id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).nullable(),
  }).strict()).max(500),
  events: z.array(z.object({
    message_id: z.string().regex(/^M-[0-9]{8}-[0-9]{6}-[a-f0-9]+$/),
    from: name, to: name, status, at: date,
  }).strict()).max(500),
}).strict()
export type Observation = z.infer<typeof observationSchema>

export function validateObservation(input: unknown, now = Date.now()): Observation {
  const snapshot = observationSchema.parse(input)
  const generated = Date.parse(snapshot.generated)
  if (generated > now + 60000 || now - generated > 300000) throw Error('Observation must be generated within five minutes')
  if (snapshot.events.some(event => Date.parse(event.at) > generated + 60000)) throw Error('Observation contains a future event')
  return snapshot
}

function snapshotFile(directory: string, workspaceId: number) {
  if (!Number.isSafeInteger(workspaceId) || workspaceId < 1) throw Error('Invalid workspace')
  return join(directory, `a360-observations-${workspaceId}.json`)
}

export function readObservation(directory: string, workspaceId: number, now = Date.now()) {
  const file = snapshotFile(directory, workspaceId)
  if (!existsSync(file)) return { status: 'Not connected', snapshot: null }
  const snapshot = observationSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  return { status: now - Date.parse(snapshot.generated) > 300000 ? 'Stale' : 'Receiving observations', snapshot }
}

// Reuses the existing activity stream; this creates no task, chat, address or
// runtime connection. A relay 'done' is deliberately not called a shipped task.
export function ingestObservation(db: Database.Database, directory: string, workspaceId: number, snapshot: Observation) {
  const previous = readObservation(directory, workspaceId).snapshot
  if (previous && Date.parse(previous.generated) > Date.parse(snapshot.generated)) throw Error('Older observation refused')
  const file = snapshotFile(directory, workspaceId)
  writeFileSync(file + '.tmp', JSON.stringify(snapshot), { mode: 0o600 })
  renameSync(file + '.tmp', file)
  const seen = db.prepare("SELECT id FROM activities WHERE workspace_id = ? AND type = 'a360_relay_observation' AND json_extract(data, '$.observation_id') = ? LIMIT 1")
  const insert = db.prepare('INSERT INTO activities (type, entity_type, entity_id, actor, description, data, created_at, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  return db.transaction(() => {
    const added: (Record<string, unknown> & { workspace_id: number })[] = []
    for (const event of snapshot.events) {
      const identity = createHash('sha256').update(`${event.message_id}:${event.status}:${event.at}`).digest('hex')
      if (seen.get(workspaceId, identity)) continue
      const actor = ['acked', 'done', 'blocked', 'declined'].includes(event.status) ? event.to : event.from
      const description = `${event.from} → ${event.to}: relay ${event.status} · ${event.message_id}`
      const data = { observation_id: identity, ...event, host: snapshot.host, observation_only: true }
      const created_at = Math.floor(Date.parse(event.at) / 1000)
      const result = insert.run('a360_relay_observation', 'relay', 0, actor, description, JSON.stringify(data), created_at, workspaceId)
      added.push({ id: Number(result.lastInsertRowid), type: 'a360_relay_observation', entity_type: 'relay', entity_id: 0, actor, description, data, created_at, workspace_id: workspaceId })
    }
    return added
  })()
}
