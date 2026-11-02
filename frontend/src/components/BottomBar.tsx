import { useMemo, useState } from 'react'
import { usePlanController } from '@/hooks/usePlanController'
import { formatMinutes, formatMoney, straightKm } from '@/lib/geo'
import { usePlanStale } from '@/lib/routeOrder'
import { useTripStore } from '@/store/useTripStore'
import ModeSwitch from './ModeSwitch'

const WEIGHT_META: Array<{ key: 'time' | 'convenience' | 'cost' | 'walking'; label: string; hint: string }> = [
  { key: 'time', label: '时间', hint: '少在路上耗' },
  { key: 'convenience', label: '换乘', hint: '少换乘少折腾' },
  { key: 'cost', label: '花费', hint: '减少交通费用' },
  { key: 'walking', label: '步行', hint: '少走路' },
]

/**
 * 底部总览条：交通方式切换 + 统计 + 编译入口。
 * 没有路书时显示直线里程估算；编译后显示真实统计（步行/交通时间/费用）。
 */
export default function BottomBar() {
  const hotel = useTripStore((s) => s.hotel)
  const endMode = useTripStore((s) => s.endMode)
  const endPoint = useTripStore((s) => s.endPoint)
  const destinations = useTripStore((s) => s.destinations)
  const plan = useTripStore((s) => s.plan)
  const planError = useTripStore((s) => s.planError)
  const days = useTripStore((s) => s.days)
  const setDays = useTripStore((s) => s.setDays)
  const weights = useTripStore((s) => s.weights)
  const setWeight = useTripStore((s) => s.setWeight)
  const legModes = useTripStore((s) => s.legModes)
  const { run, planning, prewarm } = usePlanController()
  const stale = usePlanStale()

  const [prewarming, setPrewarming] = useState(false)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const picked = useMemo(() => destinations.filter((d) => d.selected), [destinations])
  const manualCount = Object.keys(legModes).filter((key) => key === '__return__' || picked.some((d) => d.id === key)).length
  const day = plan?.days?.[0]
  /** 多日路书优先显示「全行程合计」，单日就是当天 */
  const totals = plan?.solver?.totalStats ?? day?.stats
  const isMultiDay = (plan?.days?.length ?? 0) > 1

  /** 没有路书时的粗略估算：酒店 → 各选中点（按列表顺序）→ 酒店 的直线距离 */
  const estimate = useMemo(() => {
    if (!picked.length) return { km: 0, stayMin: 0 }
    const terminal = endMode === 'return' ? hotel : endMode === 'custom' ? endPoint : null
    const route = [hotel, ...picked, ...(terminal ? [terminal] : [])]
    let km = 0
    for (let i = 1; i < route.length; i += 1) km += straightKm(route[i - 1], route[i])
    return { km, stayMin: picked.reduce((sum, d) => sum + (d.stayMin ?? 60), 0) }
  }, [hotel, picked, endMode, endPoint])

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
    <footer className="waywise-bottom-bar relative flex h-16 shrink-0 items-center gap-4 border-t border-slate-200 bg-white px-4">
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

      {/* 路线偏好（原来的意图卡搬到这里，点开才展开） */}
      <div className="waywise-preferences relative">
        <button
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
            prefsOpen
              ? 'border-amber-300 bg-amber-50 text-amber-800'
              : 'border-amber-200 bg-amber-50/60 text-amber-700 hover:bg-amber-50'
          }`}
          onClick={() => setPrefsOpen((value) => !value)}
          title="时间 / 换乘 / 花费 / 步行 四个偏好"
        >
          <span className="font-medium">路线偏好</span>
          <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700">
            时间 {weights.time.toFixed(1)} · 少走路 {weights.walking.toFixed(1)}
          </span>
          <span className="text-[9px] text-amber-500">{prefsOpen ? '▾' : '▸'}</span>
        </button>

        {prefsOpen && (
          <div className="waywise-preferences-panel absolute bottom-full left-0 z-30 mb-2 w-[320px] rounded-xl border border-amber-200 bg-white p-3 shadow-[0_20px_44px_-24px_rgba(15,23,42,.45)]">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12px] font-semibold text-slate-800">路线偏好</span>
              <span className="text-[10px] text-slate-400">往哪边拖，求解器就更在意哪边</span>
            </div>
            <p className="mb-2 text-[10px] leading-4 text-slate-500">
              {manualCount > 0
                ? `有 ${manualCount} 段交通已手动指定。“重选交通”会恢复自动，再按偏好比较。`
                : '自动路段会比较交通方式；综合评分不变时也可能沿用原方案。'}
            </p>
            <div className="space-y-2">
              {WEIGHT_META.map(({ key, label, hint }) => (
                <div key={key}>
                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <span>{label}</span>
                    <span className="text-slate-400">{hint}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.1}
                      value={weights[key]}
                      onChange={(event) => setWeight(key, Number(event.target.value))}
                      className="h-1 min-w-0 flex-1 cursor-pointer accent-amber-600"
                    />
                    <span className="w-7 text-right text-[10px] font-medium text-slate-600">
                      {weights[key].toFixed(1)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
              <button
                className="text-[10px] text-slate-400 hover:text-slate-700"
                onClick={() => {
                  setWeight('time', 0.6)
                  setWeight('convenience', 0.5)
                  setWeight('cost', 0.4)
                  setWeight('walking', 0.5)
                }}
              >
                恢复默认
              </button>
              <button
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] text-white hover:bg-slate-800 disabled:bg-slate-300"
                onClick={() => {
                  void run({ reselectTransport: true })
                  setPrefsOpen(false)
                }}
                disabled={planning || picked.length === 0}
              >
                按偏好重选交通
              </button>
            </div>
            {manualCount > 0 && (
              <button className="mt-2 w-full text-right text-[10px] text-slate-500 hover:text-slate-800 disabled:opacity-50"
                disabled={planning || picked.length === 0} onClick={() => { void run(); setPrefsOpen(false) }}>
                保留指定交通重算
              </button>
            )}
          </div>
        )}
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
            : `${picked.length} 个点 · ${days} 天 · ${endMode === 'return' ? '返回起点' : endMode === 'last_stop' ? '最后一站结束' : endPoint ? '独立终点' : '待选终点'}`}
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


