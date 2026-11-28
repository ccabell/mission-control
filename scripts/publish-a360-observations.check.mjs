import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { collectSessionMetadata, collectObservations } from './publish-a360-observations.mjs'

test('publisher exports allowlisted metadata, never bodies, roles, notes, results or config', () => {
  const root = mkdtempSync(join(tmpdir(), 'a360-publisher-'))
  try {
    mkdirSync(join(root, 'queue'))
    writeFileSync(join(root, 'REGISTRY.json'), JSON.stringify({ agents: { 'test-lane': { tool: 'codex', thread: 'synthetic-thread', role: 'private-role', config: 'private-config' } } }))
    const at = new Date().toISOString()
    writeFileSync(join(root, 'queue', 'M-20261127-220003-c63cfb.json'), JSON.stringify({ from: 'test-sender', to: 'test-lane', status: 'done', body: 'private-body', result: 'private-result', subject: 'private-subject', events: [{ at, status: 'done', note: 'private-note' }] }))
    const snapshot = collectObservations(root)
    assert.equal(snapshot.events.length, 1)
    assert.equal(snapshot.lanes.length, 1)
    assert.equal(JSON.stringify(snapshot).includes('private-'), false)
    assert.equal(snapshot.events[0].at, at)
  } finally { rmSync(root, { recursive: true }) }
})

test('session metadata excludes archives and contents, preserves times, and reports source failures', () => {
 const root = mkdtempSync(join(tmpdir(), 'a360-metadata-'))
 try {
  const missing = collectSessionMetadata(root)
  assert.ok(missing.sources.every(s => s.status === 'unavailable' && s.checked === null))
  mkdirSync(join(root,'.codex'))
  const db = new Database(join(root,'.codex','state_5.sqlite'))
  db.exec('CREATE TABLE threads (id TEXT, name TEXT, title TEXT, updated_at INTEGER, archived INTEGER, first_user_message TEXT)')
  db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)').run('test-id','Named chat','Fallback',1000,0,'private-content')
  db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)').run('archived-id','Archived','Fallback',1001,1,'private-content')
  db.close()
  const first = collectSessionMetadata(root,2000000), later = collectSessionMetadata(root,2100000)
  assert.equal(first.sessions.length,1)
  assert.equal(first.sessions[0].title,'Named chat')
  assert.equal(first.sessions[0].updated,later.sessions[0].updated)
  assert.ok(!JSON.stringify(first).includes('private-content'))
  assert.notEqual(first.sources[0].checked,later.sources[0].checked)
 } finally {rmSync(root,{recursive:true})}
})
