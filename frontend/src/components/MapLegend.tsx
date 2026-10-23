import { useMemo } from 'react'
import { fitToPoints, panTo } from '@/lib/mapInstance'
import { bandColor } from '@/lib/routeStyle'
import { useTripStore } from '@/store/useTripStore'

/** 地图右下角图例 + 快捷视野操作 */
export default function MapLegend() {
  const hotel = useTripStore((s) => s.hotel)
  const destinations = useTripStore((s) => s.destinations)
  const isochrone = useTripStore((s) => s.isochrone)
  const isochroneVisible = useTripStore((s) => s.isochroneVisible)
  const showLabels = useTripStore((s) => s.showLabels)
  const setShowLabels = useTripStore((s) => s.setShowLabels)

  const selectedCount = useMemo(() => destinations.filter((d) => d.selected).length, [destinations])

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-10 flex flex-col items-end gap-2">
      <div className="pointer-events-auto flex gap-1.5 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-panel backdrop-blur">
        <button
          className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
          onClick={() => panTo(hotel.lng, hotel.lat, 15)}
          title="定位到酒店"
        >
          🏨 酒店
        </button>
        <button
          className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
          onClick={() => fitToPoints([hotel, ...destinations])}
          title="把所有点框进视野"
        >
          🔍 全览
        </button>
        <button
          className={`rounded px-2 py-1 text-xs hover:bg-slate-100 ${
            showLabels ? 'text-slate-800' : 'text-slate-400'
          }`}
          onClick={() => setShowLabels(!showLabels)}
          title="显示 / 隐藏地图上的地名标签（点太多时可以关掉）"
        >
          🏷 名称{showLabels ? '' : '（关）'}
        </button>
      </div>

      <div className="pointer-events-auto rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-[11px] leading-5 text-slate-600 shadow-panel backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-[4px] bg-hotel text-[8px] leading-none">
            🏨
          </span>
          酒店（起点 / 终点）
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-picked text-[8px] font-bold leading-none text-white">
            1
          </span>
          已选 {selectedCount} 个（橙色水滴针）
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-white bg-candidate text-[8px] leading-none">
            📍
          </span>
          候选点（灰色，点一下变针）
        </div>
        {isochroneVisible && isochrone?.bands?.length ? (
          <div className="mt-1 border-t border-slate-100 pt-1">
            {isochrone.bands.map((band) => (
              <div key={band.minutes} className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: `${bandColor(band.minutes)}80` }}
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
