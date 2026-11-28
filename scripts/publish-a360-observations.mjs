import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { publishRequestedHistory } from './collect-a360-chat-history.mjs'

const validName = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value)
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
const statuses = new Set(['queued', 'delivering', 'delivered', 'acked', 'done', 'blocked', 'expired', 'stalled', 'undeliverable', 'declined'])

// Select fields explicitly. Never spread registry entries, queue records,
// event notes, subjects, message bodies, results or credential configuration.
export function collectObservations(root, now = Date.now()) {
  const registry = JSON.parse(readFileSync(join(root, 'REGISTRY.json'), 'utf8'))
  const lanes = Object.entries(registry.agents || {}).filter(([name]) => validName(name)).map(([name, lane]) => ({
    name, client: ['claude', 'codex', 'kiro'].includes(lane.tool) ? lane.tool : 'unknown',
    session_id: typeof lane.thread === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(lane.thread) ? lane.thread : null,
  })).slice(0, 500)
  const queue = join(root, 'queue')
  const files = readdirSync(queue).filter(name => /^M-[0-9]{8}-[0-9]{6}-[a-f0-9]+\.json$/.test(name))
    .map(name => ({ name, modified: statSync(join(queue, name)).mtimeMs }))
    .filter(file => now - file.modified < 86400000).sort((a, b) => b.modified - a.modified).slice(0, 300)
  const events = []
  for (const file of files) {
    let message
    try { message = JSON.parse(readFileSync(join(queue, file.name), 'utf8')) } catch { continue } // writer may be mid-save
    if (!validName(message.from) || !validName(message.to) || !statuses.has(message.status)) continue
    const latest = [...(Array.isArray(message.events) ? message.events : [])].reverse().find(event => event.status === message.status && validDate(event.at))
    const at = latest?.at ?? message.updated ?? message.created
    if (!validDate(at) || Date.parse(at) > now + 60000 || now - Date.parse(at) > 86400000) continue
    events.push({ message_id: file.name.slice(0, -5), from: message.from, to: message.to, status: message.status, at: new Date(at).toISOString() })
  }
  return { schema: 'a360-relay-observations/1', generated: new Date(now).toISOString(), host: 'windows-primary', lanes, events }
}

export function collectSessionMetadata(home = homedir(), now = Date.now()) {
  const sessions = [], sources = []
  try {
    const db = new Database(join(home, '.codex', 'state_5.sqlite'), {readonly:true, fileMustExist:true, timeout:2000})
    let rows
    try { rows = db.prepare('SELECT id, COALESCE(NULLIF(name, ?), title) AS title, updated_at FROM threads WHERE archived = 0 ORDER BY updated_at DESC LIMIT 100').all('') } finally { db.close() }
    for (const row of rows) {
      if (!validName(row.id) || typeof row.title !== 'string' || !Number.isFinite(row.updated_at)) continue
      const updated = row.updated_at * 1000
      if (updated > now + 60000) continue
      sessions.push({id:row.id, title:row.title.slice(0,200), client:'codex', updated:new Date(updated).toISOString()})
    }
    sources.push({ client: 'codex', checked: new Date(now).toISOString(), status: 'read' })
  } catch { sources.push({ client: 'codex', checked: null, status: 'unavailable' }) }
  try {
    const root = join(home, '.claude', 'projects'), rows = []
    for (const dir of readdirSync(root, {withFileTypes:true}).filter(d => d.isDirectory())) {
      for (const file of readdirSync(join(root,dir.name)).filter(f => /^[a-zA-Z0-9_-]+\.jsonl$/.test(f))) {
        const updated = statSync(join(root,dir.name,file)).mtimeMs
        if (updated <= now + 60000) rows.push({id:file.slice(0,-6), title:file.slice(0,-6), client:'claude', updated:new Date(updated).toISOString()})
      }
    }
    sessions.push(...rows.sort((a,b) => Date.parse(b.updated)-Date.parse(a.updated)).slice(0,100))
    sources.push({ client:'claude', checked:new Date(now).toISOString(), status:'read' })
  } catch { sources.push({client:'claude', checked:null, status:'unavailable'}) }
  return {sessions, sources}
}

export async function publishObservations() {
  const base = process.env.A360_BUILDERZ_URL || 'https://builderz-production.up.railway.app'
  if (new URL(base).protocol !== 'https:') throw Error('HTTPS required')
  if (!process.env.API_KEY) throw Error('Builderz API_KEY unavailable')
  const snapshot = collectObservations(process.env.A360_RELAY_ROOT || 'C:/Projects/A360_Hub/coordination/relay')
  // Enable only after the receiving schema has shipped. Existing scheduled task stays unchanged.
  if (existsSync(resolve('.data/session-metadata-enabled'))) Object.assign(snapshot, collectSessionMetadata())
  const response = await fetch(new URL('/api/a360/observations', base), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.API_KEY, Origin: new URL(base).origin },
    body: JSON.stringify(snapshot),
  })
  if (!response.ok) throw Error(`Observation publish failed (${response.status})`)
  const result = await response.json()
  console.log(JSON.stringify({ published: true, lanes: result.lanes, newActivities: result.added, generated: result.generated, mode: result.mode }))
  await publishRequestedHistory(result.historyRequests, base, { 'Content-Type': 'application/json', 'x-api-key': process.env.API_KEY, Origin: new URL(base).origin })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  publishObservations().catch(error => { console.error(error.message); process.exitCode = 1 })
}
