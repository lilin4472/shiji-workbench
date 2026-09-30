import { describe, expect, it, vi } from 'vitest'
import {
  buildTiandituPoiSearchRequest,
  createTiandituPoiSearchPort,
  parseTiandituPoiResponse,
} from './tianditu-poi-service.js'

const center = { longitude: 104.06, latitude: 30.67 }

describe('parseTiandituPoiResponse', () => {
  it('解析正常响应并计算本机距离', () => {
    const parsed = parseTiandituPoiResponse({
      status: '0', msg: 'ok', count: '2',
      pois: [
        { name: '环球中心', address: '天府大道北段1700号', lonlat: '104.062,30.672' },
        { name: '', address: 'x', lonlat: '104,30' },
        { name: '坏坐标', address: 'y', lonlat: 'abc' },
      ],
    }, center)
    expect(parsed.totalCount).toBe(2)
    expect(parsed.pois).toHaveLength(1)
    expect(parsed.pois[0]?.name).toBe('环球中心')
    expect(parsed.pois[0]?.distanceKm).toBeGreaterThan(0)
  })

  it('服务端非成功状态抛出受控错误（含官方码表映射）', () => {
    expect(() => parseTiandituPoiResponse({ status: '2003', msg: '缺少必填参数' }, center))
      .toThrow(/天地图 POI 搜索失败：缺少必填参数（2003/),
    expect(() => parseTiandituPoiResponse({ status: '101', msg: 'key error' }, center))
      .toThrow(/天地图 POI 搜索失败：key error/)
  })

  it('兼容 status=1000 / 无 status 的官方返回形态', () => {
    expect(parseTiandituPoiResponse({ status: '1000', count: '1', pois: [{ name: 'A', address: 'a', lonlat: '104.06,30.67' }] }, center).pois).toHaveLength(1)
    expect(parseTiandituPoiResponse({ count: '0', pois: [] }, center).totalCount).toBe(0)
  })
})

describe('buildTiandituPoiSearchRequest', () => {
  it('按官方周边搜索规范构造 queryType=3 + pointLonlat + start/count，半径截断到 10 公里', () => {
    const { postStr, url } = buildTiandituPoiSearchRequest({ center, keyword: '餐饮', radiusMeters: 99999 }, 'TK-1')
    const body = JSON.parse(postStr)
    expect(body.queryType).toBe(3)
    expect(body.queryRadius).toBe(10000)
    expect(body.pointLonlat).toBe('104.060000,30.670000')
    expect(body.start).toBe(0)
    expect(body.count).toBe(20)
    expect(body.keyWord).toBe('餐饮')
    expect(url).toContain('type=query')
    expect(url).toContain(encodeURIComponent('TK-1'))
  })

  it('空关键词直接拒绝', () => {
    expect(() => buildTiandituPoiSearchRequest({ center, keyword: '  ', radiusMeters: 1000 }, 'TK'))
      .toThrow('POI 关键词为空。')
  })
})

describe('createTiandituPoiSearchPort', () => {
  it('无服务端 Key 时明确失败', async () => {
    const port = createTiandituPoiSearchPort(async () => '', (async () => { throw new Error('不应发请求') }) as unknown as typeof fetch)
    await expect(port({ center, keyword: '餐饮', radiusMeters: 1000 })).rejects.toThrow(/尚未配置天地图服务端 Key/)
  })

  it('成功路径只发起一次请求并带 checkedAt', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: '0', count: '1', pois: [{ name: '地铁站', address: '1号口', lonlat: '104.061,30.669' }],
    }), { status: 200 }))
    const port = createTiandituPoiSearchPort(async () => 'TK-9', fetchMock as unknown as typeof fetch)
    const result = await port({ center, keyword: '地铁', radiusMeters: 800 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.requestCount).toBe(1)
    expect(result.pois[0]?.name).toBe('地铁站')
    expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
