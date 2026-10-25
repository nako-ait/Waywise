/**
 * 后端 API 客户端。
 * 统一处理：baseURL、超时、非 2xx 报错文案（把后端的 detail 透出来，方便现场排障）。
 */
import type {
  AiExplainResponse,
  AiHealthInfo,
  AiParseResponse,
  AiReplanResponse,
  HealthInfo,
  IsochroneResponse,
  PlanRequest,
  PlanResponse,
  ShareCodeResponse,
  SharedTripData,
  TravelMode,
} from '@/types'

const API_BASE = (import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000').replace(/\/+$/, '')

export class ApiError extends Error {
  status: number
  detail: string

  constructor(message: string, status: number, detail = '') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 30000): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
    const text = await resp.text()
    const data = text ? JSON.parse(text) : null
    if (!resp.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : text.slice(0, 200)
      throw new ApiError(`后端返回 ${resp.status}`, resp.status, detail)
    }
    return data as T
  } catch (err) {
    if (err instanceof ApiError) throw err
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('请求超时', 0, `超过 ${timeoutMs / 1000} 秒未响应`)
    }
    throw new ApiError(
      '连不上后端',
      0,
      `请确认后端已启动：cd backend && .venv\\Scripts\\python.exe run.py（${API_BASE}）`,
    )
  } finally {
    window.clearTimeout(timer)
  }
}

/** 编译路书：酒店 → 选中目的地 → 返回酒店 */
export function planRoute(payload: PlanRequest): Promise<PlanResponse> {
  return request<PlanResponse>('/api/plan', { method: 'POST', body: JSON.stringify(payload) })
}

/** 演示前预热缓存（把距离矩阵与所有分段路径写入后端 SQLite） */
export function prewarmPlan(payload: PlanRequest): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(
    '/api/plan/prewarm',
    { method: 'POST', body: JSON.stringify(payload) },
    60000,
  )
}

/** 后端健康检查 */
export function fetchHealth(): Promise<HealthInfo> {
  return request<HealthInfo>('/api/health', {}, 5000)
}

/** 等时圈 / 酒店交通便利度（模块 3） */
export function fetchIsochrone(
  hotel: { lng: number; lat: number; name: string },
  minutes: number[],
  mode: TravelMode,
): Promise<IsochroneResponse> {
  return request<IsochroneResponse>(
    '/api/isochrone',
    { method: 'POST', body: JSON.stringify({ hotel, minutes, mode }) },
    20000,
  )
}

/* ---------------- 模块 4：AI 能力 ---------------- */

/** 探活：后端是否配了 LLM Key、能不能真的调通 */
export function aiHealth(): Promise<AiHealthInfo> {
  return request<AiHealthInfo>('/api/ai/health', {}, 20000)
}

/** 自然语言 → 目的地列表（后端会补齐坐标） */
export function aiParse(text: string): Promise<AiParseResponse> {
  return request<AiParseResponse>(
    '/api/ai/parse',
    { method: 'POST', body: JSON.stringify({ text }) },
    40000,
  )
}

/** 一句话重规划：返回解析出的约束 + 重算后的整份路书 */
export function aiReplan(payload: PlanRequest & { text: string }): Promise<AiReplanResponse> {
  return request<AiReplanResponse>(
    '/api/ai/replan',
    { method: 'POST', body: JSON.stringify(payload) },
    60000,
  )
}

/** 路线解释（LLM 润色；无 Key 时后端直接回规则化解释） */
export function aiExplain(plan: PlanResponse, question?: string): Promise<AiExplainResponse> {
  return request<AiExplainResponse>(
    '/api/ai/explain',
    { method: 'POST', body: JSON.stringify({ plan, question }) },
    60000,
  )
}

/* ---------------- 模块 6：行程口令分享 ---------------- */

/** 生成分享口令（把当前行程快照发给后端） */
export function shareTrip(tripData: SharedTripData): Promise<ShareCodeResponse> {
  return request<ShareCodeResponse>('/api/share', {
    method: 'POST',
    body: JSON.stringify({ trip_data: tripData }),
  })
}

/** 用口令取回行程；口令不存在时后端返回 404 */
export function fetchSharedTrip(code: string): Promise<SharedTripData> {
  return request<SharedTripData>(`/api/share/${encodeURIComponent(code.trim().toUpperCase())}`, {}, 15000)
}

export { API_BASE }
