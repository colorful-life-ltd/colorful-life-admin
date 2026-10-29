import { validateBackendUrl } from './backend-url.js'
export type ConnectionConfig = {
  mode: 'direct' | 'remote-sandbox'; backendUrl: string; profile: string; region: string;
  instance: string; localPort: number; remotePort: number; awsPath?: string; pluginPath?: string;
}
export function connectionConfig(env: NodeJS.ProcessEnv): ConnectionConfig {
  const mode = env.COLORFUL_LIFE_CONNECTION_MODE ?? 'direct'
  const invalid = () => new Error('Invalid Admin connection configuration. Use direct or remote-sandbox mode and a matching loopback Backend URL.')
  if (mode !== 'direct' && mode !== 'remote-sandbox') throw invalid()
  const port = (value: string | undefined, fallback: number) => {
    if (value === undefined) return fallback
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw invalid()
    return Number(value)
  }
  const localPort = port(env.COLORFUL_LIFE_SSM_LOCAL_PORT, 3000)
  const backendUrl = validateBackendUrl(env.COLORFUL_LIFE_BACKEND_URL ?? `http://localhost:${mode === 'remote-sandbox' ? localPort : 3000}`)
  const profile = env.COLORFUL_LIFE_AWS_PROFILE ?? 'colorful-life-admin'
  const region = env.COLORFUL_LIFE_AWS_REGION ?? 'eu-west-2'
  const instance = env.COLORFUL_LIFE_SSM_INSTANCE ?? 'i-02b28336518077a8f'
  if (mode === 'remote-sandbox') {
    const url = new URL(backendUrl)
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || Number(url.port || 80) !== localPort || url.pathname !== '/') throw invalid()
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(profile) || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region) || !/^i-[a-f0-9]{8,17}$/.test(instance)) throw invalid()
  }
  return { mode, backendUrl, profile, region, instance, localPort, remotePort: port(env.COLORFUL_LIFE_SSM_REMOTE_PORT, 3001), awsPath: env.COLORFUL_LIFE_AWS_CLI_PATH, pluginPath: env.COLORFUL_LIFE_SSM_PLUGIN_PATH }
}
