/**
 * 路书编译的控制器：把「读状态 → 拼请求 → 调后端 → 写结果」收在一处，
 * 让 BottomBar / ModeSwitch / 时间轴的「重规划」按钮共用同一套逻辑。
 */
import { useCallback } from 'react'
import { planRoute, prewarmPlan } from '@/api/client'
import { useTripStore } from '@/store/useTripStore'
import type { PlanRequest } from '@/types'

export function usePlanController() {
  const planning = useTripStore((s) => s.planning)
  const setPlanning = useTripStore((s) => s.setPlanning)
  const setPlan = useTripStore((s) => s.setPlan)
  const setPlanError = useTripStore((s) => s.setPlanError)

  /** 从 store 里现取状态拼请求（避免闭包拿到旧值） */
  const buildPayload = useCallback((): PlanRequest => {
    const s = useTripStore.getState()
    return {
      hotel: { lng: s.hotel.lng, lat: s.hotel.lat, name: s.hotel.name },
      // 只把选中的点发给后端；selected 字段一并带上，后端会再过滤一次
      destinations: s.destinations.filter((d) => d.selected),
      days: s.days,
      mode: s.mode,
      // 逐段覆盖：只带上"还存在的点"，避免残留已删地点的覆盖
      legModes: Object.fromEntries(
        Object.entries(s.legModes).filter(
          ([key]) =>
            key === '__return__' || s.destinations.some((d) => d.id === key && d.selected),
        ),
      ),
      weights: s.weights,
      options: {
        dayStartTime: s.options.dayStartTime,
        dayEndTime: s.options.dayEndTime,
        lunchBreakMin: s.options.lunchBreakMin,
      },
    }
  }, [])

  const run = useCallback(async () => {
    const payload = buildPayload()
    if (payload.destinations.length === 0) {
      setPlanError('至少选中 1 个目的地才能编译路书')
      return
    }
    setPlanning(true)
    setPlanError(null)
    try {
      const plan = await planRoute(payload)
      setPlan(plan)
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : '编译失败')
    } finally {
      setPlanning(false)
    }
  }, [buildPayload, setPlan, setPlanError, setPlanning])

  /** 演示前预热：让后端把距离矩阵与所有分段路径写进 SQLite 缓存 */
  const prewarm = useCallback(async (): Promise<Record<string, unknown>> => {
    return prewarmPlan(buildPayload())
  }, [buildPayload])

  return { run, planning, buildPayload, prewarm }
}
