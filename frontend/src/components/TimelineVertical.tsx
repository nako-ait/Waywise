import { useState } from 'react'
import { fromHereNavUrl, navHint, previousPointFor, stopNavUrl } from '@/lib/amapNav'
import { formatMinutes, formatMoney } from '@/lib/geo'
import { isClosedToday } from '@/lib/amapParse'
import { modeStyle } from '@/lib/routeStyle'
import { useDayScope } from '@/lib/routeOrder'
import { useTripStore } from '@/store/useTripStore'
import TransitOptions from './TransitOptions'
import type { TravelMode } from '@/types'

/**
 * 竖排路书（1.1 主视图）：右侧栏 + 详情页共用。
 * readOnly 时隐藏编辑/切换动作，只保留「看」和「导航」。
 */
export default function TimelineVertical({ readOnly = false }: { readOnly?: boolean }) {
  const plan = useTripStore((s) => s.plan)
  const hotel = useTripStore((s) => s.hotel)
  const currentMode = useTripStore((s) => s.mode)
  const activeDay = useTripStore((s) => s.activeDay)
  const setActiveDay = useTripStore((s) => s.setActiveDay)
  const destinations = useTripStore((s) => s.destinations)
  const weights = useTripStore((s) => s.weights)
  const [showDetail, setShowDetail] = useState(false)
  const { day, dayIndex, isMultiDay, dayCount } = useDayScope()

  if (!plan || !day || !day.stops.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm text-slate-500">还没有路书</p>
        <p className="text-xs leading-5 text-slate-400">
          在左边和 AI 说一句话，地图会先标出地点；
          <br />
          把细节聊清楚后点「编译路书」。
        </p>
      </div>
    )
  }

  const meta = plan.solver
  const isAmap = meta?.dataSource === 'amap'
  const returnMode = modeStyle(meta?.mode ?? currentMode)
  const activeMode = (meta?.mode as TravelMode) ?? currentMode
  const totals = meta?.totalStats ?? day.stats

  return (
    <div className="flex h-full flex-col">
      {/* 顶部：日切换 + 统计 */}
      <div className="border-b border-slate-200 px-3 py-2">
        {isMultiDay && (
          <div className="mb-2 flex gap-1">
            {plan.days.map((item, index) => (
              <button
                key={item.date}
                onClick={() => setActiveDay(index)}
                className={`rounded px-2 py-1 text-[11px] transition-colors ${
                  index === activeDay
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Day {index + 1}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <span>
            步行 <b className="font-semibold text-slate-800">{totals.totalWalkKm} km</b>
          </span>
          <span>
            交通 <b className="font-semibold text-slate-800">{formatMinutes(totals.totalTransitMin)}</b>
          </span>
          <span>
            花费 <b className="font-semibold text-slate-800">{formatMoney(totals.totalCost)}</b>
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
          <span className="rounded bg-slate-100 px-1.5 py-0.5">{isAmap ? '高德实时' : '离线估算'}</span>
          {meta?.name && <span className="rounded bg-slate-100 px-1.5 py-0.5">{meta.name}</span>}
          {isMultiDay && <span>第 {dayIndex + 1}/{dayCount} 天</span>}
        </div>
      </div>

      {/* 时间轴主体 */}
      <div className="tc-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="flex gap-2">
          <div className="flex w-5 flex-col items-center">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] bg-[#1d4ed8]" />
            <span className="my-1 w-0.5 flex-1 bg-slate-200" />
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <div className="text-[13px] font-semibold text-slate-900">{hotel.name}</div>
            <div className="text-[10px] text-slate-400">出发 · 固定起点</div>
          </div>
        </div>

        {day.stops.map((stop, index) => {
          const leg = stop.transportFromPrev
          const style = modeStyle(leg?.mode ?? currentMode)
          const closedDays = destinations.find((item) => item.id === stop.id)?.closedWeekdays
          return (
            <div key={stop.id}>
              {/* 交通段 */}
              <div className="flex items-center gap-2 py-1 pl-7 text-[10px] text-slate-400">
                <span className="h-3 w-px bg-slate-200" />
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">{style.label}</span>
                <span>{leg ? `${Math.round(leg.durationMin)} 分 · ${leg.distanceKm} km` : '—'}</span>
                {leg?.approx && <span>*</span>}
                <TransitOptions options={leg?.transitOptions} />
              </div>

              <div className="flex gap-2">
                <div className="flex w-5 flex-col items-center">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[9px] font-semibold text-white">
                    {index + 1}
                  </span>
                  <span className="my-1 w-0.5 flex-1 bg-slate-200" />
                </div>
                <div className="min-w-0 flex-1 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-slate-900">{stop.name}</span>
                    <span className="shrink-0 text-[10px] text-slate-400">
                      {stop.arriveTime}–{stop.leaveTime}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
                    <span>停留 {stop.stayMin} 分</span>
                    {(stop.lunchMin ?? 0) > 0 && (
                      <span className="rounded bg-slate-100 px-1 text-slate-500">含午餐 {stop.lunchMin} 分</span>
                    )}
                    {isClosedToday(closedDays) && (
                      <span className="rounded bg-red-50 px-1 text-red-600">今天闭馆</span>
                    )}
                    {leg && leg.cost > 0 && <span>· {formatMoney(leg.cost)}</span>}
                  </div>
                  {!readOnly && (
                    <div className="mt-1 flex gap-2 text-[10px] text-slate-300">
                      <a
                        className="hover:text-slate-700"
                        href={stopNavUrl(stop, previousPointFor(day, index, hotel), activeMode, weights)}
                        target="_blank"
                        rel="noreferrer"
                        title={navHint(activeMode, weights)}
                      >
                        导航
                      </a>
                      <a
                        className="hover:text-slate-700"
                        href={fromHereNavUrl(stop, activeMode, weights)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        从我这出发
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {/* 回酒店 */}
        <div className="flex items-center gap-2 py-1 pl-7 text-[10px] text-slate-400">
          <span className="h-3 w-px bg-slate-200" />
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">{returnMode.label}</span>
          <span>
            {day.returnLeg
              ? `${Math.round(day.returnLeg.durationMin)} 分 · ${day.returnLeg.distanceKm} km`
              : '—'}
          </span>
          <TransitOptions options={day.returnLeg?.transitOptions} />
        </div>
        <div className="flex gap-2">
          <div className="flex w-5 flex-col items-center">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] bg-[#1d4ed8]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-slate-900">{hotel.name}</div>
            <div className="text-[10px] text-slate-400">预计 {day.returnTime ?? '—'} 到达</div>
          </div>
        </div>
      </div>

      {/* 底部：解释 */}
      <div className="border-t border-slate-200">
        <button
          className="flex w-full items-center justify-between px-3 py-2 text-[11px] text-slate-500 hover:bg-slate-50"
          onClick={() => setShowDetail((v) => !v)}
        >
          <span>{showDetail ? '收起说明' : '为什么这样排？'}</span>
          <span className="text-slate-300">{showDetail ? '收起' : '展开'}</span>
        </button>
        {showDetail && (
          <div className="tc-scroll max-h-32 overflow-y-auto border-t border-slate-100 bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-600">
            <p>{plan.explanation}</p>
            {(meta?.warnings ?? []).map((warning) => (
              <p key={warning} className="text-amber-700">{warning}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
