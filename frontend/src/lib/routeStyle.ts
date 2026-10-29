/**
 * 交通方式的样式表（与后端 services/modes.py 的 MODE_SPECS 一一对应）。
 * 后端是权威数据源，这里保留一份前端常量是为了：
 *   1) 地图折线在拿到响应之前就能按当前方式上色；
 *   2) 断网/离线时按钮组依然可用。
 *
 * 视觉上刻意收敛：所有交通方式共用同一条浅蓝路线，靠文字区分方式，
 * 避免一条路线上出现五种颜色的「彩虹」。
 */
import type { TravelMode } from '@/types'

/** 路线与已选标记的主色：浅蓝（在灰白底图上清晰但不抢眼） */
export const ROUTE_COLOR = '#60a5fa'

export interface ModeStyle {
  key: TravelMode
  label: string
  color: string
  hint: string
  /** 时间轴上代表这一段的图标（分段混合交通时每段可能不同） */
  icon: string
}

export const MODE_STYLES: Record<TravelMode, ModeStyle> = {
  walk: { key: 'walk', label: '步行', color: ROUTE_COLOR, hint: '4.5 km/h，零花费，适合 2km 内', icon: '🚶' },
  transit: { key: 'transit', label: '公交', color: ROUTE_COLOR, hint: '含等车与换乘，覆盖面最广', icon: '🚌' },
  subway: { key: 'subway', label: '地铁', color: ROUTE_COLOR, hint: '30 km/h，中长距离最快', icon: '🚇' },
  taxi: { key: 'taxi', label: '打车', color: ROUTE_COLOR, hint: '按车辆可达入口规划，费用为估算，不含叫车等待', icon: '🚕' },
  drive: { key: 'drive', label: '驾车', color: ROUTE_COLOR, hint: '自驾含油费与停车步行', icon: '🚗' },
}

export const MODE_ORDER: TravelMode[] = ['walk', 'transit', 'subway', 'taxi', 'drive']

export function modeStyle(mode: string | undefined): ModeStyle {
  if (mode && mode in MODE_STYLES) return MODE_STYLES[mode as TravelMode]
  return MODE_STYLES.transit
}

/** 等时圈配色：同一支蓝的三级明度（越近越深），面板与地图共用 */
export function bandColor(minutes: number): string {
  if (minutes <= 15) return '#1e40af'
  if (minutes <= 30) return '#60a5fa'
  return '#c7d2fe'
}

