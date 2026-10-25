import { useMemo, useState } from 'react'
import { usePlanController } from '@/hooks/usePlanController'
import { formatMinutes, formatMoney, straightKm } from '@/lib/geo'
import { usePlanStale } from '@/lib/routeOrder'
import { useTripStore } from '@/store/useTripStore'
import ModeSwitch from './ModeSwitch'

/**
 * 底部总览条：交通方式切换 + 统计 + 编译入口。
 * 没有路书时显示直线里程估算；编译后显示真实统计（步行/交通时间/费用）。
 */
export default function BottomBar() {
  const hotel = useTripStore((s) => s.hotel)
  const destinations = useTripStore((s) => s.destinations)
  const plan = useTripStore((s) => s.plan)
  const planError = useTripStore((s) => s.planError)
  const days = useTripStore((s) => s.days)
  const setDays = useTripStore((s) => s.setDays)
  const { run, planning, prewarm } = usePlanController()
  const stale = usePlanStale()

  const [prewarming, setPrewarming] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const picked = useMemo(() => destinations.filter((d) => d.selected), [destinations])
  const day = plan?.days?.[0]
  /** 多日路书优先显示「全行程合计」，单日就是当天 */
  const totals = plan?.solver?.totalStats ?? day?.stats
  const isMultiDay = (plan?.days?.length ?? 0) > 1

  /** 没有路书时的粗略估算：酒店 → 各选中点（按列表顺序）→ 酒店 的直线距离 */
  const estimate = useMemo(() => {
    if (!picked.length) return { km: 0, stayMin: 0 }
    const route = [hotel, ...picked, hotel]
    let km = 0
    for (let i = 1; i < route.length; i += 1) km += straightKm(route[i - 1], route[i])
    return { km, stayMin: picked.reduce((sum, d) => sum + (d.stayMin ?? 60), 0) }
  }, [hotel, picked])

  async function handlePrewarm() {
    setPrewarming(true)
    setToast(null)
    try {
      const result = await prewarm()
      setToast(
        result.warmed
          ? `已预热 ${result.warmed} 段路径，演示时命中本地缓存`
          : String(result.message ?? '无需预热'),
      )
    } catch (err) {
      setToast(err instanceof Error ? err.message : '预热失败')
    } finally {
      setPrewarming(false)
    }
  }

  return (
    <footer className="flex h-16 shrink-0 items-center gap-4 border-t border-slate-200 bg-white px-4">
      <ModeSwitch />

      {/* 天数：意图卡删掉之后，天数收到这里 */}
      <div className="flex items-center gap-1 border-l border-slate-200 pl-4">
        <span className="text-[11px] text-slate-400">天数</span>
        <button
          className="h-5 w-5 rounded border border-slate-300 text-[11px] leading-none hover:bg-slate-50 disabled:opacity-40"
          onClick={() => setDays(days - 1)}
          disabled={days <= 1}
        >
          −
        </button>
        <b className="w-5 text-center text-sm text-slate-800">{days}</b>
        <button
          className="h-5 w-5 rounded border border-slate-300 text-[11px] leading-none hover:bg-slate-50 disabled:opacity-40"
          onClick={() => setDays(days + 1)}
          disabled={days >= 7}
        >
          +
        </button>
      </div>

      <div className="flex items-baseline gap-2 border-l border-slate-200 pl-4">
        <span className="text-[11px] text-slate-400">候选 / 选中</span>
        <span className="text-sm font-semibold text-slate-800">
          {destinations.length} / <span className="text-picked">{picked.length}</span>
        </span>
      </div>

      {totals ? (
        <>
          <div className="flex items-baseline gap-2 border-l border-slate-200 pl-4">
            <span className="text-[11px] text-slate-400">{isMultiDay ? '全程步行' : '步行'}</span>
            <span className="text-sm font-semibold text-slate-800">{totals.totalWalkKm} km</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] text-slate-400">{isMultiDay ? '全程交通' : '交通'}</span>
            <span className="text-sm font-semibold text-slate-800">
              {formatMinutes(totals.totalTransitMin)}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] text-slate-400">{isMultiDay ? '全程费用' : '费用'}</span>
            <span className="text-sm font-semibold text-slate-800">
              {formatMoney(totals.totalCost)}
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] text-slate-400">直线里程（估算）</span>
            <span className="text-sm font-semibold text-slate-800">
              {estimate.km.toFixed(1)} km
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] text-slate-400">停留合计</span>
            <span className="text-sm font-semibold text-slate-800">
              {formatMinutes(estimate.stayMin)}
            </span>
          </div>
        </>
      )}

      {planError && (
        <span className="max-w-[280px] truncate text-[11px] text-red-600" title={planError}>
          {planError}
        </span>
      )}
      {toast && !planError && (
        <span className="max-w-[280px] truncate text-[11px] text-slate-500" title={toast}>
          {toast}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {stale && !planError && (
          <span className="text-[11px] text-orange-600">选点已变，建议重新编译</span>
        )}
        <span className="hidden text-[11px] leading-4 text-slate-400 lg:block">
          {picked.length < 1
            ? '至少选中 1 个目的地'
            : `${picked.length} 个点 · ${days} 天 · 酒店往返闭环`}
        </span>        <button
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          onClick={() => void handlePrewarm()}
          disabled={prewarming || planning || picked.length === 0}
          title="把距离矩阵与所有分段路径写入后端缓存，演示时不受高德限流影响"
        >
          {prewarming ? '预热中…' : '预热缓存'}
        </button>
        <button
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
          onClick={() => void run()}
          disabled={planning || picked.length === 0}
        >
          {planning ? '编译中…' : plan ? '重新编译' : '一键编译路书'}
        </button>
      </div>
    </footer>
  )
}

