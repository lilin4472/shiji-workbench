import { describe, expect, it, vi } from 'vitest'
import { testTiandituServerConnection, testTiandituWebConnection } from './tianditu-connection.js'

describe('Tianditu connection', () => {
  it('checks one fixed public address and returns validated coordinates', async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify({
      status: '0', msg: 'ok', location: { lon: 116.4039, lat: 39.9151 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const result = await testTiandituServerConnection('test-key', fetchImplementation as typeof fetch)

    expect(fetchImplementation).toHaveBeenCalledOnce()
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain('api.tianditu.gov.cn/geocoder')
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain('tk=test-key')
    expect(result).toMatchObject({ connected: true, longitude: 116.4039, latitude: 39.9151 })
  })

  it('rejects an unsuccessful or malformed response', async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify({ status: '1', msg: 'invalid tk' }), { status: 200 }))

    await expect(testTiandituServerConnection('bad-key', fetchImplementation as typeof fetch)).rejects.toThrow('服务端 Key 无效')
  })

  it('tests the official API 4.0 web map entry without exposing the key in the result', async () => {
    const fetchImplementation = vi.fn(async () => new Response('window.T={}; T.Map=function(){}', { status: 200 }))
    const result = await testTiandituWebConnection('web-secret', fetchImplementation as typeof fetch)
    expect(result).toMatchObject({ connected: true })
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain('api.tianditu.gov.cn/api?v=4.0&tk=')
    expect(JSON.stringify(result)).not.toContain('web-secret')
  })

  it('falls back to the compatible /api/v4/jsapi entry when the official entry rejects', async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(new Response('unauthorised', { status: 418 }))
      .mockResolvedValueOnce(new Response('window.T={}; T.Map=function(){}', { status: 200 }))

    await expect(testTiandituWebConnection('legacy-web-key', fetchImplementation as typeof fetch)).resolves.toMatchObject({ connected: true })
    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    expect(String(fetchImplementation.mock.calls[1]?.[0])).toContain('api.tianditu.gov.cn/api/v4/jsapi?tk=')
  })
})
