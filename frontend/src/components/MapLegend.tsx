import { useMemo } from 'react'
import { fitToPoints, panTo } from '@/lib/mapInstance'
import { bandColor } from '@/lib/routeStyle'
import { useTripStore } from '@/store/useTripStore'
import { useDayScope } from '@/lib/routeOrder'
import { dayEndPoint } from '@/lib/tripEndpoints'

/** 地图右下角图例 + 快捷视野操作 */
export default function MapLegend() {
  const hotel = useTripStore((s) => s.hotel)
  const endMode = useTripStore(s => s.endMode)
  const endPoint = useTripStore(s => s.endPoint)
  const destinations = useTripStore((s) => s.destinations)
  const isochrone = useTripStore((s) => s.isochrone)
  const isochroneVisible = useTripStore((s) => s.isochroneVisible)
  const showLabels = useTripStore((s) => s.showLabels)
  const setShowLabels = useTripStore((s) => s.setShowLabels)
  const { day } = useDayScope()
  const displayedEndMode = day ? day.endMode ?? 'return' : endMode
  const displayedEndPoint = day ? dayEndPoint(day, hotel) : endPoint

  const selectedCount = useMemo(() => destinations.filter((d) => d.selected).length, [destinations])

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-10 flex flex-col items-end gap-2">
      <div className="pointer-events-auto flex gap-0.5 rounded-lg border border-slate-200 bg-white/95 p-0.5 shadow-panel backdrop-blur">
        <button
          className="rounded px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
          onClick={() => panTo(hotel.lng, hotel.lat, 15)}
          title="定位到出发地点"
        >
          起点
        </button>
        <button
          className="rounded px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
          onClick={() => fitToPoints([hotel, ...destinations, ...(displayedEndMode === 'custom' && displayedEndPoint ? [displayedEndPoint] : [])])}
          title="把所有点框进视野"
        >
          全览
        </button>
        <button
          className={`rounded px-2 py-1 text-[11px] hover:bg-slate-100 ${
            showLabels ? 'text-slate-800' : 'text-slate-400'
          }`}
          onClick={() => setShowLabels(!showLabels)}
          title="显示 / 隐藏地图上的地名标签（点太多时可以关掉）"
        >
          名称{showLabels ? '' : '（关）'}
        </button>
      </div>

      <div className="pointer-events-auto rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-[11px] leading-5 text-slate-500 shadow-panel backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-[3px] bg-hotel" />
          {displayedEndMode === 'return' ? '起点 / 终点' : '出发地点'}
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-picked text-[8px] font-semibold leading-none text-white">
            1
          </span>
          已选 {selectedCount} 个（序号针）
        </div>
        {displayedEndMode === 'custom' && displayedEndPoint && <div className="flex max-w-[180px] items-center gap-2" title={displayedEndPoint.name}><span className="h-3 w-3 shrink-0 rounded-sm bg-teal-700" /><span className="truncate">终点：{displayedEndPoint.name}</span></div>}
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-candidate ring-2 ring-white" />
          候选点（点一下变针）
        </div>
        {isochroneVisible && isochrone?.bands?.length ? (
          <div className="mt-1 border-t border-slate-100 pt-1">
            {isochrone.bands.map((band) => (
              <div key={band.minutes} className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-[2px]"
                  style={{ backgroundColor: bandColor(band.minutes) }}
                />
                {band.minutes} 分钟可达 {band.poiCount} 个
              </div>
            ))}
          </div>
        ) : null}
        <div className="mt-1 border-t border-slate-100 pt-1 text-slate-400">
          点击地图空白处 = 添加候选点
        </div>
      </div>
    </div>
  )
}
