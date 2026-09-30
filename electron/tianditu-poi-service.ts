import { haversineDistanceKm, isGeoPoint, type GeoPoint } from '../shared/geography.js'

// 天地图 POI 本地搜索（v2 search，queryType=7：以中心点+半径搜索关键词）。
// 只在用户点击“搜索附近热点”时调用一次；结果不缓存（POI 随时间变化）。

const TIANDITU_POI_SEARCH_URL = 'https://api.tianditu.gov.cn/v2/search'

export interface TiandituPoiQueryRequest {
  center: GeoPoint
  keyword: string
  /** 查询半径（米），服务端限制最大 5000 */
  radiusMeters: number
}

export interface TiandituPoiItem {
  name: string
  address: string
  point: GeoPoint
  /** 由本机 haversine 计算，非服务端字段 */
  distanceKm: number
}

export interface TiandituPoiSearchResult {
  pois: TiandituPoiItem[]
  /** 服务端声称的总数（可能多于本次返回） */
  totalCount: number
  requestCount: 0 | 1
  checkedAt: string
}

export type TiandituPoiSearchPort = (request: TiandituPoiQueryRequest, signal?: AbortSignal) => Promise<TiandituPoiSearchResult>

interface TiandituPoiApiPayload {
  status?: unknown
  msg?: unknown
  count?: unknown
  pois?: Array<{ name?: unknown; address?: unknown; lonlat?: unknown; phone?: unknown }>
}

/** 纯函数：解析天地图 v2 search 响应并计算本机距离。测试直接覆盖。
 *  官方返回码表：1000=OK，3001=无数据；status 可能是 "0"/数字/status 数组（含 infocode）。 */
export function parseTiandituPoiResponse(payload: unknown, center: GeoPoint): { pois: TiandituPoiItem[]; totalCount: number } {
  const body = (payload ?? {}) as TiandituPoiApiPayload & { resultType?: unknown }
  if (!isSuccessStatus(body)) {
    throw new Error(`天地图 POI 搜索失败：${describeStatus(body)}`)
  }
  // 周边搜索的 resultType=1 才有 pois；统计/行政区结果按无数据处理。
  if (body.resultType !== undefined && Number(body.resultType) !== 1) {
    return { pois: [], totalCount: 0 }
  }
  const totalCount = Number.parseInt(String(body.count ?? '0'), 10) || 0
  const pois: TiandituPoiItem[] = []
  for (const raw of Array.isArray(body.pois) ? body.pois : []) {
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    const address = typeof raw.address === 'string' ? raw.address.trim() : ''
    const lonlat = typeof raw.lonlat === 'string' ? raw.lonlat.split(',').map((value) => Number(value.trim())) : []
    if (!name || lonlat.length < 2) continue
    const point: GeoPoint = { longitude: lonlat[0], latitude: lonlat[1] }
    if (!isGeoPoint(point)) continue
    pois.push({ name, address, point, distanceKm: Number(haversineDistanceKm(center, point).toFixed(3)) })
  }
  return { pois, totalCount }
}

function isSuccessStatus(body: TiandituPoiApiPayload & { resultType?: unknown }): boolean {
  if (body.status === undefined) return true
  if (typeof body.status === 'string') return body.status === '0' || body.status === '1000'
  if (typeof body.status === 'number') return body.status === 0 || body.status === 1000
  return false
}

function describeStatus(body: TiandituPoiApiPayload): string {
  const codeMap: Record<string, string> = {
    '2001': '请求参数错误', '2002': '请求参数格式错误', '2003': '缺少必填参数',
    '2004': '枚举值错误', '2005': '经纬度数据错误', '2006': '经纬度越界',
    '2007': '请求数据量溢出', '3000': '服务器出错', '3001': '没有找到数据',
  }
  const raw = typeof body.msg === 'string' ? body.msg : ''
  const code = raw.match(/\d{3,4}/)?.[0] ?? (typeof body.status === 'string' || typeof body.status === 'number' ? String(body.status) : '')
  const known = code ? codeMap[code] : undefined
  return known ? `${known}（${code}${raw ? `：${raw}` : ''}）` : (raw || '服务端未返回成功状态。')
}

/** 纯函数：构造周边搜索（官方 queryType=3）的 postStr 与查询 URL。
 *  依据官方文档 1.3：keyWord/queryRadius/pointLonlat/queryType/start/count 必填；
 *  queryRadius 单位米、10 公里内；官方示例同时携带 level:12。 */
export function buildTiandituPoiSearchRequest(request: TiandituPoiQueryRequest, apiKey: string): { url: string; postStr: string } {
  const keyword = request.keyword.trim()
  if (!keyword) throw new Error('POI 关键词为空。')
  const radius = Math.max(100, Math.min(10_000, Math.round(request.radiusMeters)))
  const { longitude, latitude } = request.center
  const postStr = JSON.stringify({
    keyWord: keyword,
    level: 12,
    queryRadius: radius,
    pointLonlat: `${longitude.toFixed(6)},${latitude.toFixed(6)}`,
    queryType: 3,
    start: 0,
    count: 20,
  })
  const url = `${TIANDITU_POI_SEARCH_URL}?postStr=${encodeURIComponent(postStr)}&type=query&tk=${encodeURIComponent(apiKey)}`
  return { url, postStr }
}

export function createTiandituPoiSearchPort(readServerKey: () => Promise<string>, fetchImpl: typeof fetch = fetch): TiandituPoiSearchPort {
  return async (request, signal) => {
    const apiKey = (await readServerKey()).trim()
    if (!apiKey) throw new Error('尚未配置天地图服务端 Key，请到设置页保存后再搜索热点。')
    const { url } = buildTiandituPoiSearchRequest(request, apiKey)
    const response = await fetchImpl(url, { signal })
    if (!response.ok) throw new Error(`天地图 POI 搜索请求失败（HTTP ${response.status}）。`)
    const parsed = parseTiandituPoiResponse(await response.json(), request.center)
    return { ...parsed, requestCount: 1, checkedAt: new Date().toISOString() }
  }
}
