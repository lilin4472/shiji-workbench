import type { TiandituServerConnectionResult, TiandituWebConnectionResult } from '../shared/credential-contract.js'
import { requestTiandituGeocode } from './tianditu-geocoder.js'

const CONNECTION_TEST_ADDRESS = '北京市东城区天安门广场'
// 官方 JavaScript API 4.0 文档示例使用 /api?v=4.0&tk=。渲染层和诊断层
// 保持同一顺序：官方入口优先，/api/v4/jsapi 仅作后置兼容候选，避免一个
// 格式不完整的响应先污染 window.T。
const TIANDITU_JS_URLS = [
  'https://api.tianditu.gov.cn/api?v=4.0',
  'https://api.tianditu.gov.cn/api/v4/jsapi',
] as const

export async function testTiandituServerConnection(
  apiKey: string,
  fetchImplementation: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<TiandituServerConnectionResult> {
  try {
    const { longitude, latitude } = await requestTiandituGeocode(apiKey, CONNECTION_TEST_ADDRESS, fetchImplementation, timeoutMs)
    return { connected: true, longitude, latitude, checkedAt: new Date().toISOString() }
  } catch (error) {
    if (error instanceof Error && error.message === '天地图未能定位该地址，或返回格式不可识别。') {
      throw new Error('天地图服务端 Key 无效、没有地理编码权限或返回格式不可识别。')
    }
    throw error
  }
}

export async function testTiandituWebConnection(
  apiKey: string,
  fetchImplementation: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<TiandituWebConnectionResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let lastError: Error | undefined
    for (const baseUrl of TIANDITU_JS_URLS) {
        const separator = baseUrl.includes('?') ? '&' : '?'
      const url = `${baseUrl}${separator}tk=${encodeURIComponent(apiKey.trim())}`
        
        
      const response = await fetchImplementation(url, { signal: controller.signal })
      if (response.ok) {
        const body = await response.text()
        if (body.includes('T.Map')) return { connected: true, checkedAt: new Date().toISOString() }
        lastError = new Error('天地图网页端脚本返回格式不可识别。')
      } else {
        lastError = response.status === 401 || response.status === 403 || response.status === 418
          ? new Error('天地图网页端 Key 无效、未授权或应用来源限制不匹配。')
          : new Error(`天地图网页端脚本连接失败（HTTP ${response.status}）。`)
      }
      // A 401/403 from the first entry is an application restriction, not a
      // transient network error; still allow the legacy entry to prove an
      // existing Key is authorised for that deployment.
    }
    throw lastError ?? new Error('天地图网页端脚本连接失败。')
  } catch (error) {
    if (controller.signal.aborted) throw new Error('天地图网页端脚本连接超时，请检查网络后重试。')
    if (error instanceof Error && error.message.startsWith('天地图')) throw error
    throw new Error('无法连接天地图网页端脚本，请检查网络和 Key 权限。')
  } finally {
    clearTimeout(timeout)
  }
}
