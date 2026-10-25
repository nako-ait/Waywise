import { useState } from 'react'
import { formatMinutes, formatMoney } from '@/lib/geo'
import {
  fromHereNavUrl,
  navHint,
  previousPointFor,
  stopNavUrl,
} from '@/lib/amapNav'
import { useDayScope, useOrderMap, usePlanStale } from '@/lib/routeOrder'
import { isClosedToday } from '@/lib/amapParse'
import { modeStyle } from '@/lib/routeStyle'
import { useTripStore } from '@/store/useTripStore'
import TransitOptions from './TransitOptions'
import type { TravelMode } from '@/types'

/**
 * 底部时间轴：酒店 → 每一站的到达/停留/交通 → 返回酒店。
 * 多日路书时只展示「当前选中的那一天」（由 DayTabs 切换）。
 */
export default function Timeline() {
  const plan = useTripStore((s) => s.plan)
  const hotel = useTripStore((s) => s.hotel)
  const currentMode = useTripStore((s) => s.mode)
  const destinations = useTripStore((s) => s.destinations)
  const stale = usePlanStale()
  const orderMap = useOrderMap()
  const { day, dayIndex, isMultiDay } = useDayScope()
  const [showDetail, setShowDetail] = useState(false)

  if (!plan || !day || !day.stops.length) return null

  const meta = plan.solver
  const isAmap = meta?.dataSource === 'amap'
  const returnMode = modeStyle(meta?.mode ?? currentMode)
  /** 导航用当前实际采用的交通方式（路书里的方式优先） */
  const activeMode = (meta?.mode as TravelMode) ?? currentMode
  const weights = useTripStore((s) => s.weights)

  return (
    <section className="flex h-44 shrink-0 flex-col border-t border-slate-200 bg-white">
      {/* 头部：统计 + 元信息 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-2">
        <h2 className="text-sm font-semibold text-slate-900">
          {isMultiDay ? day.title ?? `第${dayIndex + 1}天` : '路线时间轴'}
          <span className="ml-1.5 text-[11px] font-normal text-slate-400">
            {day.date} · {day.stops.length} 站
            {isMultiDay ? ` · 第 ${dayIndex + 1}/${plan.days.length} 天` : ''}
          </span>
        </h2>

        <span className="flex items-center gap-1 text-[11px] text-slate-500">
          步行 <b className="font-medium text-slate-800">{day.stats.totalWalkKm} km</b>
        </span>
        <span className="flex items-center gap-1 text-[11px] text-slate-500">
          交通 <b className="font-medium text-slate-800">{formatMinutes(day.stats.totalTransitMin)}</b>
        </span>
        <span className="flex items-center gap-1 text-[11px] text-slate-500">
          花费 <b className="font-medium text-slate-800">{formatMoney(day.stats.totalCost)}</b>
        </span>
        {day.returnTime && (
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            回酒店 <b className="font-medium text-slate-800">{day.returnTime}</b>
          </span>
        )}

        <span
          title={isAmap ? '距离与耗时来自高德 Web 服务实时接口' : '未配置高德 Web 服务 Key，按直线距离 × 绕行系数估算'}
          className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500"
        >
          {isAmap ? '高德实时' : '离线估算'}
        </span>
        {meta?.name && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
            {meta.name}
          </span>
        )}
        {meta?.splitMethod === 'kmeans+balance' && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
            地理聚类分天
          </span>
        )}
        {meta?.objectiveMinutes != null && (
          <span className="text-[10px] text-slate-400">
            目标值 {meta.objectiveMinutes} · 耗时 {meta.elapsedMs}ms
          </span>
        )}

        {stale && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
            参数已变更，请重新编译
          </span>
        )}
        {(day.overtimeMin ?? 0) > 0.5 && (
          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600">
            超出计划收工 {day.overtimeMin} 分钟
          </span>
        )}

        <button
          className="ml-auto text-[11px] text-slate-500 hover:text-slate-900 hover:underline"
          onClick={() => setShowDetail((v) => !v)}
        >
          {showDetail ? '收起说明' : '为什么这样排？'}
        </button>
      </div>

      {/* 主体：横向时间轴 */}
      <div className="tc-scroll min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-4 py-3">
        <div className="flex h-full items-stretch gap-2">
          {/* 起点 */}
          <div className="flex w-40 shrink-0 flex-col justify-center rounded-lg border border-slate-300 bg-slate-50 px-3 py-2">
            <div className="text-[10px] text-slate-400">出发</div>
            <div className="truncate text-sm font-semibold text-slate-900" title={hotel.name}>
              {hotel.name}
            </div>
            <div className="text-[10px] text-slate-400">固定起点</div>
          </div>

          {day.stops.map((stop, index) => {
            const leg = stop.transportFromPrev
            const style = modeStyle(leg?.mode ?? currentMode)
            // 「周一闭馆」提示：从 store 里的目的地取（后端模型没有星期维度，也不该有）
            const closedDays = destinations.find((item) => item.id === stop.id)?.closedWeekdays
            return (
              <div key={stop.id} className="flex shrink-0 items-stretch gap-2">
                {/* 交通段 */}
                <div className="flex w-24 flex-col items-center justify-center gap-0.5">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] leading-4 text-slate-500">
                    {style.label}
                  </span>
                  <div className="text-[10px] font-medium text-slate-700">
                    {leg ? `${Math.round(leg.durationMin)} 分` : '—'}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {leg ? `${leg.distanceKm} km` : ''}
                    {leg?.approx ? ' *' : ''}
                  </div>
                  {/* 直达 / 换乘几次 —— 点开看具体坐哪几趟车 */}
                  <TransitOptions options={leg?.transitOptions} />
                </div>

                {/* 站点卡片 */}
                <div className="relative flex w-48 shrink-0 flex-col justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
                  {/* 导航：交给高德 App。用 <a href> 而不是 window.open —— 移动端浏览器
                      会拦截脚本打开的窗口，而用户主动点的 <a> 能可靠唤起 App */}
                  <div className="absolute right-1.5 top-1.5 flex items-center gap-1.5">
                    <a
                      className="text-[10px] text-slate-300 hover:text-slate-700"
                      href={stopNavUrl(
                        stop,
                        previousPointFor(day, index, hotel),
                        activeMode,
                        weights,
                      )}
                      target="_blank"
                      rel="noreferrer"
                      title={`${navHint(activeMode, weights)}：从「${
                        index === 0 ? hotel.name : day.stops[index - 1].name
                      }」到「${stop.name}」`}
                    >
                      导航
                    </a>
                    <a
                      className="text-[10px] text-slate-300 hover:text-slate-700"
                      href={fromHereNavUrl(stop, activeMode, weights)}
                      target="_blank"
                      rel="noreferrer"
                      title={`${navHint(activeMode, weights)}：从我当前位置到「${stop.name}」（移动端自动取当前位置）`}
                    >
                      定位
                    </a>
                  </div>

                  <div className="flex items-center gap-1.5 pr-14">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-picked text-[10px] font-semibold text-white">
                      {orderMap.get(stop.id) ?? index + 1}
                    </span>
                    <span className="truncate text-sm font-medium text-slate-900" title={stop.name}>
                      {stop.name}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-600">
                    {stop.arriveTime} – {stop.leaveTime}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
                    <span>停留 {stop.stayMin} 分</span>
                    {isClosedToday(closedDays) ? (
                      <span className="rounded bg-red-50 px-1 font-medium text-red-600">今天闭馆</span>
                    ) : null}
                    {(stop.lunchMin ?? 0) > 0 && (
                      <span className="rounded bg-slate-100 px-1 text-slate-500">
                        含午餐 {stop.lunchMin} 分
                      </span>
                    )}
                    {leg && leg.cost > 0 && <span>· {formatMoney(leg.cost)}</span>}
                  </div>
                </div>
              </div>
            )
          })}

          {/* 返程 */}
          <div className="flex shrink-0 items-stretch gap-2">
            <div className="flex w-24 flex-col items-center justify-center gap-0.5">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] leading-4 text-slate-500">
                {returnMode.label}
              </span>
              <div className="text-[10px] font-medium text-slate-700">回酒店</div>
              {/* 显示回程的真实时长/里程，而不是折线的坐标点数 */}
              {day.returnLeg ? (
                <>
                  <div className="text-[10px] font-medium text-slate-700">
                    {Math.round(day.returnLeg.durationMin)} 分
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {day.returnLeg.distanceKm} km
                    {day.returnLeg.approx ? ' *' : ''}
                  </div>
                  <TransitOptions options={day.returnLeg.transitOptions} />
                </>
              ) : (
                <div className="text-[10px] text-slate-400">—</div>
              )}
            </div>
            <div className="flex w-40 shrink-0 flex-col justify-center rounded-lg border border-slate-300 bg-slate-50 px-3 py-2">
              <div className="text-[10px] text-slate-400">结束</div>
              <div className="truncate text-sm font-semibold text-slate-900">{hotel.name}</div>
              <div className="text-[10px] text-slate-400">预计 {day.returnTime ?? '—'} 到达</div>
            </div>
          </div>
        </div>
      </div>

      {/* 说明 / 警告 */}
      {showDetail && (
        <div className="max-h-24 shrink-0 overflow-y-auto border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11px] leading-5 text-slate-600 tc-scroll">
          <p>{plan.explanation}</p>
          {(meta?.warnings ?? []).map((warning) => (
            <p key={warning} className="text-amber-700">
              {warning}
            </p>
          ))}
          {(meta?.dropped ?? []).map((item) => (
            <p key={item.id} className="text-red-600">
              未排入「{item.name}」：{item.reason}
            </p>
          ))}
          {plan.solver?.legsApprox ? (
            <p className="text-slate-400">
              * 有 {plan.solver.legsApprox} 段折线为直线近似（离线估算模式或高德接口失败时的降级）
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}
