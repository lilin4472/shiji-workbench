import { describe, expect, it, vi } from 'vitest'
import { createOfficialDshClientFactory } from './dsh-sdk-client'

describe('official DSH SDK facade', () => {
  it('reuses one initialized official client and delegates each task to HarnessSession', async () => {
    const start = vi.fn()
    const initialize = vi.fn(async () => ({ serverInfo: { name: 'runtime', version: '1' } }))
    const close = vi.fn(async () => {})
    const run = vi.fn(async () => ({ finalResponse: '{"opportunities":[]}' }))
    const HarnessClient = vi.fn(function () { return { start, initialize, close } })
    const HarnessSession = vi.fn(function () { return { run } })
    const factory = createOfficialDshClientFactory({ HarnessClient, HarnessSession })
    const client = factory({ command: 'electron.exe', args: ['runtime.js'], env: {} })

    client.start()
    await client.initialize({ cwd: 'C:\\workspace', provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    await client.run?.('prompt', { sessionId: 'task-1' })
    await client.close()

    expect(HarnessClient).toHaveBeenCalledOnce()
    expect(HarnessSession).toHaveBeenCalledWith(expect.objectContaining({ client: expect.any(Object) }), 'task-1')
    expect(run).toHaveBeenCalledWith('prompt', { onNotification: undefined })
    expect(close).toHaveBeenCalledOnce()
  })
})
