/**
 * 交通方式的样式表（与后端 services/modes.py 的 MODE_SPECS 一一对应）。
 * 后端是权威数据源，这里保留一份前端常量是为了：
 *   1) 地图折线在拿到响应之前就能按当前方式上色；
 *   2) 断网/离线时按钮组依然可用。
 */
import type { TravelMode } from '@/types'

export interface ModeStyle {
  key: TravelMode
  label: string
  icon: string
  color: string
  hint: string
}

export const MODE_STYLES: Record<TravelMode, ModeStyle> = {
  walk: { key: 'walk', label: '步行', icon: '🚶', color: '#16a34a', hint: '4.5 km/h，零花费，适合 2km 内' },
  transit: { key: 'transit', label: '公交', icon: '🚌', color: '#2563eb', hint: '含等车与换乘，覆盖面最广' },
  subway: { key: 'subway', label: '地铁', icon: '🚇', color: '#7c3aed', hint: '30 km/h，中长距离最快' },
  taxi: { key: 'taxi', label: '打车', icon: '🚕', color: '#f59e0b', hint: '门到门，起步价 16 元' },
  drive: { key: 'drive', label: '驾车', icon: '🚗', color: '#0891b2', hint: '自驾含油费与停车步行' },
}

export const MODE_ORDER: TravelMode[] = ['walk', 'transit', 'subway', 'taxi', 'drive']

export function modeStyle(mode: string | undefined): ModeStyle {
  if (mode && mode in MODE_STYLES) return MODE_STYLES[mode as TravelMode]
  return MODE_STYLES.transit
}

/** 等时圈配色：15 分钟绿 → 30 分钟黄 → 45 分钟橙（面板与地图共用同一套） */
export function bandColor(minutes: number): string {
  if (minutes <= 15) return '#22c55e'
  if (minutes <= 30) return '#eab308'
  return '#f97316'
}
