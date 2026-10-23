import { useState } from 'react'
import { loadAMap, searchPoi } from '@/lib/amap'
import { getAMap, getMap, panTo } from '@/lib/mapInstance'
import { useTripStore } from '@/store/useTripStore'
import type { PoiPreset } from '@/types'

/** 常见起点快捷词，演示时一键搜出候选酒店 */
const QUICK_KEYWORDS = ['和平饭店', '上海外滩', '静安寺 酒店', '陆家嘴 酒店']

/**
 * 酒店面板
 * - 酒店 = 固定起点，蓝色标记，UI 上不提供「删除/取消」入口
 * - 通过高德 PlaceSearch（城市限定上海）搜索替换
 */
export default function HotelPanel() {
  const hotel = useTripStore((s) => s.hotel)
  const hotelConfirmed = useTripStore((s) => s.hotelConfirmed)
  const setHotel = useTripStore((s) => s.setHotel)

  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<PoiPreset[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleSearch(kw = keyword) {
    const q = kw.trim()
    if (!q) return
    setLoading(true)
    setMessage(null)
    try {
      const AMap = getAMap() || (await loadAMap())
      const list = await searchPoi(AMap, q, '上海', 8)
      setResults(list)
      if (!list.length) setMessage('没有搜到结果，换个关键词试试（如「外滩」「静安寺」）')
    } catch (err) {
      setMessage(
        err instanceof Error && err.message === 'MISSING_AMAP_KEY'
          ? '未配置高德 Key，无法搜索'
          : '搜索失败，请检查网络或高德配额',
      )
    } finally {
      setLoading(false)
    }
  }

  function pick(poi: PoiPreset) {
    setHotel({ name: poi.name, lng: poi.lng, lat: poi.lat, address: poi.district })
    setResults([])
    setKeyword('')
    setMessage(null)
    panTo(poi.lng, poi.lat, 15)
  }

  /** 以当前地图中心作为酒店（现场演示很好用） */
  function useMapCenter() {
    const map = getMap()
    if (!map) {
      setMessage('地图还没加载好')
      return
    }
    const c = map.getCenter()
    setHotel({
      name: '地图中心选定的酒店',
      lng: c.getLng(),
      lat: c.getLat(),
      address: '',
    })
    setMessage('已把地图中心设为起点')
  }

  return (
    <section className="border-b border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-hotel" />
          出发酒店
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-normal text-emerald-700">
            固定起点
          </span>
        </h2>
        {!hotelConfirmed && (
          <span className="text-[11px] text-amber-600">当前为默认值，建议搜索确认</span>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="truncate text-sm font-medium text-slate-800">{hotel.name}</div>
        <div className="mt-0.5 text-[11px] text-slate-500">
          {hotel.address || '—'} · {hotel.lng.toFixed(5)}, {hotel.lat.toFixed(5)}
        </div>
      </div>

      <div className="mt-2 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none placeholder:text-slate-400 focus:border-blue-500"
          placeholder="搜索酒店 / 地名，如：和平饭店"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSearch()
          }}
        />
        <button
          className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          onClick={() => void handleSearch()}
          disabled={loading}
        >
          {loading ? '搜索中…' : '搜索'}
        </button>
        <button
          className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          onClick={useMapCenter}
          title="把当前地图中心设为酒店"
        >
          取中心
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {QUICK_KEYWORDS.map((k) => (
          <button
            key={k}
            className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 hover:border-blue-300 hover:text-blue-600"
            onClick={() => {
              setKeyword(k)
              void handleSearch(k)
            }}
          >
            {k}
          </button>
        ))}
      </div>

      {message && <p className="mt-2 text-[11px] text-amber-600">{message}</p>}

      {results.length > 0 && (
        <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-200 tc-scroll">
          {results.map((p, i) => (
            <li key={`${p.name}-${i}`}>
              <button
                className="w-full border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-blue-50"
                onClick={() => pick(p)}
              >
                <div className="text-sm text-slate-800">{p.name}</div>
                <div className="text-[11px] text-slate-400">
                  {p.district || ''} {p.tags?.slice(0, 2).join(' / ')}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
