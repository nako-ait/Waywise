import { useTripStore } from '@/store/useTripStore'

/**
 * 多日切换条（模块 3）。只有多日路书才出现。
 * 切换会同时改变：地图上的路线与橙色序号、底部时间轴、以及「其他天」的点回到灰色候选态。
 */
export default function DayTabs() {
  const plan = useTripStore((s) => s.plan)
  const activeDay = useTripStore((s) => s.activeDay)
  const setActiveDay = useTripStore((s) => s.setActiveDay)

  const days = plan?.days ?? []
  if (days.length <= 1) return null
  const total = plan?.solver?.totalStats

  return (
    <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-t border-slate-200 bg-slate-50 px-4 py-1.5 tc-scroll">
      {days.map((day, index) => {
        const active = index === activeDay
        return (
          <button
            key={day.date}
            onClick={() => setActiveDay(index)}
            className={`shrink-0 rounded-lg border px-2.5 py-1 text-left transition-colors ${
              active
                ? 'border-slate-800 bg-white shadow-sm'
                : 'border-slate-200 bg-white/60 hover:border-slate-300'
            }`}
          >
            <div className={`text-[11px] font-semibold ${active ? 'text-slate-900' : 'text-slate-600'}`}>
              {day.title ?? `第${index + 1}天`}
            </div>
            <div className="text-[10px] text-slate-400">
              {day.stops.length} 站 · {day.stats.totalWalkKm} km · {day.date.slice(5)}
            </div>
          </button>
        )
      })}
      {total && (
        <span className="ml-auto shrink-0 text-[11px] text-slate-400">
          全程合计：步行 {total.totalWalkKm} km · 交通 {Math.round(total.totalTransitMin)} 分钟 ·{' '}
          {total.totalCost.toFixed(1)} 元
        </span>
      )}
    </div>
  )
}
