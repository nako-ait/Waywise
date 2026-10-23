import { useMemo } from 'react'
import { fitToPoints, panTo } from '@/lib/mapInstance'
import { useOrderMap } from '@/lib/routeOrder'
import { useTripStore } from '@/store/useTripStore'
import DestinationRow from './DestinationRow'

/**
 * 目的地列表（侧边栏 ↔ 地图双向联动的「侧边栏」一侧）
 * - 行点击：切换选中 + 地图定位
 * - 工具栏：全选 / 取消全选 / 删除选中 / 清空
 */
export default function DestinationList() {
  const destinations = useTripStore((s) => s.destinations)
  const hotel = useTripStore((s) => s.hotel)
  const toggleSelect = useTripStore((s) => s.toggleSelect)
  const selectAll = useTripStore((s) => s.selectAll)
  const deselectAll = useTripStore((s) => s.deselectAll)
  const removeSelected = useTripStore((s) => s.removeSelected)
  const clearDestinations = useTripStore((s) => s.clearDestinations)
  const removeDestination = useTripStore((s) => s.removeDestination)
  const updateDestination = useTripStore((s) => s.updateDestination)

  /** id -> 序号：有路书按「当前这天」的路线顺序，没有则按选中顺序 */
  const orderMap = useOrderMap()
  const plan = useTripStore((s) => s.plan)
  const activeDay = useTripStore((s) => s.activeDay)

  /** id -> 第几天（1-based）：多日模式下给「不在当前这天」的点显示天数标签 */
  const dayLabelMap = useMemo(() => {
    const map = new Map<string, string>()
    const days = plan?.days ?? []
    if (days.length <= 1) return map
    days.forEach((day, index) => {
      if (index === activeDay) return
      for (const stop of day.stops) map.set(stop.id, `D${index + 1}`)
    })
    return map
  }, [plan, activeDay])

  const selectedCount = useMemo(
    () => destinations.filter((d) => d.selected).length,
    [destinations],
  )
  const total = destinations.length

  return (
    // ⚠️ 这里不能用 flex-1：侧边栏现在是整体可滚动的容器，
    //    在可滚动容器里 flex-1 会被压成 0 高度，表现为「加了点却看不到列表」。
    <section className="flex max-h-[45vh] min-h-[170px] shrink-0 flex-col border-b border-slate-200">
      {/* 工具栏 */}
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-800">
          目的地
          <span className="ml-1.5 text-[11px] font-normal text-slate-400">
            已选 {selectedCount} / 共 {total}
          </span>
        </h2>
        <div className="flex items-center gap-1">
          <button
            className="rounded px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            onClick={selectAll}
            disabled={!total || selectedCount === total}
          >
            全选
          </button>
          <button
            className="rounded px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            onClick={deselectAll}
            disabled={!selectedCount}
          >
            取消全选
          </button>
          <button
            className="rounded px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            onClick={() => fitToPoints([hotel, ...destinations])}
            disabled={!total}
            title="把所有点框进地图视野"
          >
            全览
          </button>
          <button
            className="rounded px-1.5 py-0.5 text-[11px] text-red-500 hover:bg-red-50 disabled:opacity-40"
            onClick={removeSelected}
            disabled={!selectedCount}
          >
            删除选中
          </button>
          <button
            className="rounded px-1.5 py-0.5 text-[11px] text-red-500 hover:bg-red-50 disabled:opacity-40"
            onClick={() => {
              if (window.confirm(`确认清空全部 ${total} 个候选点？（酒店不会受影响）`)) {
                clearDestinations()
              }
            }}
            disabled={!total}
          >
            清空
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto tc-scroll">
        {total === 0 ? (
          <div className="px-4 py-8 text-center text-xs leading-6 text-slate-400">
            还没有候选点。
            <br />
            点击地图空白处添加，或用上方「快速添加」。
          </div>
        ) : (
          <ul>
            {destinations.map((d) => (
              <DestinationRow
                key={d.id}
                dest={d}
                order={orderMap.get(d.id) ?? null}
                dayLabel={dayLabelMap.get(d.id) ?? null}
                onToggle={() => {
                  toggleSelect(d.id)
                  panTo(d.lng, d.lat)
                }}
                onLocate={() => panTo(d.lng, d.lat, 16)}
                onRemove={() => removeDestination(d.id)}
                onRename={(name) => updateDestination(d.id, { name })}
                onStayChange={(stayMin) => updateDestination(d.id, { stayMin })}
              />
            ))}
          </ul>
        )}
      </div>

      <p className="border-t border-slate-100 px-3 py-1.5 text-[11px] leading-4 text-slate-400">
        点行 = 选中并定位 · 双击名称改名 · 点地图上的灰点也可切换选中
        {selectedCount > 0 && (
          <span className="ml-1 text-slate-500">（{selectedCount} 个点等待编译路书）</span>
        )}
      </p>
    </section>
  )
}
