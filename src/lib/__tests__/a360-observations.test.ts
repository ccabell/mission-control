import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ingestObservation, readObservation, validateObservation, registeredCodexSessions, observedCodexSessions } from '../a360-observations'

describe('A360 relay observations', () => {
  let directory: string
  let db: Database.Database
  const now = Date.now()
  const payload = () => ({ schema: 'a360-relay-observations/1', generated: new Date(now).toISOString(), host: 'windows-primary',
    lanes: [{ name: 'test-lane', client: 'codex', session_id: 'synthetic-chat-id' }],
    events: [{ message_id: 'M-20261127-220003-c63cfb', from: 'test-sender', to: 'test-lane', status: 'done', at: new Date(now - 30000).toISOString() }] })
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'a360-observations-'))
    db = new Database(':memory:')
    db.exec('CREATE TABLE activities (id INTEGER PRIMARY KEY, type TEXT, entity_type TEXT, entity_id INTEGER, actor TEXT, description TEXT, data TEXT, created_at INTEGER, workspace_id INTEGER)')
  })
  afterEach(() => { db.close(); rmSync(directory, { recursive: true }) })
  it('shows Codex identities without treating registry membership or fresh snapshots as live activity', () => {
    const snapshot = validateObservation(payload(), now)
    snapshot.lanes.push({ name: 'claude-only', client: 'claude', session_id: 'other-id' })
    snapshot.lanes.push({ name: 'missing-chat', client: 'codex', session_id: null })
    const sessions = registeredCodexSessions(snapshot)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ id: 'registered-synthetic-chat-id', key: 'test-lane', active: false, lastActivity: 0, source: 'relay-registration' })
    expect(sessions[0].lastUserPrompt).toContain('transcript not synced')
    expect(registeredCodexSessions(null)).toEqual([])
  })
  it('keeps metadata dates and original identities without claiming liveness or duplicating registrations', () => {
    const snapshot = validateObservation({...payload(), sessions:[{id:'synthetic-chat-id', title:'Synthetic chat', client:'codex', updated:new Date(now-600000).toISOString()}], sources:[{client:'codex', checked:new Date(now).toISOString(), status:'read'}]}, now)
    const rows = observedCodexSessions(snapshot)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({id:'metadata-synthetic-chat-id', key:'Synthetic chat', active:false, lastActivity:now-600000})
    expect(() => validateObservation({...snapshot, sessions:[{...snapshot.sessions![0], body:'private'}]},now)).toThrow()
    expect(() => validateObservation({...snapshot, sessions:[{...snapshot.sessions![0], updated:new Date(now+61000).toISOString()}]},now)).toThrow()
  })
  it('preserves actual event time, deduplicates across requests and scopes both data and dedup to workspace', () => {
    const snapshot = validateObservation(payload(), now)
    expect(ingestObservation(db, directory, 1, snapshot)).toHaveLength(1)
    expect(ingestObservation(db, directory, 1, snapshot)).toHaveLength(0)
    expect(ingestObservation(db, directory, 2, snapshot)).toHaveLength(1)
    const row = db.prepare('SELECT * FROM activities WHERE workspace_id = 1').get() as Record<string, unknown>
    expect(row.created_at).toBe(Math.floor((now - 30000) / 1000))
    expect(row.description).toContain('relay done')
    expect(row.description).not.toContain('task completed')
    expect(readObservation(directory, 3, now).status).toBe('Not connected')
    expect(readObservation(directory, 1, now + 301000).status).toBe('Stale')
  })
  it('rejects arbitrary payload fields, bodies, stale/future snapshots and future events', () => {
    expect(() => validateObservation({ ...payload(), body: 'do not upload' }, now)).toThrow()
    const bad = payload(); Object.assign(bad.events[0], { result: 'do not upload' })
    expect(() => validateObservation(bad, now)).toThrow()
    expect(() => validateObservation({ ...payload(), generated: new Date(now - 301000).toISOString() }, now)).toThrow()
    expect(() => validateObservation({ ...payload(), generated: new Date(now + 61000).toISOString() }, now)).toThrow()
    const future = payload(); future.events[0].at = new Date(now + 61000).toISOString()
    expect(() => validateObservation(future, now)).toThrow()
  })
  it('refuses out-of-order snapshots without overwriting the latest feed', () => {
    ingestObservation(db, directory, 1, validateObservation(payload(), now))
    const older = validateObservation({ ...payload(), generated: new Date(now - 1000).toISOString() }, now)
    expect(() => ingestObservation(db, directory, 1, older)).toThrow('Older observation refused')
    expect(readObservation(directory, 1, now).snapshot?.generated).toBe(payload().generated)
  })
})
