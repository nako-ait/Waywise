/**
 * 真实路线几何（前端侧，走高德 JS API 的路径规划服务）。
 *
 * 为什么需要它：后端的距离/路径默认走「高德 Web 服务」，而这把 Key 属于「Web端(JS API)」，
 * 后端拿不到真实路网，只能退化成「直线 × 绕行系数」—— 地图上就是两点之间的直线，
 * 看起来像直升机。这里用 JS API 已有的 Walking / Driving / Transfer 插件，
 * 在浏览器里把每一段的真实路径（路网折线）取回来画到地图上。
 *
 * 约定：
 *  · 后端 `dataSource === 'amap'` 时说明它已经给了真实折线，不再走这里；
 *  · 任何一段取不到就整组放弃（调用方保持原来的折线），避免「一半真一半假」；
 *  · 结果按「方式 + 起终点」缓存，拖动/缩放/切天数不会重复打接口。
 */
import type { TravelMode } from '@/types'

/** [[lng, lat], ...] */
export type LngLatPath = Array<[number, number]>

export interface LegEndpoints {
  from: { lng: number; lat: number }
  to: { lng: number; lat: number }
}

export interface LegGeometry {
  path: LngLatPath
  distanceKm: number
  durationMin: number
  /**
   * 实际用的路径规划服务。
   * 通常等于请求的方式；公交/地铁在「距离太近、没有线路」时高德返回 NO_DATA，
   * 这一段会退化成步行（近）或驾车（远）的真实路网 —— 折线依然是真实的，
   * 只是不再假装那是公交线路。
   * 'none' 表示这一段连兜底都没取到，退回两点直线。
   */
  resolvedMode: TravelMode | 'none'
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

function cacheKey(mode: string, from: LegEndpoints['from'], to: LegEndpoints['to']): string {
  const f = `${from.lng.toFixed(5)},${from.lat.toFixed(5)}`
  const t = `${to.lng.toFixed(5)},${to.lat.toFixed(5)}`
  return `${mode}|${f}|${t}`
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
function searchRoute(AMap: any, from: LegEndpoints['from'], to: LegEndpoints['to'], mode: TravelMode) {
  return new Promise<any>((resolve) => {
    let settled = false
    const done = (value: any) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const timer = window.setTimeout(() => done(null), SEARCH_TIMEOUT_MS)
    const callback = (status: string, result: any) => {
      window.clearTimeout(timer)
      done(status === 'complete' ? result : null)
    }
    try {
      const origin = new AMap.LngLat(from.lng, from.lat)
      const destination = new AMap.LngLat(to.lng, to.lat)
      if (mode === 'walk') {
        new AMap.Walking({ hideMarkers: true }).search(origin, destination, callback)
      } else if (mode === 'transit' || mode === 'subway') {
        // city / cityd 都填上海 citycode；policy 0 = 最快捷
        new AMap.Transfer({ city: '021', cityd: '021', policy: 0, hideMarkers: true }).search(
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
      done(null)
    }
  })
}

/** 从高德的返回结构里抽出折线 + 里程 + 时长 */
function parseGeometry(result: any, mode: TravelMode): LegGeometry | null {
  if (!result) return null

  if (mode === 'transit' || mode === 'subway') {
    const plan = result.plans?.[0]
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
 * 单段解析：先按选定方式取；取不到（例如公交 NO_DATA）再退化成真实步行/驾车路网。
 * 这样每一段都能画成真实道路，而不是两点直线。
 */
async function resolveLeg(
  AMap: any,
  leg: LegEndpoints,
  mode: TravelMode,
): Promise<LegGeometry> {
  const primary = parseGeometry(await searchRoute(AMap, leg.from, leg.to, mode), mode)
  if (primary) return primary

  const km = straightKm(leg.from, leg.to)
  // 兜底方式按「怎么走更接近真实」来选：
  //  · 公交/地铁 3km 内走路更合理（高德对过近的公交常返回 NO_DATA），更远才用驾车路网
  //  · 步行失败就用驾车路网兜底；打车/驾车失败且很近，就退回步行
  const altMode: TravelMode =
    mode === 'transit' || mode === 'subway'
      ? km <= 3
        ? 'walk'
        : 'drive'
      : mode === 'walk'
        ? 'drive'
        : km <= 1
          ? 'walk'
          : 'drive'
  if (altMode !== mode) {
    const alt = parseGeometry(await searchRoute(AMap, leg.from, leg.to, altMode), altMode)
    if (alt) return { ...alt, resolvedMode: altMode }
  }

  // 连兜底都失败：保留两点直线，至少不拖累其它段
  return {
    path: [
      [leg.from.lng, leg.from.lat],
      [leg.to.lng, leg.to.lat],
    ],
    distanceKm: km,
    durationMin: 0,
    resolvedMode: 'none',
  }
}

/**
 * 取多段的真实路径。
 * 每段都有兜底：主方式 → 步行/驾车 → 两点直线（resolvedMode='none'）。
 * 只缓存成功的（真实路网），失败的下次还会重试。
 */
export async function fetchLegGeometries(
  AMap: any,
  legs: LegEndpoints[],
  mode: TravelMode,
): Promise<LegGeometry[] | null> {
  if (!AMap || !legs.length) return null
  if (typeof AMap.Walking !== 'function' || typeof AMap.Driving !== 'function') return null
  if ((mode === 'transit' || mode === 'subway') && typeof AMap.Transfer !== 'function') return null

  const results: LegGeometry[] = []
  for (const leg of legs) {
    const key = cacheKey(mode, leg.from, leg.to)
    const cached = cache.get(key)
    if (cached && cached.resolvedMode !== 'none') {
      results.push(cached)
      continue
    }
    const geometry = await resolveLeg(AMap, leg, mode)
    if (geometry.resolvedMode !== 'none') cache.set(key, geometry)
    results.push(geometry)
    await sleep(SERIAL_GAP_MS)
  }

  return results
}

/** 测试/调试用：清空缓存 */
export function clearGeometryCache() {
  cache.clear()
}
