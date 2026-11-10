import { validateBackendUrl } from './backend-url.js'
export const SANDBOX_BACKEND_URL = 'https://build-and-bloom.co.uk/api'
/** Fixed loopback API ports on the shared EC2 host. Production's is reserved: no other mode may use it. */
export const SANDBOX_REMOTE_PORT = 3001
export const PRODUCTION_REMOTE_PORT = 3002
/** Production's local tunnel port is fixed too, so its Backend URL (which scopes the operator and
 *  shipment journals) can never equal a Sandbox or direct-development URL. */
export const PRODUCTION_LOCAL_PORT = 3002
export type ConnectionModeSource = 'COLORFUL_LIFE_CONNECTION_MODE' | 'COLORFUL_LIFE_BACKEND_URL' | 'default'
export type ConnectionConfig = {
  mode: 'direct' | 'remote-sandbox' | 'remote-production'; backendUrl: string; profile: string; region: string;
  /** Which setting chose the mode, for diagnostics (never a value). */
  modeSource: ConnectionModeSource;
  instance: string; localPort: number; remotePort: number; awsPath?: string; pluginPath?: string;
}
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]']
export function connectionConfig(env: NodeJS.ProcessEnv): ConnectionConfig {
  // The Admin API is reachable only through the owner's SSM tunnel; the public Sandbox Nginx
  // allow-lists just storefront, login, returns and bootstrap routes. A local Backend URL keeps direct mode.
  // Production is never a default: it requires COLORFUL_LIFE_CONNECTION_MODE=remote-production.
  const mode = env.COLORFUL_LIFE_CONNECTION_MODE ?? (env.COLORFUL_LIFE_BACKEND_URL ? 'direct' : 'remote-sandbox')
  const invalid = () => new Error('Invalid Admin connection configuration. Use direct, remote-sandbox or remote-production mode with its fixed ports and a matching loopback Backend URL.')
  if (mode !== 'direct' && mode !== 'remote-sandbox' && mode !== 'remote-production') throw invalid()
  const port = (value: string | undefined, fallback: number) => {
    if (value === undefined) return fallback
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw invalid()
    return Number(value)
  }
  const production = mode === 'remote-production'
  const localPort = port(env.COLORFUL_LIFE_SSM_LOCAL_PORT, production ? PRODUCTION_LOCAL_PORT : 3000)
  const remotePort = port(env.COLORFUL_LIFE_SSM_REMOTE_PORT, production ? PRODUCTION_REMOTE_PORT : SANDBOX_REMOTE_PORT)
  if (production ? remotePort !== PRODUCTION_REMOTE_PORT || localPort !== PRODUCTION_LOCAL_PORT
    : remotePort === PRODUCTION_REMOTE_PORT || localPort === PRODUCTION_LOCAL_PORT) throw invalid()
  const remote = mode !== 'direct'
  const backendUrl = validateBackendUrl(env.COLORFUL_LIFE_BACKEND_URL ?? (remote ? `http://localhost:${localPort}` : SANDBOX_BACKEND_URL))
  const profile = env.COLORFUL_LIFE_AWS_PROFILE ?? 'colorful-life-admin'
  const region = env.COLORFUL_LIFE_AWS_REGION ?? 'eu-west-2'
  const instance = env.COLORFUL_LIFE_SSM_INSTANCE ?? 'i-02b28336518077a8f'
  if (remote) {
    const url = new URL(backendUrl)
    if (url.protocol !== 'http:' || !LOOPBACK.includes(url.hostname) || Number(url.port || 80) !== localPort || url.pathname !== '/') throw invalid()
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(profile) || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region) || !/^i-[a-f0-9]{8,17}$/.test(instance)) throw invalid()
  }
  // Direct mode may use the published Sandbox API or a local developer backend.
  // Reject arbitrary remote hosts so a local Admin build cannot silently target Production,
  // and the loopback port reserved for the Production tunnel.
  if (mode === 'direct' && env.COLORFUL_LIFE_BACKEND_URL) {
    const url = new URL(backendUrl)
    const local = LOOPBACK.includes(url.hostname) && url.protocol === 'http:' && Number(url.port || 80) !== PRODUCTION_LOCAL_PORT
    if (!local && backendUrl !== SANDBOX_BACKEND_URL) throw invalid()
  }
  const modeSource: ConnectionModeSource = env.COLORFUL_LIFE_CONNECTION_MODE !== undefined ? 'COLORFUL_LIFE_CONNECTION_MODE' : env.COLORFUL_LIFE_BACKEND_URL ? 'COLORFUL_LIFE_BACKEND_URL' : 'default'
  return { mode, modeSource, backendUrl, profile, region, instance, localPort, remotePort, awsPath: env.COLORFUL_LIFE_AWS_CLI_PATH, pluginPath: env.COLORFUL_LIFE_SSM_PLUGIN_PATH }
}

/** Credential-free one-line description of the effective connection, safe to log and display. */
export function describeConnection(config: ConnectionConfig): string {
  const target = config.mode !== 'direct'
    ? `${config.backendUrl} -> SSM ${config.instance}:${config.remotePort} (profile ${config.profile}, ${config.region})`
    : config.backendUrl
  return `mode=${config.mode} target=${target} chosen by ${config.modeSource === 'default' ? 'default (no override)' : config.modeSource}`
}
