/**
 * 高德地图 URI API —— 把「导航」这件事交给高德 App 自己做。
 *
 * 官方文档（动手前已核对，2025-03 版）：
 *   https://developer.amap.com/api/uri-api/guide/travel/route
 *
 * 三个和直觉不一样、必须记住的事实：
 *  1) **途经点用 `via` 参数，最多只支持 1 个，而且只在驾车模式有效。**
 *     → 所以「把一整天 6 个点一次性丢给高德当途经点」是做不了的，
 *       只能逐段导航（上一站 → 下一站）。这也更贴近真实使用：人是一段一段走的。
 *  2) **没有 `coordinate` 参数** —— 高德 URI 本来吃的就是 GCJ-02，
 *     而本项目全链路统一 GCJ-02，直接传即可，零坐标转换。
 *     （这是当初坚持"坐标只来自高德"换来的红利。）
 *  3) `callnative=1` 与「from 留空自动用当前位置」**都只在移动端生效**；
 *     在 PC 浏览器上会打开高德网页版。
 *
 * 另外：`policy` 参数正好能和我们的权重滑杆对上 —— 用户在小程序里调的偏好，
 * 能一路带到高德导航里（见 navPolicyFor）。
 */
import type { Hotel, PlanStop, TravelMode, Weights } from '@/types'

const NAV_BASE = 'https://uri.amap.com/navigation'
/** 官方建议填写使用方标识 */
const SRC = 'tripcompiler'

export type NavMode = 'car' | 'bus' | 'walk'

export interface NavPoint {
  lng: number
  lat: number
  name?: string
}

/** 我们的五种交通方式 → 高德 URI 的出行方式（只有 car / bus / walk / ride 四种） */
export function navModeFor(mode: TravelMode): NavMode {
  if (mode === 'walk') return 'walk'
  if (mode === 'transit' || mode === 'subway') return 'bus'
  return 'car' // taxi / drive
}

/**
 * 权重滑杆 → 高德路线策略 policy。
 * 让「少走路 / 省点钱 / 少换乘」这些偏好一路带到导航里，而不是到导航就丢了。
 */
export function navPolicyFor(
  mode: TravelMode,
  weights?: Weights,
): { policy: number; label: string } {
  if (!weights) return { policy: 0, label: '推荐路线' }

  if (mode === 'taxi' || mode === 'drive') {
    // 驾车：0 推荐 / 1 避免拥堵 / 2 避免收费 / 3 不走高速（仅移动端）
    if (weights.time >= 0.7) return { policy: 1, label: '避免拥堵' }
    if (weights.cost >= 0.7) return { policy: 2, label: '避免收费' }
    return { policy: 0, label: '推荐路线' }
  }

  if (mode === 'transit' || mode === 'subway') {
    // 公交：0 最佳路线 / 1 换乘少 / 2 步行少 / 3 不坐地铁
    if (weights.walking >= 0.7) return { policy: 2, label: '步行少' }
    if (weights.convenience >= 0.7) return { policy: 1, label: '换乘少' }
    return { policy: 0, label: '最佳路线' }
  }

  return { policy: 0, label: '推荐路线' }
}

/** 高德的点位格式：lon,lat[,name]（只对地名做一次 URL 编码） */
function formatPoint(point: NavPoint): string {
  const base = `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`
  return point.name ? `${base},${encodeURIComponent(point.name)}` : base
}

export interface BuildNavOptions {
  /** 起点；不传则交给高德用「当前位置」（仅移动端生效，PC 上会要求授权定位） */
  from?: NavPoint | null
  to: NavPoint
  mode: TravelMode
  weights?: Weights
  /** 途经点：官方限制最多 1 个，且仅驾车模式有效 */
  via?: NavPoint | null
  /** 移动端优先调起高德 App */
  callNative?: boolean
}

/** 拼出一条高德导航链接（用 <a href> 打开，比 window.open 在移动端可靠得多） */
export function buildNavUrl(options: BuildNavOptions): string {
  const mode = navModeFor(options.mode)
  const { policy } = navPolicyFor(options.mode, options.weights)

  // ⚠️ 这里手工拼 query，而不是用 URLSearchParams：
  //    1) URLSearchParams 会把坐标里的逗号也编码成 %2C（高德能解，但可读性差）；
  //    2) 更要命的是它会与 formatPoint 里的 encodeURIComponent **叠加成双重编码**，
  //       地名会变成 %25E5%25A4%2596 这种，导航里显示的起终点名就成了乱码。
  //       （这个 bug 是靠把 URL 真打出来看一眼才发现的。）
  const parts: string[] = []
  if (options.from) parts.push(`from=${formatPoint(options.from)}`)
  parts.push(`to=${formatPoint(options.to)}`)
  if (options.via && mode === 'car') parts.push(`via=${formatPoint(options.via)}`)
  parts.push(
    `mode=${mode}`,
    `policy=${policy}`,
    `src=${SRC}`,
    `callnative=${options.callNative === false ? '0' : '1'}`,
  )

  return `${NAV_BASE}?${parts.join('&')}`
}

/** 某一站的导航起点：首站从酒店出发，其余从上一站出发 */
export function previousPointFor(
  day: { stops: PlanStop[] },
  index: number,
  hotel: Hotel,
): NavPoint {
  const previous = index === 0 ? null : day.stops[index - 1]
  return previous
    ? { lng: previous.lng, lat: previous.lat, name: previous.name }
    : { lng: hotel.lng, lat: hotel.lat, name: hotel.name }
}

/** 为时间轴上的某一站生成导航链接（起点 = 上一站 / 酒店） */
export function stopNavUrl(
  stop: PlanStop,
  from: NavPoint,
  mode: TravelMode,
  weights?: Weights,
): string {
  return buildNavUrl({
    from,
    to: { lng: stop.lng, lat: stop.lat, name: stop.name },
    mode,
    weights,
  })
}

/** 从「我的当前位置」导航到某一站（from 留空 = 高德自动取当前位置） */
export function fromHereNavUrl(stop: PlanStop, mode: TravelMode, weights?: Weights): string {
  return buildNavUrl({
    to: { lng: stop.lng, lat: stop.lat, name: stop.name },
    mode,
    weights,
  })
}

/** 给 UI 用的提示文案 */
export function navHint(mode: TravelMode, weights?: Weights): string {
  const { label } = navPolicyFor(mode, weights)
  return `用高德地图导航（${label}）`
}
