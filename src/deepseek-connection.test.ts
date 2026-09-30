import { describe, expect, it, vi } from 'vitest'
import { testDeepSeekConnection } from '../electron/deepseek-connection'

describe('testDeepSeekConnection', () => {
  it('uses bearer authentication and accepts the official model list shape', async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'deepseek-v4-flash' }] }), { status: 200 }))
    const result = await testDeepSeekConnection('sk-secret', mockFetch as typeof fetch)

    expect(result).toMatchObject({ connected: true, modelCount: 1 })
    expect(mockFetch).toHaveBeenCalledWith('https://api.deepseek.com/models', expect.objectContaining({
      method: 'GET',
      headers: { Authorization: 'Bearer sk-secret' },
    }))
  })

  it('returns a controlled message for an invalid key without exposing the response body', async () => {
    const mockFetch = vi.fn(async () => new Response('provider-secret-detail', { status: 401 }))
    await expect(testDeepSeekConnection('sk-secret', mockFetch as typeof fetch)).rejects.toThrow('Key 无效')
    await expect(testDeepSeekConnection('sk-secret', mockFetch as typeof fetch)).rejects.not.toThrow('provider-secret-detail')
  })

  it('rejects an unexpected success payload', async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ result: true }), { status: 200 }))
    await expect(testDeepSeekConnection('sk-secret', mockFetch as typeof fetch)).rejects.toThrow('无法识别')
  })
})
