import { useState } from 'react'
import { usePlanStale } from '@/lib/routeOrder'
import { useTripStore } from '@/store/useTripStore'
import type { Weights } from '@/types'

const WEIGHT_META: Array<{ key: keyof Weights; label: string; hint: string }> = [
  { key: 'time', label: '时间', hint: '尽量少花时间在路上' },
  { key: 'convenience', label: '换乘', hint: '少换乘、少等车（公交/地铁更敏感）' },
  { key: 'cost', label: '花费', hint: '省钱优先（1 元 ≈ 3 分钟当量）' },
  { key: 'walking', label: '步行', hint: '少走路（1 公里 ≈ 13.3 分钟当量）' },
]

/**
 * 行程参数面板（模块 3）：天数、权重滑杆、出发/收工时间、午餐时长。
 * 这里的每一项都会改变输入指纹，从而让「计划已过期」提示亮起来。
 */
export default function TripParamsPanel() {
  const [open, setOpen] = useState(true)

  const days = useTripStore((s) => s.days)
  const setDays = useTripStore((s) => s.setDays)
  const weights = useTripStore((s) => s.weights)
  const setWeight = useTripStore((s) => s.setWeight)
  const options = useTripStore((s) => s.options)
  const setOption = useTripStore((s) => s.setOption)
  const stale = usePlanStale()

  return (
    <section className="border-b border-slate-200">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50"
        onClick={() => setOpen((v) => !v)}
      >
        <h2 className="text-sm font-semibold text-slate-800">
          行程参数
          <span className="ml-1.5 text-[11px] font-normal text-slate-400">
            {days} 天 · 权重可调
          </span>
        </h2>
        <span className="text-[11px] text-slate-400">{open ? '收起' : '展开'}</span>
      </button>

      {open && (
        <div className="space-y-3 px-3 pb-3">
          {/* 天数 */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-600">行程天数</span>
            <div className="flex items-center gap-1.5">
              <button
                className="h-6 w-6 rounded border border-slate-300 text-sm leading-none text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                onClick={() => setDays(days - 1)}
                disabled={days <= 1}
              >
                −
              </button>
              <span className="w-8 text-center text-sm font-semibold text-slate-800">{days}</span>
              <button
                className="h-6 w-6 rounded border border-slate-300 text-sm leading-none text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                onClick={() => setDays(days + 1)}
                disabled={days >= 7}
              >
                ＋
              </button>
              <span className="text-[11px] text-slate-400">天</span>
            </div>
          </div>

          {/* 时间设置 */}
          <div className="flex items-center gap-2">
            <label className="flex flex-1 items-center gap-1 text-xs text-slate-600">
              出发
              <input
                type="time"
                value={options.dayStartTime}
                onChange={(e) => setOption('dayStartTime', e.target.value)}
                className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-0.5 text-xs outline-none focus:border-blue-400"
              />
            </label>
            <label className="flex flex-1 items-center gap-1 text-xs text-slate-600">
              收工
              <input
                type="time"
                value={options.dayEndTime}
                onChange={(e) => setOption('dayEndTime', e.target.value)}
                className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-0.5 text-xs outline-none focus:border-blue-400"
              />
            </label>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-600">午餐时间</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={180}
                step={15}
                value={options.lunchBreakMin}
                onChange={(e) => setOption('lunchBreakMin', Number(e.target.value) || 0)}
                className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-xs outline-none focus:border-blue-400"
              />
              <span className="text-[11px] text-slate-400">分钟（0 = 不安排）</span>
            </div>
          </div>

          {/* 权重滑杆 */}
          <div className="space-y-1.5 border-t border-slate-100 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600">偏好权重</span>
              <span className="text-[10px] text-slate-400">进入目标函数，重新编译后生效</span>
            </div>
            {WEIGHT_META.map(({ key, label, hint }) => (
              <div key={key} className="flex items-center gap-2" title={hint}>
                <span className="w-14 shrink-0 text-[11px] text-slate-500">{label}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={weights[key]}
                  onChange={(e) => setWeight(key, Number(e.target.value))}
                  className="h-1.5 min-w-0 flex-1 cursor-pointer accent-slate-700"
                />
                <span className="w-8 shrink-0 text-right text-[11px] font-medium text-slate-600">
                  {weights[key].toFixed(1)}
                </span>
              </div>
            ))}
          </div>

          {stale && (
            <p className="rounded bg-orange-50 px-2 py-1 text-[11px] text-orange-600">
              参数已变更，点右下角「重新编译」生效
            </p>
          )}
        </div>
      )}
    </section>
  )
}
