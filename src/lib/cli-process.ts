import { spawn } from 'node:child_process'

const processState = globalThis as typeof globalThis & {
  __mcCliRuns?: Map<string, { stop: () => void; closed: Promise<void> }>
}
const runs = processState.__mcCliRuns ??= new Map()

export async function stopCliRun(key: string): Promise<boolean> {
  const run = runs.get(key)
  if (!run) return false
  run.stop()
  await run.closed
  return true
}

/** A bounded, shell-free CLI run. Stop the entire owned tree, including Windows shims. */
export function runCliProcess(command: string, args: string[], options: {
  input: string
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs: number
  maxOutputBytes: number
  shouldContinue?: () => boolean
  runKey?: string
}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.runKey && runs.has(options.runKey)) {
      reject(new Error('A local run is already active for this session'))
      return
    }
    const child = spawn(command, args, {
      cwd: options.cwd, env: options.env, stdio: 'pipe',
      detached: process.platform !== 'win32', windowsHide: true,
    })
    let stdout = ''
    let outputBytes = 0
    let failure: Error | undefined
    let closed = false
    let stopping = false
    const stop = (error: Error) => {
      if (closed || stopping) return
      stopping = true
      failure = error
      if (!child.pid) return
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore', windowsHide: true,
        })
        killer.on('error', () => child.kill('SIGKILL'))
        killer.on('close', code => { if (code !== 0 && !closed) child.kill('SIGKILL') })
      } else {
        try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
      }
    }
    const timeout = setTimeout(() => stop(new Error(`CLI timed out after ${options.timeoutMs}ms`)), options.timeoutMs)
    const poll = options.shouldContinue ? setInterval(() => {
      try {
        if (!options.shouldContinue!()) stop(new Error('CLI run cancelled: task changed or was deleted'))
      } catch {
        stop(new Error('CLI run stopped: task state could not be verified'))
      }
    }, 500) : undefined
    const cleanup = () => {
      closed = true
      clearTimeout(timeout)
      if (poll) clearInterval(poll)
      if (options.runKey) runs.delete(options.runKey)
      release()
    }
    let release: () => void = () => {}
    const completion = new Promise<void>(resolveClosed => { release = resolveClosed })
    if (options.runKey) runs.set(options.runKey, {
      stop: () => stop(new Error('CLI run cancelled by operator')), closed: completion,
    })
    const collect = (chunk: Buffer, isStdout: boolean) => {
      if (stopping) return
      outputBytes += chunk.length
      if (outputBytes > options.maxOutputBytes) {
        stop(new Error(`CLI output exceeded ${options.maxOutputBytes} bytes`))
      } else if (isStdout) stdout += chunk.toString()
    }
    child.stdout.on('data', (chunk: Buffer) => collect(chunk, true))
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, false))
    child.stdin.on('error', () => stop(new Error('CLI input stream failed')))
    child.on('error', () => {
      cleanup()
      reject(new Error('CLI could not be started; check executable and permissions'))
    })
    child.on('close', (code) => {
      cleanup()
      if (failure) reject(failure)
      else if (code !== 0) reject(new Error(`CLI exited with code ${code}`))
      else resolve(stdout)
    })
    child.stdin.end(options.input)
  })
}
