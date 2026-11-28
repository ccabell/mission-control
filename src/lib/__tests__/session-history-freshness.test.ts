import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'

describe('imported Claude session history', () => {
  it('counts recent events, never stale active flags or future timestamps', () => {
    const db = new Database(':memory:')
    try {
      db.exec(`CREATE TABLE claude_sessions (last_message_at TEXT, is_active INTEGER);
        INSERT INTO claude_sessions VALUES
        (datetime('now', '-2 days'), 1),
        (datetime('now', '-2 minutes'), 0),
        (datetime('now', '+2 days'), 1),
        (NULL, 1);`)
      const route = readFileSync('src/app/api/claude/sessions/route.ts', 'utf8')
      const expression = route.match(/SUM\(CASE WHEN .* END\) as active_sessions/)?.[0]
      expect(expression).toBeTruthy()
      expect(db.prepare(`SELECT ${expression} FROM claude_sessions`).get()).toEqual({ active_sessions: 1 })
    } finally { db.close() }
  })
})
