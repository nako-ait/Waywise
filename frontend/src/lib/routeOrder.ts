/**
 * 「当前在看哪一天」与「序号」的单一真相。
 *
 * 多日模式下：
 *   · 序号按**当前这一天**的路线顺序编号；
 *   · 不属于当天的点在地图上退回灰色候选点（由 MapView 用 dayIds 判断）。
 */
import { useMemo } from 'react'
import { useTripStore } from '@/store/useTripStore'
import type { PlanDay, PlanResponse } from '@/types'

export interface DayScope {
  plan: PlanResponse | null
  /** 当前查看的那一天 */
  day: PlanDay | null
  dayIndex: number
  /** 当天的站点 id 集合；没有路书时为 null（表示"按选中状态"渲染） */
  dayIds: Set<string> | null
  /** 是否多日路书 */
  isMultiDay: boolean
  dayCount: number
}

export function useDayScope(): DayScope {
  const plan = useTripStore((s) => s.plan)
  const activeDay = useTripStore((s) => s.activeDay)

  return useMemo(() => {
    const days = plan?.days ?? []
    const dayIndex = Math.min(Math.max(activeDay, 0), Math.max(days.length - 1, 0))
    const day = days[dayIndex] ?? null
    return {
      plan,
      day,
      dayIndex,
      dayIds: day ? new Set(day.stops.map((stop) => stop.id)) : null,
      isMultiDay: days.length > 1,
      dayCount: days.length,
    }
  }, [plan, activeDay])
}

export function useOrderMap(): Map<string, number> {
  const { day, dayIds } = useDayScope()
  const destinations = useTripStore((s) => s.destinations)

  return useMemo(() => {
    const map = new Map<string, number>()
    if (day && day.stops.length) {
      day.stops.forEach((stop, index) => map.set(stop.id, index + 1))
      return map
    }
    if (dayIds) return map
    let order = 0
    for (const dest of destinations) {
      if (dest.selected) map.set(dest.id, ++order)
    }
    return map
  }, [day, dayIds, destinations])
}

/** 计划是否已经过期（选点/酒店/方式/权重/时间设置改过之后） */
export function usePlanStale(): boolean {
  const plan = useTripStore((s) => s.plan)
  const signature = useTripStore((s) => s.planSignature)
  const current = useTripStore((s) => s.currentSignature())
  return Boolean(plan) && signature !== current
}
