/**
 * 把"个人页填的 Key"带到每一个后端请求里。
 *
 * 之前这些 Key 只存在 localStorage，后端读的是 .env —— 两边不通，
 * 所以不管填什么，AI 都只会走规则降级。现在通过请求头传给后端：
 *   x-llm-key / x-llm-provider / x-llm-model / x-amap-key
 * 后端 main.py 的中间件把它们放进 contextvars，amap_client / llm 优先使用。
 */
export interface AuthKeys {
  llmKey?: string
  llmProvider?: string
  llmModel?: string
  amapKey?: string
}

const STORAGE_KEY = 'tripcompiler:v1'

export function loadAuthKeys(): AuthKeys {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const profile = JSON.parse(raw)?.state?.profile
    if (!profile) return {}
    return {
      llmKey: profile.llmKey || undefined,
      llmProvider: profile.llmProvider || undefined,
      llmModel: profile.llmModel || undefined,
      amapKey: profile.amapKey || undefined,
    }
  } catch {
    return {}
  }
}

export function authHeaders(): Record<string, string> {
  const keys = loadAuthKeys()
  const headers: Record<string, string> = {}
  if (keys.llmKey) headers['x-llm-key'] = keys.llmKey
  if (keys.llmProvider) headers['x-llm-provider'] = keys.llmProvider
  if (keys.llmModel) headers['x-llm-model'] = keys.llmModel
  if (keys.amapKey) headers['x-amap-key'] = keys.amapKey
  return headers
}
