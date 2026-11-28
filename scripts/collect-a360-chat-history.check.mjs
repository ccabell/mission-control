import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { collectChatHistory } from './collect-a360-chat-history.mjs'

const session_id = '00000000-0000-4000-8000-000000000001'
const request_id = '00000000-0000-4000-8000-000000000002'
test('selected history preserves public messages and withholds tools, reasoning, credentials and other chats', () => {
 const home = mkdtempSync(join(tmpdir(), 'a360-history-publisher-'))
 try {
  const root = join(home, '.codex', 'sessions')
  mkdirSync(root, { recursive: true })
  const file = join(root, `rollout-${session_id}.jsonl`)
  const entry = (role, text, phase) => ({timestamp:'2026-11-28T12:00:00Z',type:'response_item',payload:{type:'message',role,phase,content:[{type:'output_text',text}]}})
  writeFileSync(file, [
   {type:'session_meta',payload:{id:session_id}},
   entry('user','Synthetic question'), entry('assistant','Synthetic reply','final_answer'),
   entry('assistant','private-reasoning','analysis'), entry('developer','private-instructions'),
   {type:'response_item',payload:{type:'function_call_output',output:'private-tool-result'}},
   entry('assistant','password=synthetic-secret'),
  ].map(row=>JSON.stringify(row)).join('\n'))
  const db = new Database(join(home,'.codex','state_5.sqlite'))
  db.exec('CREATE TABLE threads (id TEXT, rollout_path TEXT, archived INTEGER)')
  db.prepare('INSERT INTO threads VALUES (?, ?, ?)').run(session_id,file,0)
  const result = collectChatHistory({session_id,request_id},home)
  assert.equal(result.status,'available')
  assert.equal(result.messages.length,3)
  assert.equal(result.messages[0].text,'Synthetic question')
  for (const hidden of ['private-reasoning','private-instructions','private-tool-result','synthetic-secret']) assert.ok(!JSON.stringify(result).includes(hidden))
  db.prepare('UPDATE threads SET archived = 1').run()
  assert.equal(collectChatHistory({session_id,request_id},home).status,'unavailable')
  db.prepare('UPDATE threads SET archived = 0, rollout_path = ?').run(join(home, 'outside.jsonl'))
  writeFileSync(join(home,'outside.jsonl'),'private-outside')
  assert.equal(collectChatHistory({session_id,request_id},home).status,'unavailable')
  db.close()
 } finally { rmSync(home,{recursive:true}) }
})
