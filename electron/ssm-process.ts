import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ConnectionConfig } from './connection-config.js'

export interface OwnedTunnel {
  onOutput(listener: (text: string) => void): void
  onExit(listener: () => void): void
  stop(): Promise<void>
}
export async function discoverTools(config: ConnectionConfig, env = process.env, platform = process.platform, io = { stat, access }) {
  const pathApi = platform === 'win32' ? win32 : { join, dirname, isAbsolute }
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') ?? 'PATH'
  const paths = (env[pathKey] ?? '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean)
  const programs = [env.ProgramW6432, env.ProgramFiles, 'C:\\Program Files'].filter((p): p is string => !!p)
  async function locate(override: string | undefined, candidates: string[], message: string) {
    if (override && !pathApi.isAbsolute(override)) throw new Error(message)
    for (const candidate of override ? [override] : candidates) {
      try { if ((await io.stat(candidate)).isFile()) { await io.access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK); return candidate } } catch { /* continue discovery without leaking paths */ }
    }
    throw new Error(message)
  }
  const awsName = platform === 'win32' ? 'aws.exe' : 'aws'
  const pluginName = platform === 'win32' ? 'session-manager-plugin.exe' : 'session-manager-plugin'
  const aws = await locate(config.awsPath, [...programs.map(p => pathApi.join(p, 'Amazon', 'AWSCLIV2', awsName)), ...paths.map(p => pathApi.join(p, awsName))], 'AWS CLI is missing. Install AWS CLI v2 or configure its executable path.')
  const plugin = await locate(config.pluginPath, [...programs.map(p => pathApi.join(p, 'Amazon', 'SessionManagerPlugin', 'bin', pluginName)), ...paths.map(p => pathApi.join(p, pluginName))], 'Session Manager Plugin is missing. Install it or configure its executable path.')
  const childEnv = { ...env }
  for (const key of Object.keys(childEnv)) if (key.toLowerCase() === 'path') delete childEnv[key]
  childEnv[pathKey] = [pathApi.dirname(plugin), ...paths].join(platform === 'win32' ? ';' : delimiter)
  childEnv.AWS_PAGER = ''; childEnv.AWS_CLI_AUTO_PROMPT = 'off'
  return { aws, env: childEnv }
}

function closed(child: ChildProcessWithoutNullStreams, timeout = 5000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.removeListener('close', done); reject(new Error('Tunnel cleanup timed out. Close Admin and retry.')) }, timeout)
    const done = () => { clearTimeout(timer); resolve() }
    child.once('close', done)
  })
}
function waitLine(child: ChildProcessWithoutNullStreams, expected: string, timeout = 12000) {
  return new Promise<void>((resolve, reject) => {
    let text = ''
    const cleanup = () => { clearTimeout(timer); child.stdout.removeListener('data', data); child.removeListener('close', fail); child.removeListener('error', fail) }
    const fail = () => { cleanup(); reject(new Error('Windows tunnel supervision failed. Check PowerShell availability and application permissions.')) }
    const data = (chunk: Buffer) => { text = (text + chunk.toString()).slice(-2048); if (text.split(/\r?\n/).includes(expected)) { cleanup(); resolve() } }
    const timer = setTimeout(fail, timeout)
    child.stdout.on('data', data); child.once('close', fail); child.once('error', fail)
  })
}
export async function spawnOwnedTunnel(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<OwnedTunnel> {
  let supervisor: ChildProcessWithoutNullStreams | undefined
  let child: ChildProcessWithoutNullStreams | undefined
  const output = new Set<(text: string) => void>(), exits = new Set<() => void>()
  let buffer = '', ended = false, stopping: Promise<void> | undefined
  const exited = () => { if (!ended) { ended = true; for (const listener of exits) listener() } }
  try {
    if (process.platform === 'win32') {
      const script = fileURLToPath(new URL('./ssm-job.ps1', import.meta.url)).replace('app.asar\\', 'app.asar.unpacked\\')
      supervisor = spawn(join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { env, windowsHide: true, shell: false, stdio: 'pipe' })
      supervisor.stdin.on('error', () => undefined); supervisor.stderr.resume()
      await waitLine(supervisor, 'JOB_READY')
    }
    const startedAfter = Date.now()
    child = spawn(command, args, { env, windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: 'pipe' })
    child.stdin.on('error', () => undefined)
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk: Buffer) => { const text = chunk.toString(); buffer = (buffer + text).slice(-8192); for (const listener of output) listener(text) })
    child.once('error', exited); child.once('close', exited)
    if (supervisor) {
      const attached = waitLine(supervisor, 'OWNED')
      supervisor.stdin.write(JSON.stringify({ pid: child.pid, startedAfter }) + '\n')
      await attached
      supervisor.once('close', exited)
    }
    const ownedChild = child, ownedSupervisor = supervisor
    return {
      onOutput(listener) { output.add(listener); if (buffer) listener(buffer) },
      onExit(listener) { exits.add(listener); if (ended) listener() },
      stop() {
        return stopping ??= (async () => {
          if (ownedSupervisor) {
            ownedSupervisor.stdin.end()
            try { await closed(ownedSupervisor) } catch { ownedSupervisor.kill(); await closed(ownedSupervisor) }
          } else if (ownedChild.pid) {
            try { process.kill(-ownedChild.pid, 'SIGTERM') } catch { /* already exited */ }
          }
          await closed(ownedChild)
          output.clear(); exits.clear()
        })()
      },
    }
  } catch {
    if (supervisor) { supervisor.stdin.end(); supervisor.kill() }
    if (child) child.kill()
    throw new Error('Unable to start the owned AWS tunnel. Check AWS CLI and Windows process supervision.')
  }
}
