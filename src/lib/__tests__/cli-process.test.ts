// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { runCliProcess, stopCliRun } from '../cli-process'
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs'
import path from 'node:path'

const defaults = { input: '', timeoutMs: 5000, maxOutputBytes: 1024 }

describe('bounded CLI processes', () => {
  it('sends stdin and returns stdout from a real process', async () => {
    await expect(runCliProcess(process.execPath, ['-e', "process.stdin.on('data', d => process.stdout.write(d))"], {
      ...defaults, input: 'synthetic task',
    })).resolves.toBe('synthetic task')
  })

  it('rejects nonzero exit even when the process wrote a plausible result', async () => {
    await expect(runCliProcess(process.execPath, ['-e', "console.log('partial result'); process.exit(1)"], defaults))
      .rejects.toThrow('code 1')
  })

  it('bounds combined stdout and stderr', async () => {
    await expect(runCliProcess(process.execPath, ['-e', "process.stdout.write('a'.repeat(600)); process.stderr.write('b'.repeat(600)); setInterval(()=>{},1000)"], defaults))
      .rejects.toThrow('output exceeded')
  })

  it('kills a timed out process', async () => {
    await expect(runCliProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      ...defaults, timeoutMs: 300,
    })).rejects.toThrow('timed out')
  })

  it('kills descendants as well as the immediate CLI process', async () => {
    const directory = mkdtempSync(path.join(process.cwd(), '.cli-process-test-'))
    const pidFile = path.join(directory, 'child.pid')
    let descendant: number | undefined
    try {
      const script = `const {spawn}=require('node:child_process'); const fs=require('node:fs');
        const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
        fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid)); setInterval(()=>{},1000)`
      await expect(runCliProcess(process.execPath, ['-e', script], {
        ...defaults, timeoutMs: 1500,
      })).rejects.toThrow('timed out')
      descendant = Number(readFileSync(pidFile, 'utf8'))
      expect(() => process.kill(descendant!, 0)).toThrow()
    } finally {
      if (descendant) { try { process.kill(descendant, 'SIGKILL') } catch { /* already stopped */ } }
      try { unlinkSync(pidFile) } catch { /* no pid file */ }
      rmdirSync(directory)
    }
  })

  it('stops when the owning task changes', async () => {
    await expect(runCliProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      ...defaults, shouldContinue: () => false,
    })).rejects.toThrow('cancelled')
  })

  it('lets the operator stop an owned session and waits for process exit', async () => {
    const run = runCliProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      ...defaults, runKey: '1:synthetic-session',
    })
    const assertion = expect(run).rejects.toThrow('cancelled by operator')
    expect(await stopCliRun('2:synthetic-session')).toBe(false)
    expect(await stopCliRun('1:synthetic-session')).toBe(true)
    await assertion
    expect(await stopCliRun('1:synthetic-session')).toBe(false)
  })

  it('prevents overlapping writes to the same session', async () => {
    const options = { ...defaults, runKey: '1:exclusive-session' }
    const run = runCliProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], options)
    const assertion = expect(run).rejects.toThrow('cancelled')
    await expect(runCliProcess(process.execPath, ['-e', ''], options)).rejects.toThrow('already active')
    await stopCliRun(options.runKey)
    await assertion
  })

  it('fails closed when task state cannot be read', async () => {
    await expect(runCliProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      ...defaults, shouldContinue: () => { throw new Error('database unavailable') },
    })).rejects.toThrow('could not be verified')
  })

  it('does not expose CLI output through errors', async () => {
    await expect(runCliProcess(process.execPath, ['-e', "console.error('synthetic-private-value'); process.exit(1)"], defaults))
      .rejects.toThrow(/^CLI exited with code 1$/)
  })
})
