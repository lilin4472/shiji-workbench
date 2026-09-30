import { isGeoPoint, type GeoPoint } from '../shared/geography.js'

const TIANDITU_GEOCODER_URL = 'https://api.tianditu.gov.cn/geocoder'
const DEFAULT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000

interface TiandituGeocoderPayload {
  status?: unknown
  msg?: unknown
  location?: { lon?: unknown; lat?: unknown }
}

interface CacheEntry extends GeoPoint {
  checkedAt: string
  expiresAt: string
}

interface CacheFile {
  version: 1
  entries: Record<string, CacheEntry>
}

export interface TiandituGeocodeCacheStorage {
  read: () => Promise<string | undefined>
  write: (content: string) => Promise<void>
}

export interface TiandituGeocodeResult extends GeoPoint {
  normalizedAddress: string
  checkedAt: string
  requestCount: 0 | 1
  cacheHit: boolean
}

export type TiandituGeocodePort = (address: string) => Promise<TiandituGeocodeResult>

export class TiandituGeocodeCache {
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly storage: TiandituGeocodeCacheStorage) {}

  async get(address: string, now: Date): Promise<CacheEntry | undefined> {
    const file = await this.load()
    const entry = file.entries[address]
    if (!entry || !isGeoPoint(entry) || !validDate(entry.expiresAt) || entry.expiresAt <= now.toISOString()) return undefined
    return entry
  }

  async set(address: string, point: GeoPoint, checkedAt: Date, expiresAt: Date): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      const file = await this.load()
      const nowIso = checkedAt.toISOString()
      const entries = Object.fromEntries(Object.entries(file.entries).filter(([, entry]) => validDate(entry.expiresAt) && entry.expiresAt > nowIso))
      entries[address] = { ...point, checkedAt: nowIso, expiresAt: expiresAt.toISOString() }
      await this.storage.write(JSON.stringify({ version: 1, entries } satisfies CacheFile))
    })
    this.writeQueue = operation.catch(() => {})
    await operation
  }

  private async load(): Promise<CacheFile> {
    try {
      const raw = await this.storage.read()
      if (!raw) return { version: 1, entries: {} }
      const parsed: unknown = JSON.parse(raw)
      if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.entries)) return { version: 1, entries: {} }
      return parsed as unknown as CacheFile
    } catch {
      return { version: 1, entries: {} }
    }
  }
}

export interface CreateTiandituGeocoderOptions {
  fetchImplementation?: typeof fetch
  now?: () => Date
  timeoutMs?: number
  cacheTtlMs?: number
}

export function createTiandituGeocoder(
  readApiKey: () => Promise<string | undefined>,
  cache: TiandituGeocodeCache,
  options: CreateTiandituGeocoderOptions = {},
): TiandituGeocodePort {
  const now = options.now ?? (() => new Date())
  const ttlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  return async (address) => {
    const normalizedAddress = normalizeAddress(address)
    const checkedAt = now()
    const cached = await cache.get(normalizedAddress, checkedAt)
    if (cached) return { longitude: cached.longitude, latitude: cached.latitude, normalizedAddress, checkedAt: cached.checkedAt, requestCount: 0, cacheHit: true }
    const apiKey = (await readApiKey())?.trim()
    if (!apiKey) throw new Error('请先在设置中保存天地图服务端 Key。')
    const point = await requestTiandituGeocode(apiKey, normalizedAddress, options.fetchImplementation, options.timeoutMs)
    await cache.set(normalizedAddress, point, checkedAt, new Date(checkedAt.getTime() + ttlMs))
    return { ...point, normalizedAddress, checkedAt: checkedAt.toISOString(), requestCount: 1, cacheHit: false }
  }
}

export async function requestTiandituGeocode(
  apiKey: string,
  address: string,
  fetchImplementation: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<GeoPoint> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const url = new URL(TIANDITU_GEOCODER_URL)
  url.searchParams.set('ds', JSON.stringify({ keyWord: normalizeAddress(address) }))
  url.searchParams.set('tk', apiKey)
  try {
    const response = await fetchImplementation(url, { signal: controller.signal })
    if (response.status === 401 || response.status === 403) throw new Error('天地图服务端 Key 无效或没有地理编码权限。')
    if (response.status === 429) throw new Error('天地图调用频率或额度已受限，请稍后重试。')
    if (!response.ok) throw new Error(`天地图地理编码失败（HTTP ${response.status}）。`)
    const payload = await response.json() as TiandituGeocoderPayload
    const longitude = finiteCoordinate(payload.location?.lon, -180, 180)
    const latitude = finiteCoordinate(payload.location?.lat, -90, 90)
    if ((payload.status !== '0' && payload.status !== 0) || longitude === undefined || latitude === undefined) {
      throw new Error('天地图未能定位该地址，或返回格式不可识别。')
    }
    return { longitude, latitude }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('天地图地理编码超时，请检查网络后重试。')
    if (error instanceof Error && error.message.startsWith('天地图')) throw error
    throw new Error('无法连接天地图官方 API，请检查网络与应用权限后重试。')
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeAddress(address: string): string {
  const value = address.replace(/\s+/g, ' ').trim()
  if (!value || value.length > 200) throw new Error('待定位地址为空或过长。')
  return value
}

function finiteCoordinate(value: unknown, min: number, max: number): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : undefined
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
