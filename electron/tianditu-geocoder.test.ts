import { describe, expect, it, vi } from 'vitest'
import { createTiandituGeocoder, TiandituGeocodeCache } from './tianditu-geocoder.js'

describe('Tianditu geocoder', () => {
  it('caches successful address coordinates and avoids a second official API call', async () => {
    let cacheText: string | undefined
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify({
      status: '0', msg: 'ok', location: { lon: 104.0668, lat: 30.5728 },
    }), { status: 200 }))
    const cache = new TiandituGeocodeCache({
      read: async () => cacheText,
      write: async (content) => { cacheText = content },
    })
    const geocode = createTiandituGeocoder(async () => 'server-key', cache, {
      fetchImplementation,
      now: () => new Date('2026-09-07T00:00:00.000Z'),
    })

    const first = await geocode('  成都市高新区天府大道北段  ')
    const second = await geocode('成都市高新区天府大道北段')

    expect(first).toMatchObject({ longitude: 104.0668, latitude: 30.5728, requestCount: 1, cacheHit: false })
    expect(second).toMatchObject({ longitude: 104.0668, latitude: 30.5728, requestCount: 0, cacheHit: true })
    expect(fetchImplementation).toHaveBeenCalledOnce()
  })

  it('requires a user-provided service-side key for a new address', async () => {
    const cache = new TiandituGeocodeCache({ read: async () => undefined, write: async () => undefined })
    const geocode = createTiandituGeocoder(async () => undefined, cache)

    await expect(geocode('成都市高新区')).rejects.toThrow('请先在设置中保存天地图服务端 Key')
  })
})
