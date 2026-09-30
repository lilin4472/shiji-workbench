import { describe, expect, it, vi } from 'vitest'
import { createDshGovernmentFetchProbe } from './dsh-fetch-provider'

describe('DSH static HTTP fetch probe', () => {
  it('retrieves and converts only an allowlisted government page', async () => {
    const fetch = vi.fn(async () => ({
      url: 'https://www.example.gov.cn/tender/1',
      statusCode: 200,
      body: { kind: 'html', content: '<h1>招标公告</h1>' },
      truncated: false,
    }))
    const Provider = vi.fn(class { fetch = fetch })
    const probe = createDshGovernmentFetchProbe(async () => ({ HttpFetchProvider: Provider }))

    const result = await probe('https://www.example.gov.cn/tender/1')

    expect(fetch).toHaveBeenCalledWith({ url: 'https://www.example.gov.cn/tender/1' }, expect.any(AbortSignal))
    expect(result).toMatchObject({ statusCode: 200, content: '<h1>招标公告</h1>', sourceClass: 'government' })
  })

  it.each(['http://127.0.0.1/admin', 'https://example.com/page', 'http://test.gov.cn/page'])('rejects unsafe or non-government URL %s before loading the plugin', async (url) => {
    const loadProvider = vi.fn()
    const probe = createDshGovernmentFetchProbe(loadProvider)
    await expect(probe(url)).rejects.toThrow('政府公开网页')
    expect(loadProvider).not.toHaveBeenCalled()
  })
})
