import { useState } from 'react'
import { fromHereNavUrl, navHint, previousPointFor, stopNavUrl } from '@/lib/amapNav'
import { formatMinutes, formatMoney } from '@/lib/geo'
import { isClosedToday } from '@/lib/amapParse'
import { MODE_ORDER, MODE_STYLES, modeStyle } from '@/lib/routeStyle'
import { useDayScope } from '@/lib/routeOrder'
import { usePlanController } from '@/hooks/usePlanController'
import { useTripStore } from '@/store/useTripStore'
import AddStopDialog from './AddStopDialog'
import TransitOptions from './TransitOptions'
import type { TransportLeg, TravelMode } from '@/types'

/**
 * 竖排路书（1.1 主视图）：右侧栏 + 详情页共用。
 * readOnly 时隐藏编辑/切换动作，只保留「看」和「导航」。
 */
const STAY_PRESETS = [30, 45, 60, 90, 120, 150, 180, 240, 300]

/** 停留时长下拉的可选项：固定档位 + 当前值（保证任意已存时长都能显示） */
function stayOptions(current: number): number[] {
  return [...new Set([...STAY_PRESETS, current])].sort((a, b) => a - b)
}

export default function TimelineVertical({ readOnly = false }: { readOnly?: boolean }) {
  const plan = useTripStore((s) => s.plan)
  const hotel = useTripStore((s) => s.hotel)
  const currentMode = useTripStore((s) => s.mode)
  const activeDay = useTripStore((s) => s.activeDay)
  const setActiveDay = useTripStore((s) => s.setActiveDay)
  const destinations = useTripStore((s) => s.destinations)
  const weights = useTripStore((s) => s.weights)
  const legModes = useTripStore((s) => s.legModes)
  const selectedLeg = useTripStore((s) => s.selectedLeg)
  const setSelectedLeg = useTripStore((s) => s.setSelectedLeg)
  const setLegMode = useTripStore((s) => s.setLegMode)
  const clearLegMode = useTripStore((s) => s.clearLegMode)
  const updateDestination = useTripStore((s) => s.updateDestination)
  const showToast = useTripStore((s) => s.showToast)
  const { run, planning } = usePlanController()
  const [showDetail, setShowDetail] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const { day, dayIndex, isMultiDay, dayCount } = useDayScope()

  /** 改完一段的方式/删掉一个点之后，立刻重算整份路书 */
  function recompile(action: () => void, message: string) {
    action()
    showToast('success', message)
    // 等 store 落地后再重算（run 内部用 getState 取值）
    window.setTimeout(() => void run(), 0)
  }

  function legSwitcher(legKey: string | null, current: TravelMode, leg?: TransportLeg | null) {
    if (readOnly) return null
    const manual = Boolean(legKey && legModes[legKey])
    const rides = current === (leg?.transportMode ?? leg?.mode) ? leg?.transitOptions?.[0]?.rides : undefined
    const rideKinds = [...new Set(rides?.map((ride) => ride.kind).filter(Boolean) ?? [])]
    const label = (current === 'transit' || current === 'subway') && rideKinds.length
      ? rideKinds.join('＋') : MODE_STYLES[current].label
    return (
      <>
        <span className="flex basis-full flex-wrap items-center gap-1.5">
          <span className="rounded bg-slate-900 px-1.5 py-0.5 font-medium text-white">当前：{label}</span>
          <span className="text-slate-500">{manual ? '手动指定' : '自动选择'}</span>
          {manual && (
            <button
              className="rounded border border-slate-200 px-1 py-0.5 text-[9px] leading-3 text-sky-700 hover:bg-sky-50 disabled:opacity-50"
              title="取消手动指定，按当前路线偏好重新选择这一段的交通方式"
              disabled={planning || !legKey}
              onClick={() => { if (legKey) recompile(() => clearLegMode(legKey), '这一段恢复自动选择，正在重算') }}
            >恢复自动</button>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-0.5">
          <span className="mr-0.5 text-[9px] text-slate-400">改为</span>
        {MODE_ORDER.map((key) => (
          <button
            key={key}
            className={`rounded px-1 py-0.5 text-[9px] leading-3 transition-colors ${
              current === key
                ? 'bg-slate-200 font-medium text-slate-800'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
            title={`指定这一段为${MODE_STYLES[key].label}，调整偏好时会保留`}
            disabled={planning || !legKey}
            onClick={() => {
              if (!legKey) return
              recompile(
                () => setLegMode(legKey, key),
                `这一段改成${MODE_STYLES[key].label}，正在重算`,
              )
            }}
          >
            {MODE_STYLES[key].label}
          </button>
        ))}
        </span>
      </>
    )
  }

  function legFeedback(leg: TransportLeg | null | undefined) {
    const isTaxi = (leg?.transportMode ?? leg?.mode) === 'taxi'
    const checkedAt = leg?.queriedAt ? new Date(leg.queriedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : null
    return (
      <>
        {isTaxi && (
          <span className="basis-full text-[10px] leading-4 text-slate-500">
            {leg?.costSource === 'amap_taxi_estimate' ? '高德出租车费用估算' : '本地费用估算，未取得平台报价'}
            {checkedAt ? ` · ${checkedAt}查询${leg?.cacheHit ? '（缓存）' : ''}` : ''}
            ；不含叫车等待
          </span>
        )}
        {leg?.isAutoOptimized && (
          <span className="basis-full text-[10px] leading-4 text-sky-700" title={leg.optimizationReason ?? undefined}>
            ⚡ {leg.optimizationReason ?? '已按实际路线调整交通方式'}
          </span>
        )}
        {leg?.optimizationHint && (
          <span className="basis-full text-[10px] leading-4 text-amber-700">
            💡 {leg.optimizationHint}
          </span>
        )}
      </>
    )
  }

  function legCost(leg: TransportLeg | null | undefined) {
    if (!leg) return null
    const label = leg.cost === 0 ? '¥0' : `${leg.costApprox !== false ? '约' : ''}${formatMoney(leg.cost)}`
    return <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">本段交通费 {label}</span>
  }

  if (!plan || !day || !day.stops.length) {
    const dropped = (plan?.solver?.dropped ?? []) as Array<{ id?: string; name: string; reason: string }>
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm text-slate-500">还没有路书</p>
        <p className="text-xs leading-5 text-slate-400">
          在左边和 AI 说一句话，地图会先标出地点；
          <br />
          把细节聊清楚后点「编译路书」。
        </p>
        {dropped.map((item) => (
          <p key={item.id ?? item.name} className="text-xs leading-5 text-amber-700">
            {item.name}未排入：{item.reason}
          </p>
        ))}
      </div>
    )
  }

  const meta = plan.solver
  const isAmap = meta?.dataSource === 'amap'
  const returnMode = modeStyle(day.returnLeg?.transportMode ?? day.returnLeg?.mode ?? meta?.mode ?? currentMode)
  const totals = meta?.totalStats ?? day.stats
  const dropped = (meta?.dropped ?? []) as Array<{ id?: string; name: string; reason: string; day?: string }>

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
            交通费约 <b className="font-semibold text-slate-800">{formatMoney(totals.totalCost)}</b>
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
          <span className="rounded bg-slate-100 px-1.5 py-0.5">{isAmap ? '高德路线' : '离线估算'}</span>
          {!readOnly && <button className="ml-auto rounded border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50 disabled:opacity-50" disabled={planning} onClick={() => void run()}>{planning ? '核算中…' : '重新核算交通'}</button>}
          {meta?.name && <span className="rounded bg-slate-100 px-1.5 py-0.5">{meta.name}</span>}
          {isMultiDay && <span>第 {dayIndex + 1}/{dayCount} 天</span>}
        </div>
      </div>

      {dropped.filter((item) => !item.day || item.day === day.title).map((item) => (
        <div key={item.id ?? item.name} className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-[10px] leading-4 text-amber-800">
          {item.name}未排入：{item.reason}
        </div>
      ))}

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
          const style = modeStyle(leg?.transportMode ?? leg?.mode ?? currentMode)
          const fromName = index === 0 ? hotel.name : day.stops[index - 1].name
          const closedDays = destinations.find((item) => item.id === stop.id)?.closedWeekdays
          return (
            <div key={stop.id}>
              {/* 交通段：可以直接改这一段的方式；点一下 = 在地图上高亮这一段 */}
              <div
                className={`flex cursor-pointer flex-wrap items-center gap-2 rounded py-1 pl-7 text-[10px] transition-colors ${
                  selectedLeg === index ? 'bg-blue-50 text-slate-600' : 'text-slate-400 hover:bg-slate-50'
                }`}
                onClick={() => setSelectedLeg(selectedLeg === index ? null : index)}
              >
                <span className="basis-full truncate text-[10px] text-slate-500" title={`${fromName} → ${stop.name}`}>
                  {fromName} → {stop.name}
                </span>
                {readOnly ? (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">{style.icon} {style.label}</span>
                ) : (
                  // 以 store 里的逐段覆盖为准（点了立刻高亮，不用等编译回来）
                  legSwitcher(stop.id, (legModes[stop.id] as TravelMode) ?? style.key, leg)
                )}
                <span>{leg ? `约${Math.round(leg.durationMin)} 分 · ${leg.distanceKm} km` : '—'}</span>
                {legCost(leg)}
                {leg?.approx && <span>*</span>}
                <TransitOptions options={leg?.transitOptions} />
                {legFeedback(leg)}
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
                    <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-slate-400">
                      {stop.arriveTime}–{stop.leaveTime}
                      {!readOnly && (
                        <button
                          className="text-slate-300 hover:text-red-500"
                          title="从路书里移除这个点"
                          disabled={planning}
                          onClick={() =>
                            recompile(
                              () => updateDestination(stop.id, { selected: false }),
                              `已移除「${stop.name}」`,
                            )
                          }
                        >
                          ×
                        </button>
                      )}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
                    {readOnly ? (
                      <span>停留 {stop.stayMin} 分</span>
                    ) : (
                      <label
                        className="flex items-center gap-1"
                        title="调整这个点的停留时长，改完自动重算时间轴"
                      >
                        <span>停留</span>
                        <select
                          className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-600 outline-none focus:border-slate-500 disabled:opacity-50"
                          value={stop.stayMin}
                          disabled={planning}
                          onChange={(event) => {
                            const value = Number(event.target.value)
                            if (!Number.isFinite(value) || value === stop.stayMin) return
                            recompile(
                              () => updateDestination(stop.id, { stayMin: value }),
                              `「${stop.name}」停留改为 ${value} 分钟，正在重算`,
                            )
                          }}
                        >
                          {stayOptions(stop.stayMin).map((v) => (
                            <option key={v} value={v}>
                              {v} 分钟
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {(stop.lunchMin ?? 0) > 0 && (
                      <span className="rounded bg-slate-100 px-1 text-slate-500">含午餐 {stop.lunchMin} 分</span>
                    )}
                    {isClosedToday(closedDays) && (
                      <span className="rounded bg-red-50 px-1 text-red-600">今天闭馆</span>
                    )}
                  </div>
                  {!readOnly && (
                    <div className="mt-1 flex gap-2 text-[10px] text-slate-300">
                      <a
                        className="hover:text-slate-700"
                        href={stopNavUrl(stop, previousPointFor(day, index, hotel), style.key, weights)}
                        target="_blank"
                        rel="noreferrer"
                        title={navHint(style.key, weights)}
                      >
                        导航
                      </a>
                      <a
                        className="hover:text-slate-700"
                        href={fromHereNavUrl(stop, style.key, weights)}
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
        <div className="flex flex-wrap items-center gap-2 py-1 pl-7 text-[10px] text-slate-400">
          <span className="basis-full truncate text-[10px] text-slate-500" title={`${day.stops[day.stops.length - 1].name} → ${hotel.name}`}>
            {day.stops[day.stops.length - 1].name} → {hotel.name}
          </span>
          {readOnly ? (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">{returnMode.label}</span>
          ) : (
            legSwitcher(
              '__return__',
              (legModes.__return__ as TravelMode) ?? returnMode.key,
              day.returnLeg,
            )
          )}
          <span>
            {day.returnLeg
              ? `约${Math.round(day.returnLeg.durationMin)} 分 · ${day.returnLeg.distanceKm} km`
              : '—'}
          </span>
          {legCost(day.returnLeg)}
          <TransitOptions options={day.returnLeg?.transitOptions} />
          {legFeedback(day.returnLeg)}
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

        {!readOnly && (
          <button
            className="mt-2 w-full rounded-lg border border-dashed border-slate-300 py-1.5 text-[11px] text-slate-500 transition-colors hover:border-slate-500 hover:text-slate-800 disabled:opacity-50"
            onClick={() => setAddOpen(true)}
            disabled={planning}
          >
            + 添加地点
          </button>
        )}
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

      <AddStopDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={() => window.setTimeout(() => void run(), 0)}
      />
    </div>
  )
}


