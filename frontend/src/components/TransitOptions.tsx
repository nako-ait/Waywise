import { useState } from 'react'
import type { TransitOption } from '@/types'

/**
 * 公交 / 地铁方案对比（像高德那样能看具体坐哪几趟车）。
 *
 * 触发按钮显示的是「直达 / 换乘 N 次」—— 这是乘客最先关心的信息；
 * 点开才展开每个方案的线路链（步行 → 地铁8号线 → 地铁9号线 → 步行）。
 * 这些方案本来就来自高德 `transits[]`（一次 5 条），以前只取第一条把多方案丢掉了。
 */
export default function TransitOptions({ options }: { options?: TransitOption[] | null }) {
  const [open, setOpen] = useState(false)
  if (!options?.length) return null

  const best = options[0]
  const direct = best.direct

  return (
    <div className="relative mt-0.5">
      <button
        className={`rounded px-1 text-[9px] leading-4 ${
          direct ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700'
        } hover:brightness-95`}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => !value)
        }}
        title="查看全部公交 / 地铁方案"
      >
        {direct ? '直达' : `换乘 ${best.transfers} 次`} ▾
      </button>

      {open && (
        <div
          className="absolute bottom-full left-1/2 z-30 mb-1 w-72 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-2 text-left shadow-panel"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="mb-1 flex items-center justify-between text-[10px] text-slate-400">
            <span>公交 / 地铁方案（{options.length} 条，按综合耗时排序）</span>
            <button className="px-1 hover:text-slate-600" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>

          {options.map((option, index) => (
            <div
              key={`${option.durationMin}-${option.label}`}
              className={`rounded px-1.5 py-1 ${index === 0 ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
            >
              <div className="flex flex-wrap items-center gap-1 text-[11px]">
                <span className="font-semibold text-slate-800">{Math.round(option.durationMin)} 分</span>
                <span className="text-slate-500">¥{option.cost.toFixed(0)}</span>
                <span className="text-slate-400">步行 {Math.round(option.walkKm * 1000)}m</span>
                <span
                  className={`rounded px-1 text-[9px] ${
                    option.direct ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {option.direct ? '直达' : `换乘 ${option.transfers} 次`}
                </span>
                {index === 0 && (
                  <span className="rounded bg-slate-900 px-1 text-[9px] text-white">最优</span>
                )}
              </div>

              {/* 线路链：步行段只显示距离，乘车段显示图标 + 线路名 */}
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-slate-600">
                {option.rides.length ? (
                  option.rides.map((ride, rideIndex) => (
                    <span key={`${ride.line}-${rideIndex}`} className="flex items-center gap-0.5">
                      {rideIndex > 0 && <span className="text-slate-300">→</span>}
                      <span className="font-medium">{ride.line}</span>
                      <span className="text-slate-400">
                        {ride.fromStop}→{ride.toStop}
                      </span>
                    </span>
                  ))
                ) : (
                  <span className="text-slate-400">全程步行</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
