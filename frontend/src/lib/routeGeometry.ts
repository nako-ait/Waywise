/**
 * 真实路线几何（前端侧，走高德 JS API 的路径规划服务）。
 *
 * 后端路线接口可能单独失败，尽管距离矩阵仍来自高德。
 * 这里使用 Walking / Driving / Transfer 插件补查缺失路段；
 * 未确认的连接线必须与真实路网明确区分，不能用其他方式的道路替代。
 *
 * 约定：
 *  · 调用方逐段检查几何来源，已确认的路段不重复请求；
 *  · 取不到当前交通方式的路径时保留未确认状态，不借用其他交通方式的道路；
 *  · 结果按「方式 + 起终点」缓存，拖动/缩放/切天数不会重复打接口。
 */
import type { TravelMode } from '@/types'

/** [[lng, lat], ...] */
export type LngLatPath = Array<[number, number]>

export interface LegEndpoints {
  from: { lng: number; lat: number }
  to: { lng: number; lat: number }
  /** 这一段的交通方式（逐段覆盖）；不填就用整份路书的方式 */
  mode?: TravelMode
  skip?: boolean
}

export interface LegGeometry {
  path: LngLatPath
  distanceKm: number
  durationMin: number
  /**
   * 实际用的路径规划服务。
   * 等于请求的方式；'none' 表示未取得该方式的路径，仅保留地点顺序连接线。
   */
  resolvedMode: TravelMode | 'none'
  error?: string
}

/** 单段查询超时：高德服务偶尔静默失败，不能让整张图卡住 */
const SEARCH_TIMEOUT_MS = 9000

const cache = new Map<string, LegGeometry | null>()

/** 高德 JS API 的路径规划服务有 QPS 限制：并发十来个请求会被拒，
 *  所以逐段串行 + 轻微间隔，成功率明显更高（10 段约 3~4 秒） */
const SERIAL_GAP_MS = 160

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

function cacheKey(mode: string, from: LegEndpoints['from'], to: LegEndpoints['to'], city: string): string {
  const f = `${from.lng.toFixed(5)},${from.lat.toFixed(5)}`
  const t = `${to.lng.toFixed(5)},${to.lat.toFixed(5)}`
  return `${city}|${mode}|${f}|${t}`
}

/** 统一把 AMap.LngLat[] / {lng,lat}[] / [[lng,lat]] 转成 [[lng,lat]] */
function toPath(raw: unknown): LngLatPath {
  if (!Array.isArray(raw)) return []
  const out: LngLatPath = []
  for (const item of raw as any[]) {
    const lng = Number(
      typeof item?.getLng === 'function' ? item.getLng() : (item?.lng ?? item?.[0]),
    )
    const lat = Number(
      typeof item?.getLat === 'function' ? item.getLat() : (item?.lat ?? item?.[1]),
    )
    if (Number.isFinite(lng) && Number.isFinite(lat)) out.push([lng, lat])
  }
  return out
}

function pick(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** 直线距离（公里），只用来决定兜底方式 */
function straightKm(from: LegEndpoints['from'], to: LegEndpoints['to']): number {
  const R = 6371
  const dLat = ((to.lat - from.lat) * Math.PI) / 180
  const dLng = ((to.lng - from.lng) * Math.PI) / 180
  const lat1 = (from.lat * Math.PI) / 180
  const lat2 = (to.lat * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** 走一次路径规划服务（callback 风格 → Promise） */
function searchRoute(AMap: any, from: LegEndpoints['from'], to: LegEndpoints['to'], mode: TravelMode, city: string, timeoutMs: number) {
  return new Promise<{ result?: any; error?: string }>((resolve) => {
    let settled = false
    const done = (value: { result?: any; error?: string }) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const timer = window.setTimeout(() => done({ error: '地图路线查询超时' }), timeoutMs)
    const callback = (status: string, result: any) => {
      window.clearTimeout(timer)
      if (status === 'complete') done({ result })
      else {
        const raw = typeof result === 'string' ? result : result?.info
        const code = typeof raw === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(raw) ? `（${raw}）` : ''
        done({ error: status === 'no_data' ? '未找到当前交通方式的可用路径' : `地图路线查询失败${code}` })
      }
    }
    try {
      const origin = new AMap.LngLat(from.lng, from.lat)
      const destination = new AMap.LngLat(to.lng, to.lat)
      if (mode === 'walk') {
        new AMap.Walking({ hideMarkers: true }).search(origin, destination, callback)
      } else if (mode === 'transit' || mode === 'subway') {
        new AMap.Transfer({ city, cityd: city, policy: 0, hideMarkers: true }).search(
          origin,
          destination,
          callback,
        )
      } else {
        // 打车与自驾走同一套路网
        new AMap.Driving({ hideMarkers: true }).search(origin, destination, callback)
      }
    } catch {
      window.clearTimeout(timer)
      done({ error: '地图路线插件未就绪' })
    }
  })
}

/** 从高德的返回结构里抽出折线 + 里程 + 时长 */
function parseGeometry(result: any, mode: TravelMode): LegGeometry | null {
  if (!result) return null

  if (mode === 'transit' || mode === 'subway') {
    const plan = mode === 'subway'
      ? result.plans?.find((candidate: any) => {
        const rides = (candidate.segments ?? []).filter((segment: any) => segment.transit)
        return rides.length > 0 && rides.every((segment: any) => /地铁|轻轨|subway|metro/i.test(`${segment.transit.type ?? ''} ${segment.transit.name ?? ''}`))
      })
      : result.plans?.[0]
    if (!plan) return null
    let path = toPath(plan.path)
    if (path.length < 2) {
      // 兜底：把每段的步行步骤与乘车折线拼起来
      path = []
      for (const segment of plan.segments ?? []) {
        for (const step of segment?.walking?.steps ?? []) path.push(...toPath(step.path))
        path.push(...toPath(segment?.transit?.path))
      }
    }
    if (path.length < 2) return null
    return {
      path,
      distanceKm: pick(plan.distance) / 1000,
      durationMin: pick(plan.time) / 60,
      resolvedMode: mode,
    }
  }

  const route = result.routes?.[0]
  if (!route) return null
  const path = (route.steps ?? []).flatMap((step: any) => toPath(step?.path))
  if (path.length < 2) return null
  return {
    path,
    distanceKm: pick(route.distance) / 1000,
    durationMin: pick(route.time) / 60,
    resolvedMode: mode,
  }
}

/**
 * 只查询选定交通方式；未取得路径时明确返回未确认连接线。
 */
async function resolveLeg(
  AMap: any,
  leg: LegEndpoints,
  mode: TravelMode,
  city: string,
  timeoutMs: number,
): Promise<LegGeometry> {
  const response = await searchRoute(AMap, leg.from, leg.to, mode, city, timeoutMs)
  const primary = parseGeometry(response.result, mode)
  if (primary) return primary

  const km = straightKm(leg.from, leg.to)
  // This is an order connector, never a navigable road.
  return {
    path: [
      [leg.from.lng, leg.from.lat],
      [leg.to.lng, leg.to.lat],
    ],
    distanceKm: km,
    durationMin: 0,
    resolvedMode: 'none',
    error: response.error ?? '地图未返回当前交通方式的路线形状',
  }
}

/**
 * 取多段的真实路径。
 * 查询失败返回未确认连接线；已知真实路径用 skip 跳过。
 * 只缓存成功的（真实路网），失败的下次还会重试。
 */
export async function fetchLegGeometries(
  AMap: any,
  legs: LegEndpoints[],
  mode: TravelMode,
  city = '上海',
  options: { timeoutMs?: number; gapMs?: number; cancelled?: () => boolean; onProgress?: (items: Array<LegGeometry | null>) => void } = {},
): Promise<Array<LegGeometry | null> | null> {
  if (!AMap || !legs.length) return null

  const results: Array<LegGeometry | null> = []
  for (const leg of legs) {
    if (options.cancelled?.()) return null
    if (leg.skip) { results.push(null); continue }
    const legMode = leg.mode ?? mode
    const key = cacheKey(legMode, leg.from, leg.to, city)
    const cached = cache.get(key)
    if (cached && cached.resolvedMode !== 'none') {
      results.push(cached)
      options.onProgress?.([...results])
      continue
    }
    const geometry = await resolveLeg(AMap, leg, legMode, city, options.timeoutMs ?? SEARCH_TIMEOUT_MS)
    if (options.cancelled?.()) return null
    if (geometry.resolvedMode !== 'none') cache.set(key, geometry)
    results.push(geometry)
    options.onProgress?.([...results])
    await sleep(options.gapMs ?? SERIAL_GAP_MS)
  }

  return results
}

/** 测试/调试用：清空缓存 */
export function clearGeometryCache() {
  cache.clear()
}
