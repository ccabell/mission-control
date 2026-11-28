import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectObservations } from './publish-a360-observations.mjs'

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
