import type { Hotel, PlanDay } from '@/types'

/** Missing fields are legacy round trips. Free-end days have no final transfer. */
export function dayEndPoint(day: PlanDay, origin: Hotel): Hotel | null {
  if (day.endMode === 'last_stop') return null
  return day.endMode === 'custom' ? day.endPoint ?? null : day.endPoint ?? origin
}

export function dayFinishName(day: PlanDay, origin: Hotel): string {
  return day.endMode === 'last_stop' ? day.stops.at(-1)?.name ?? '最后一站' : dayEndPoint(day, origin)?.name ?? '未设置终点'
}
