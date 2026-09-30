// 豆包搜索 provider（DSH ctx.web 搜索后端）—— 零依赖版。
//
// 为什么零依赖：
//   这个文件被识机写入**会话目录**并作为 DSH 插件加载，而**能力包有 manifest 完整性校验**
//   （fileCount + treeSha256），不能往里写文件；放在会话目录时又解析不到 @deepseek-ai/* 依赖。
//   因此本插件不使用任何 import，只依赖 Cordis 传进来的 ctx：ctx.web.registerSearchProvider(provider)。
//   配置（端点/条数/缓存）由宿主通过插件 config 注入；Key 由宿主注入或环境变量提供。
//
// 定位：模型侧工具（web_search / web_fetch）由 @deepseek-ai/dsh-tool-web 提供，
//   多轮检索由内核 dsh-agent-loop 驱动；本插件只做"搜索后端"，不自建循环。

/** 本 provider 在 ctx.web 注册表里的 id（cordis 配置里 searchProvider 需 pin 同一个值）。 */
export const DOUBAO_PROVIDER_ID = 'doubao'

export const name = 'shiji-doubao-web'

/** 只依赖 web 能力接缝，不依赖任何包。 */
export const inject = ['web']

/** 默认端点/条数/缓存时长（宿主可用插件 config 覆盖）。 */
const DEFAULT_ENDPOINT = 'https://open.feedcoopapi.com/search_api/web_search'
const DEFAULT_MAX_RESULTS = 10
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000

/** 把豆包返回映射成 DSH 的 WebSearchResult：{ content?, sources[], truncated }（按 url 去重）。 */
export function toWebSearchResult(payload) {
  const items = Array.isArray(payload?.data?.result) ? payload.data.result
    : Array.isArray(payload?.result) ? payload.result
      : Array.isArray(payload) ? payload : []
  const seen = new Set()
  const sources = []
  const parts = []
  for (const item of items) {
    const url = String(item?.url ?? item?.Url ?? '').trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    const title = String(item?.title ?? item?.Title ?? '').trim()
    const snippet = String(item?.content ?? item?.Summary ?? item?.summary ?? item?.snippet ?? '').trim()
    sources.push({
      url,
      ...(title ? { title } : {}),
      ...(snippet ? { snippet: snippet.slice(0, 800) } : {}),
    })
    parts.push([title, snippet].filter(Boolean).join('\n'))
  }
  return { ...(parts.length > 0 ? { content: parts.join('\n\n') } : {}), sources, truncated: false }
}

/**
 * @param {object} ctx Cordis 上下文（含 ctx.web）
 * @param {object} config 宿主注入的插件配置
 */
export function apply(ctx, config = {}) {
  const cache = new Map()

  /** 解析豆包搜索 Key：① 宿主注入 ② 子进程环境变量（识机启动 DSH 时注入，用户无需重填）。 */
  async function resolveApiKey() {
    if (typeof config.resolveApiKey === 'function') {
      const key = await config.resolveApiKey()
      if (key && String(key).trim().length > 0) return String(key).trim()
    }
    const fromEnv = typeof process !== 'undefined' ? process.env?.SHIJI_DOUBAO_SEARCH_KEY : undefined
    if (fromEnv && String(fromEnv).trim().length > 0) return String(fromEnv).trim()
    return undefined
  }

  const provider = {
    id: DOUBAO_PROVIDER_ID,
    /** 契约要求：只做本地判断，绝不在这里发网络请求。 */
    async available() {
      try {
        return Boolean(await resolveApiKey())
      } catch {
        return false
      }
    },
    async search(request, signal) {
      const key = await resolveApiKey()
      if (!key) throw new Error('未配置豆包搜索 Key：请在识机设置中填写后重试。')

      const maxResults = Number(request?.maxResults ?? config.maxResults ?? DEFAULT_MAX_RESULTS) || DEFAULT_MAX_RESULTS
      const cacheKey = `${request?.query ?? ''}::${maxResults}`
      const ttl = Number(config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS)
      const hit = cache.get(cacheKey)
      if (hit && Date.now() - hit.at < ttl) return hit.value

      const response = await fetch(config.endpoint ?? DEFAULT_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ query: request?.query ?? '', count: maxResults }),
        ...(signal ? { signal } : {}),
      })
      if (!response.ok) throw new Error(`豆包搜索失败：HTTP ${response.status}`)
      const value = toWebSearchResult(await response.json())
      cache.set(cacheKey, { at: Date.now(), value })
      return value
    },
  }

  return ctx.web.registerSearchProvider(provider)
}
