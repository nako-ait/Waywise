import { useState } from 'react'
import { fetchIsochrone } from '@/api/client'
import { bandColor } from '@/lib/routeStyle'
import { useTripStore } from '@/store/useTripStore'

const PRESET_MINUTES = [15, 30, 45, 60]

/**
 * 酒店交通便利度面板（模块 3）。
 *
 * 不只是画个圈：后端会用一次高德距离矩阵批量请求算出「酒店 → 每个热门 POI」的真实耗时，
 * 于是这里能给出「15 分钟内可直达 3 个热门 POI」这种可比较的结论 —— 换酒店时一眼看出差别。
 */
export default function IsochronePanel() {
  const hotel = useTripStore((s) => s.hotel)
  const minutes = useTripStore((s) => s.isochroneMinutes)
  const visible = useTripStore((s) => s.isochroneVisible)
  const data = useTripStore((s) => s.isochrone)
  const loading = useTripStore((s) => s.isochroneLoading)
  const setIsochrone = useTripStore((s) => s.setIsochrone)
  const setVisible = useTripStore((s) => s.setIsochroneVisible)
  const setLoading = useTripStore((s) => s.setIsochroneLoading)
  const toggleMinute = useTripStore((s) => s.toggleIsochroneMinute)

  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 用 getState 读最新值，避免闭包里拿到旧的天数/方式 */
  async function load(force = false) {
    if (data && !force) return
    const state = useTripStore.getState()
    setLoading(true)
    setError(null)
    try {
      const result = await fetchIsochrone(state.hotel, state.isochroneMinutes, state.mode)
      setIsochrone(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '等时圈计算失败')
    } finally {
      setLoading(false)
    }
  }

  function handleToggle() {
    const next = !visible
    setVisible(next)
    if (next) void load()
  }

  return (
    <section className="border-b border-slate-200">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50"
        onClick={() => setOpen((v) => !v)}
      >
        <h2 className="text-sm font-semibold text-slate-800">
          酒店便利度
          <span className="ml-1.5 text-[11px] font-normal text-slate-400">等时圈</span>
        </h2>
        <span className="text-[11px] text-slate-400">{open ? '收起' : '展开'}</span>
      </button>

      {open && (
        <div className="space-y-2 px-3 pb-3">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={visible}
                onChange={handleToggle}
                className="h-3.5 w-3.5"
              />
              在地图上显示等时圈
            </label>
            <button
              className="rounded px-1.5 py-0.5 text-[11px] text-blue-600 hover:bg-blue-50 disabled:opacity-50"
              onClick={() => void load(true)}
              disabled={loading}
            >
              {loading ? '计算中…' : '重新计算'}
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PRESET_MINUTES.map((minute) => {
              const active = minutes.includes(minute)
              return (
                <button
                  key={minute}
                  onClick={() => {
                    toggleMinute(minute)
                    setVisible(true)
                    // toggleMinute 会清空旧数据，这里强制重算
                    window.setTimeout(() => void load(true), 0)
                  }}
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    active
                      ? 'border-transparent text-white'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                  style={active ? { backgroundColor: bandColor(minute) } : undefined}
                >
                  {minute} 分钟
                </button>
              )
            })}
          </div>

          <p className="text-[11px] text-slate-400">
            以「{hotel.name}」为中心，按当前交通方式计算可达范围
          </p>

          {error && <p className="text-[11px] text-red-600">{error}</p>}

          {data && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    data.dataSource === 'amap'
                      ? 'bg-slate-100 text-slate-600'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {data.dataSource === 'amap' ? '高德真实耗时' : '离线估算'}
                </span>
                <span className="text-[10px] text-slate-400">
                  {data.modeLabel} · 共 {data.poiTotal} 个热门 POI
                </span>
              </div>
              {data.bands.map((band) => (
                <div key={band.minutes} className="rounded border border-slate-100 bg-slate-50 p-1.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: bandColor(band.minutes) }}
                    />
                    <span className="text-[11px] font-medium text-slate-700">
                      {band.minutes} 分钟内可达 {band.poiCount} 个
                    </span>
                    {band.source !== 'amap-isochrone' && (
                      <span className="text-[10px] text-slate-400">· 等速圆</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] leading-4 text-slate-500">
                    {band.pois
                      .slice(0, 5)
                      .map((poi) => `${poi.name}(${Math.round(poi.minutes)}分)`)
                      .join('、')}
                    {band.pois.length > 5 ? ' …' : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
