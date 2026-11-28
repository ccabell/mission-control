import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { safeHistoryText } from './secret-scanner'

export const chatId = z.string().uuid()
const iso = z.string().datetime({ offset: true })
export const historyReceiptSchema = z.object({
  request_id: z.string().uuid(), session_id: chatId,
  status: z.enum(['available', 'unavailable']), fetched: iso,
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']), timestamp: iso.optional(),
    text: z.string().min(1).max(4000),
  }).strict()).max(40),
}).strict()
const recordSchema = historyReceiptSchema.extend({
  status: z.enum(['requested', 'available', 'unavailable', 'expired']), requested: iso, expires: iso,
})
export type ChatHistory = z.infer<typeof recordSchema>
export type HistoryReceipt = z.infer<typeof historyReceiptSchema>
const TTL = 30 * 60 * 1000
const WAIT = 5 * 60 * 1000

function filePath(directory: string, workspace: number) {
  if (!Number.isSafeInteger(workspace) || workspace < 1) throw Error('Invalid workspace')
  return join(directory, `a360-chat-history-${workspace}.json`)
}
function records(directory: string, workspace: number, now: number): ChatHistory[] {
  const file = filePath(directory, workspace)
  if (!existsSync(file)) return []
  const stored = z.array(recordSchema).max(10).parse(JSON.parse(readFileSync(file, 'utf8')))
  const current = stored
    .filter(row => Date.parse(row.expires) > now)
    .map(row => row.status === 'requested' && now - Date.parse(row.requested) > WAIT
      ? { ...row, status: 'expired' as const, messages: [] } : row)
  // The existing minute publisher also calls this: expired excerpts leave the
  // active cache even when nobody opens the chat again.
  if (JSON.stringify(stored) !== JSON.stringify(current)) save(directory, workspace, current)
  return current
}
function save(directory: string, workspace: number, rows: ChatHistory[]) {
  const file = filePath(directory, workspace)
  writeFileSync(file + '.tmp', JSON.stringify(rows), { mode: 0o600 })
  renameSync(file + '.tmp', file)
}
export function readChatHistory(directory: string, workspace: number, id: string, now = Date.now()) {
  return records(directory, workspace, now).find(row => row.session_id === id) ?? null
}
export function requestChatHistory(directory: string, workspace: number, id: string, now = Date.now()) {
  chatId.parse(id)
  const rows = records(directory, workspace, now)
  const current = rows.find(row => row.session_id === id)
  if (current?.status === 'requested' || (current && now - Date.parse(current.requested) < 30000)) return current
  if (rows.filter(row => row.status === 'requested').length >= 5) throw Error('Five requests already pending; wait for the Windows publisher')
  const row: ChatHistory = { request_id: randomUUID(), session_id: id, status: 'requested',
    requested: new Date(now).toISOString(), fetched: new Date(now).toISOString(), expires: new Date(now + TTL).toISOString(), messages: [] }
  save(directory, workspace, [row, ...rows.filter(r => r.session_id !== id)].slice(0, 10))
  return row
}
export function pendingChatHistory(directory: string, workspace: number, now = Date.now()) {
  return records(directory, workspace, now).filter(row => row.status === 'requested')
    .map(row => ({ request_id: row.request_id, session_id: row.session_id }))
}
export function receiveChatHistory(directory: string, workspace: number, input: unknown, now = Date.now()) {
  const receipt = historyReceiptSchema.parse(input)
  const rows = records(directory, workspace, now)
  const index = rows.findIndex(row => row.request_id === receipt.request_id && row.session_id === receipt.session_id && row.status === 'requested')
  if (index < 0) throw Error('No matching pending request')
  const fetched = Date.parse(receipt.fetched)
  if (now - fetched > WAIT || fetched > now + 60000 || fetched < Date.parse(rows[index].requested) - 60000) throw Error('Receipt is not fresh')
  if (receipt.status === 'unavailable' && receipt.messages.length) throw Error('Unavailable history cannot contain messages')
  if (receipt.messages.some(m => m.timestamp && Date.parse(m.timestamp) > fetched + 60000)) throw Error('Future message')
  rows[index] = { ...rows[index], ...receipt, messages: receipt.messages.map(message => ({ ...message, text: safeHistoryText(message.text) })) }
  save(directory, workspace, rows)
  return rows[index]
}
