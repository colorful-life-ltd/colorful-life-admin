import { afterEach, expect, it, vi } from 'vitest'
import type { stat } from 'node:fs/promises'
const io = { stat: vi.fn(), access: vi.fn() }
import { discoverTools } from '../electron/ssm-process'
import { connectionConfig } from '../electron/connection-config'
afterEach(() => vi.resetAllMocks())
it('discovers Windows MSI installations and adds only the plugin directory to the child PATH', async () => {
  io.stat.mockResolvedValue({ isFile: () => true } as Awaited<ReturnType<typeof stat>>)
  io.access.mockResolvedValue(undefined)
  const env = { Path: 'C:\\Windows\\System32', PATH: 'ignored', ProgramFiles: 'C:\\Program Files' }
  const tools = await discoverTools(connectionConfig({ COLORFUL_LIFE_CONNECTION_MODE:'remote-sandbox' }), env, 'win32', io)
  expect(tools.aws).toBe('C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe')
  expect(tools.env.Path).toBe('C:\\Program Files\\Amazon\\SessionManagerPlugin\\bin;C:\\Windows\\System32')
  expect(tools.env.PATH).toBeUndefined(); expect(env.PATH).toBe('ignored'); expect(env.Path).toBe('C:\\Windows\\System32')
})
it('reports missing AWS CLI and never tries a default profile', async () => {
  io.stat.mockRejectedValue(new Error('raw sensitive path'))
  await expect(discoverTools(connectionConfig({}), {}, 'win32', io)).rejects.toThrow('AWS CLI is missing')
})
it('reports missing plugin separately', async () => {
  io.stat.mockImplementation(async path => { if (String(path).endsWith('aws.exe')) return { isFile: () => true } as Awaited<ReturnType<typeof stat>>; throw Error('private') })
  io.access.mockResolvedValue(undefined)
  await expect(discoverTools(connectionConfig({}), {}, 'win32', io)).rejects.toThrow('Session Manager Plugin is missing')
})
