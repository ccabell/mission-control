// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const prepare = resolve('scripts/prepare-standalone-artifact.mjs')
const check = resolve('scripts/check-standalone-artifact.mjs')
let fixture: string
function put(relative: string, content = 'synthetic') {
  const target = join(fixture, relative)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}
function run(script: string) {
  return spawnSync(process.execPath, [script], { cwd: fixture, encoding: 'utf8' })
}
beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'mc-browser-artifact-'))
  for (const file of ['server.js', 'openapi.json', 'ops/templates/openclaw-gateway@.service', 'src/lib/schema.sql']) {
    put(`.next/standalone/${file}`)
  }
  put('.next/static/chunks/app.js', 'browser javascript')
  put('.next/static/css/app.css', 'browser stylesheet')
  put('public/brand/mc-logo-128.png', 'browser logo')
})
afterEach(() => {
  // Only remove the exact synthetic directory created by this test.
  if (dirname(fixture) !== resolve(tmpdir()) || !fixture.startsWith(join(tmpdir(), 'mc-browser-artifact-'))) throw new Error('Unexpected fixture path')
  rmSync(fixture, { recursive: true, force: true })
})
describe('standalone browser assets', () => {
  it('packages JavaScript, CSS and public files for any launcher', () => {
    expect(run(prepare).status).toBe(0)
    expect(readFileSync(join(fixture, '.next/standalone/.next/static/chunks/app.js'), 'utf8')).toBe('browser javascript')
    expect(run(check).status).toBe(0)
  })
  it.each(['.next/static/chunks/app.js', '.next/static/css/app.css', 'public/brand/mc-logo-128.png'])('rejects a release missing %s', missing => {
    expect(run(prepare).status).toBe(0)
    unlinkSync(join(fixture, '.next/standalone', missing))
    const result = run(check)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('missing')
  })
})
