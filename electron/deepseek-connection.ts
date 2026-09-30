import type { DeepSeekConnectionResult } from '../shared/credential-contract.js'

const DEEPSEEK_MODELS_URL = 'https://api.deepseek.com/models'

interface ModelsResponse {
  data?: unknown[]
}

export async function testDeepSeekConnection(
  apiKey: string,
  fetchImplementation: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<DeepSeekConnectionResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImplementation(DEEPSEEK_MODELS_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })

    if (response.status === 401 || response.status === 403) {
      throw new Error('DeepSeek Key 无效或没有访问权限。')
    }
    if (response.status === 429) {
      throw new Error('DeepSeek 请求过于频繁，请稍后再试。')
    }
    if (!response.ok) {
      throw new Error(`DeepSeek 连接检测失败（HTTP ${response.status}）。`)
    }

    const payload = await response.json() as ModelsResponse
    if (!Array.isArray(payload.data)) throw new Error('DeepSeek 返回了无法识别的模型列表。')
    return { connected: true, modelCount: payload.data.length, checkedAt: new Date().toISOString() }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('DeepSeek 连接检测超时，请检查网络后重试。')
    if (error instanceof Error && error.message.startsWith('DeepSeek')) throw error
    throw new Error('无法连接 DeepSeek 官方 API，请检查网络后重试。')
  } finally {
    clearTimeout(timeout)
  }
}

