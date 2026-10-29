/**
 * 路书编译的控制器：把「读状态 → 拼请求 → 调后端 → 写结果」收在一处，
 * 让 BottomBar / ModeSwitch / 时间轴的「重规划」按钮共用同一套逻辑。
 */
import { useCallback } from 'react'
import { planRoute, prewarmPlan } from '@/api/client'
import { useTripStore } from '@/store/useTripStore'
import type { PlanRequest } from '@/types'

/** 每次读取最新状态；重选交通是明确操作，普通重算仍保留逐段指定。 */
export function buildPlanPayload(options?: { reselectTransport?: boolean }): PlanRequest {
  if (options?.reselectTransport) {
    const state = useTripStore.getState()
    // 恢复自动时用公共交通矩阵排序，避免沿用步行矩阵提前漏掉可乘车到达的点。
    // 自驾仍保留车辆连续性。
    if (state.mode === 'drive') state.clearLegModes()
    else state.setMode('transit')
  }
  const s = useTripStore.getState()
  return {
    hotel: { lng: s.hotel.lng, lat: s.hotel.lat, name: s.hotel.name },
    destinations: s.destinations.filter((d) => d.selected),
    days: s.days, mode: s.mode, weights: s.weights,
    legModes: Object.fromEntries(Object.entries(s.legModes).filter(([key]) =>
      key === '__return__' || s.destinations.some((d) => d.id === key && d.selected),
    )),
    options: { dayStartTime: s.options.dayStartTime, dayEndTime: s.options.dayEndTime,
      lunchBreakMin: s.options.lunchBreakMin },
  }
}

export function usePlanController() {
  const planning = useTripStore((s) => s.planning)
  const setPlanning = useTripStore((s) => s.setPlanning)
  const setPlan = useTripStore((s) => s.setPlan)
  const setPlanError = useTripStore((s) => s.setPlanError)

  /** 从 store 里现取状态拼请求（避免闭包拿到旧值） */
  const buildPayload = useCallback(() => buildPlanPayload(), [])

  const run = useCallback(async (options?: { reselectTransport?: boolean }) => {
    const payload = buildPlanPayload(options)
    if (payload.destinations.length === 0) {
      setPlanError('至少选中 1 个目的地才能编译路书')
      return
    }
    const requestedSignature = useTripStore.getState().currentSignature()
    setPlanning(true)
    setPlanError(null)
    try {
      const plan = await planRoute(payload)
      if (requestedSignature === useTripStore.getState().currentSignature()) {
        setPlan(plan)
      } else {
        setPlanError('偏好或路线已再次变化，请按当前设置重新编译')
      }
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
