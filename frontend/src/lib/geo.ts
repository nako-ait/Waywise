/**
 * 地理计算工具（全部基于 GCJ-02 坐标做平面近似，城市尺度误差可忽略）
 */

const EARTH_R = 6371008.8 // 米

const toRad = (d: number) => (d * Math.PI) / 180

/** 两点球面距离（米），Haversine */
export function haversineM(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 两点直线距离（公里，保留 2 位） */
export function straightKm(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number {
  return round(haversineM(a, b) / 1000, 2)
}

/** 一组点的中心（用于自动缩放到合适视野） */
export function centerOf(points: Array<{ lng: number; lat: number }>): {
  lng: number
  lat: number
} | null {
  if (!points.length) return null
  let lng = 0
  let lat = 0
  for (const p of points) {
    lng += p.lng
    lat += p.lat
  }
  return { lng: lng / points.length, lat: lat / points.length }
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

/** 分钟 -> "1小时20分" */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m}分钟`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h}小时${rest}分` : `${h}小时`
}

/** 金额 -> "¥12.5" */
export function formatMoney(yuan: number): string {
  return `¥${round(yuan, 1)}`
}

/** "HH:mm" -> 当日分钟数 */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => Number.parseInt(x, 10))
  return (h || 0) * 60 + (m || 0)
}

/** 当日分钟数 -> "HH:mm" */
export function minutesToHhmm(min: number): string {
  const total = ((Math.round(min) % 1440) + 1440) % 1440
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
