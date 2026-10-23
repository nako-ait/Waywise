import { useState } from 'react'
import { DEMO_ROUTES, type DemoRoute } from '@/data/demoRoutes'
import { SHANGHAI_POIS } from '@/data/shanghaiPois'
import { usePlanController } from '@/hooks/usePlanController'
import { fitToPoints } from '@/lib/mapInstance'
import { useTripStore, type NewDestinationInput } from '@/store/useTripStore'

/**
 * 主题演示线路（模块 5）。
 * 一键把「酒店 + 交通方式 + 天数 + 一组目的地」整体铺好，并可选立刻编译路书 ——
 * 答辩现场只要点一下就能进入有路线的状态，不用现场点地图选点。
 */
export default function DemoRoutesPanel() {
  const [autoPlan, setAutoPlan] = useState(true)
  const [loaded, setLoaded] = useState<string | null>(null)

  const setHotel = useTripStore((s) => s.setHotel)
  const setMode = useTripStore((s) => s.setMode)
  const setDays = useTripStore((s) => s.setDays)
  const clearDestinations = useTripStore((s) => s.clearDestinations)
  const addDestinations = useTripStore((s) => s.addDestinations)
  const { run, planning } = usePlanController()

  function load(route: DemoRoute) {
    // 换线路 = 换一套完整场景：酒店、方式、天数、目的地全部重置，避免上次的残留
    clearDestinations()
    setHotel({ ...route.hotel, name: route.hotel.name })
    setMode(route.mode)
    setDays(route.days)

    const inputs = route.poiNames
      .map((name) => SHANGHAI_POIS.find((poi) => poi.name === name))
      .filter((poi): poi is (typeof SHANGHAI_POIS)[number] => Boolean(poi))
      .map(
        (poi) =>
          ({
            name: poi.name,
            lng: poi.lng,
            lat: poi.lat,
            source: 'import',
            selected: true,
            stayMin: poi.stayMin,
            openTime: poi.openTime,
            closeTime: poi.closeTime,
            tags: poi.tags,
            address: poi.district,
          }) satisfies NewDestinationInput,
      )

    const { added, skipped } = addDestinations(inputs)
    setLoaded(`${route.icon} ${route.name}：${added} 个点已选中${skipped ? `（跳过 ${skipped} 个重复）` : ''}`)

    // 视野框住全部点
    window.setTimeout(() => {
      const state = useTripStore.getState()
      fitToPoints([state.hotel, ...state.destinations])
    }, 60)

    if (autoPlan) void run()
  }

  return (
    <section className="border-b border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">主题演示线路</h2>
        <label className="flex items-center gap-1 text-[11px] text-slate-500">
          <input
            type="checkbox"
            checked={autoPlan}
            onChange={(e) => setAutoPlan(e.target.checked)}
            className="h-3 w-3"
          />
          载入后自动编译
        </label>
      </div>

      <div className="space-y-1.5">
        {DEMO_ROUTES.map((route) => (
          <button
            key={route.id}
            disabled={planning}
            onClick={() => load(route)}
            className="flex w-full items-start gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-left transition-colors hover:border-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            <span className="text-base leading-5">{route.icon}</span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-slate-800">
                {route.name}
                <span className="ml-1 font-normal text-slate-400">
                  {route.days} 天 · {route.poiNames.length} 点
                </span>
              </span>
              <span className="block truncate text-[10px] text-slate-400">{route.desc}</span>
            </span>
          </button>
        ))}
      </div>

      {loaded && <p className="mt-1.5 text-[11px] text-emerald-600">{loaded}</p>}
      <p className="mt-1 text-[10px] leading-4 text-slate-400">
        演示起点用的是同名地标坐标，可在上方「出发酒店」搜索真实酒店替换
      </p>
    </section>
  )
}
