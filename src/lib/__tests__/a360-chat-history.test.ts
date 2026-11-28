import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pendingChatHistory, readChatHistory, requestChatHistory, receiveChatHistory } from '../a360-chat-history'

const id = '01a1c5f1-afad-7102-a637-c4e2a998f1bb'
describe('selected chat history', () => {
  let directory: string
  const now = Date.now()
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'a360-history-')) })
  afterEach(() => { rmSync(directory, { recursive: true }) })
  function receipt(request_id: string) { return { request_id, session_id: id, fetched: new Date(now + 1000).toISOString(), status: 'available',
    messages: [{ role: 'assistant', text: 'Synthetic reply', timestamp: new Date(now).toISOString() }] } }
  it('only queues explicit requests, deduplicates pending requests and isolates workspaces', () => {
    expect(pendingChatHistory(directory, 1, now)).toEqual([])
    const request = requestChatHistory(directory, 1, id, now)
    expect(requestChatHistory(directory, 1, id, now + 5000).request_id).toBe(request.request_id)
    expect(pendingChatHistory(directory, 1, now)).toEqual([{ request_id: request.request_id, session_id: id }])
    expect(readChatHistory(directory, 2, id, now)).toBeNull()
    expect(() => receiveChatHistory(directory, 2, receipt(request.request_id), now + 2000)).toThrow()
  })
  it('requires an exact pending request and fresh receipt, and refuses extras or reasoning', () => {
    const request = requestChatHistory(directory, 1, id, now)
    expect(() => receiveChatHistory(directory, 1, { ...receipt(request.request_id), body: 'private' }, now + 2000)).toThrow()
    expect(() => receiveChatHistory(directory, 1, { ...receipt(request.request_id), session_id: '00000000-0000-4000-8000-000000000000' }, now + 2000)).toThrow()
    expect(() => receiveChatHistory(directory, 1, { ...receipt(request.request_id), messages: [{role:'system', text:'internal'}] }, now + 2000)).toThrow()
    expect(() => receiveChatHistory(directory, 1, receipt(request.request_id), now + 301000)).toThrow()
  })
  it('stores bounded text, withholds credentials before saving and refuses receipt replays', () => {
    const request = requestChatHistory(directory, 1, id, now)
    const value = receipt(request.request_id)
    value.messages[0].text = 'password=synthetic-secret'
    const result = receiveChatHistory(directory, 1, value, now + 2000)
    expect(result.messages[0].text).toBe('[Message withheld: possible secret.]')
    expect(readFileSync(join(directory, 'a360-chat-history-1.json'), 'utf8')).not.toContain('synthetic-secret')
    expect(pendingChatHistory(directory, 1, now + 2000)).toEqual([])
    expect(() => receiveChatHistory(directory, 1, value, now + 3000)).toThrow()
  })
  it('expires unanswered requests and removes expired cached contents on the publisher sweep', () => {
    let request = requestChatHistory(directory, 1, id, now)
    expect(readChatHistory(directory, 1, id, now + 301000)?.status).toBe('expired')
    request = requestChatHistory(directory, 1, id, now + 302000)
    receiveChatHistory(directory, 1, { ...receipt(request.request_id), fetched: new Date(now + 303000).toISOString() }, now + 304000)
    expect(pendingChatHistory(directory, 1, now + 2200000)).toEqual([])
    expect(readFileSync(join(directory, 'a360-chat-history-1.json'), 'utf8')).not.toContain('Synthetic reply')
  })
})
