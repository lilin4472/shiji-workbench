export interface CredentialStatus {
  configured: boolean
  encryptionAvailable: boolean
  savedAt?: string
}

export type DeepSeekCredentialStatus = CredentialStatus
export type DoubaoCredentialStatus = CredentialStatus
export type TiandituServerCredentialStatus = CredentialStatus
export type TiandituWebCredentialStatus = CredentialStatus

export interface DeepSeekConnectionResult {
  connected: true
  modelCount: number
  checkedAt: string
}

export interface DoubaoConnectionResult {
  connected: true
  resultCount: number
  checkedAt: string
}

export interface TiandituServerConnectionResult {
  connected: true
  longitude: number
  latitude: number
  checkedAt: string
}

export interface TiandituWebKeyResult {
  apiKey: string
}

export interface TiandituMapPoint {
  longitude: number
  latitude: number
}

// 2026-09-15 新增：附近热点 POI 搜索（天地图 v2 本地搜索，queryType=7）。
export interface TiandituPoiQuery {
  longitude: number
  latitude: number
  keyword: string
  /** 查询半径（米），服务端上限 5000 */
  radiusMeters: number
}

export interface TiandituPoiItemView {
  name: string
  address: string
  longitude: number
  latitude: number
  /** 本机 haversine 计算，非服务端字段 */
  distanceKm: number
}

export interface TiandituPoiSearchValue {
  pois: TiandituPoiItemView[]
  totalCount: number
  requestCount: 0 | 1
  checkedAt: string
}

export interface TiandituWebConnectionResult {
  connected: true
  checkedAt: string
}

export type CredentialResponse<T> =
  | { ok: true; value: T }
  | { ok: false; message: string }
