import { openSync, closeSync, readSync, fstatSync, realpathSync } from 'node:fs'
import { join, relative, isAbsolute, basename } from 'node:path'
import { homedir } from 'node:os'
import Database from 'better-sqlite3'
import { safeHistoryText } from '../src/lib/secret-scanner.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_TAIL = 2 * 1024 * 1024

// Only a browser-selected chat is read. Paths never come from the server and
// transcript contents never enter the automatic metadata snapshot or logs.
export function collectChatHistory(request, home = homedir(), now = Date.now()) {
  if (!uuid.test(request?.request_id ?? '') || !uuid.test(request?.session_id ?? '')) throw Error('Invalid history request')
  const receipt = { request_id: request.request_id, session_id: request.session_id,
    status: 'unavailable', fetched: new Date(now).toISOString(), messages: [] }
  let fd
  try {
    const db = new Database(join(home, '.codex', 'state_5.sqlite'), { readonly: true, fileMustExist: true, timeout: 2000 })
    let row
    try { row = db.prepare('SELECT rollout_path FROM threads WHERE id = ? AND archived = 0').get(request.session_id) }
    finally { db.close() }
    if (!row?.rollout_path) return receipt
    const root = realpathSync(join(home, '.codex', 'sessions'))
    const file = realpathSync(row.rollout_path)
    const pathWithin = relative(root, file)
    if (!pathWithin || pathWithin.startsWith('..') || isAbsolute(pathWithin) || !basename(file).endsWith(request.session_id + '.jsonl')) return receipt
    fd = openSync(file, 'r')
    const size = fstatSync(fd).size
    const head = Buffer.alloc(Math.min(size, 65536))
    readSync(fd, head, 0, head.length, 0)
    const identity = head.toString('utf8').split('\n').flatMap(line => {
      try { const entry = JSON.parse(line); return entry.type === 'session_meta' ? [entry.payload?.id] : [] } catch { return [] }
    })
    if (!identity.includes(request.session_id)) return receipt
    const start = Math.max(0, size - MAX_TAIL)
    const tail = Buffer.alloc(size - start)
    readSync(fd, tail, 0, tail.length, start)
    const lines = tail.toString('utf8').split('\n')
    if (start) lines.shift() // first line may be incomplete
    for (const line of lines) {
      let entry
      try { entry = JSON.parse(line) } catch { continue }
      const payload = entry.payload
      if (entry.type !== 'response_item' || payload?.type !== 'message' || !['user', 'assistant'].includes(payload.role) || payload.phase === 'analysis') continue
      if (!Array.isArray(payload.content)) continue
      const raw = payload.content.filter(part => ['input_text', 'output_text'].includes(part?.type) && typeof part.text === 'string').map(part => part.text).join('\n')
      const text = safeHistoryText(raw)
      if (!text) continue
      const timestamp = Date.parse(entry.timestamp)
      if (!Number.isFinite(timestamp) || timestamp > now + 60000) continue
      receipt.messages.push({ role: payload.role, timestamp: new Date(timestamp).toISOString(), text })
      if (receipt.messages.length > 40) receipt.messages.shift()
    }
    while (Buffer.byteLength(JSON.stringify(receipt)) > 150000) receipt.messages.shift()
    receipt.status = 'available'
    return receipt
  } catch { return receipt }
  finally { if (fd !== undefined) closeSync(fd) }
}

export async function publishRequestedHistory(requests, base, headers) {
  if (!Array.isArray(requests)) return
  for (const request of requests.slice(0, 5)) {
    const receipt = collectChatHistory(request)
    const response = await fetch(new URL('/api/a360/chat-history', base), {
      method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers, body: JSON.stringify(receipt),
    })
    if (!response.ok) throw Error(`Selected history publish failed (${response.status})`)
    console.log(JSON.stringify({ historyRequest: receipt.request_id, status: receipt.status, messages: receipt.messages.length }))
  }
}
