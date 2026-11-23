// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ db: null as unknown as Database.Database, gateway: vi.fn() }))
vi.mock('../db', () => ({ getDatabase: () => state.db, db_helpers: { logActivity: vi.fn() } }))
vi.mock('../openclaw-gateway', () => ({ callOpenClawGateway: state.gateway }))
vi.mock('../event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
import { runAegisReviews } from '../task-dispatch'

beforeEach(() => {
  state.gateway.mockReset()
  state.db = new Database(':memory:')
  state.db.exec(`
    CREATE TABLE workspaces(id INTEGER PRIMARY KEY, isolation TEXT);
    INSERT INTO workspaces VALUES(1, 'shared');
    CREATE TABLE projects(id INTEGER, workspace_id INTEGER, ticket_prefix TEXT);
    CREATE TABLE agents(name TEXT, workspace_id INTEGER, config TEXT);
    CREATE TABLE gateways(status TEXT);
    INSERT INTO gateways VALUES('healthy');
    CREATE TABLE tasks(id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT,
      priority TEXT, resolution TEXT, assigned_to TEXT, workspace_id INTEGER,
      project_id INTEGER, project_ticket_no INTEGER, updated_at INTEGER, dispatch_attempts INTEGER,
      error_message TEXT);
    INSERT INTO tasks VALUES(1,'Synthetic task',NULL,'review','medium','Result','builder',1,NULL,NULL,0,0,NULL);
  `)
})
afterEach(() => state.db.close())

describe('review lifecycle', () => {
  it('stops retrying after three transport failures', async () => {
    state.gateway.mockRejectedValue(new Error('synthetic gateway unavailable'))
    for (let attempt = 0; attempt < 4; attempt++) await runAegisReviews()
    expect(state.gateway).toHaveBeenCalledTimes(3)
    expect(state.db.prepare('SELECT status, dispatch_attempts FROM tasks').get()).toEqual({ status: 'failed', dispatch_attempts: 3 })
  })

  it('does not restore review state after the user moves the task', async () => {
    state.gateway.mockImplementation(async () => {
      state.db.prepare("UPDATE tasks SET status = 'inbox'").run()
      throw new Error('synthetic interruption')
    })
    await runAegisReviews()
    expect(state.db.prepare('SELECT status, dispatch_attempts FROM tasks').get()).toEqual({ status: 'inbox', dispatch_attempts: 0 })
  })

  it('claims a review once across concurrent invocations', async () => {
    state.gateway.mockRejectedValue(new Error('synthetic failure'))
    await Promise.all([runAegisReviews(), runAegisReviews()])
    expect(state.gateway).toHaveBeenCalledTimes(1)
  })
})
