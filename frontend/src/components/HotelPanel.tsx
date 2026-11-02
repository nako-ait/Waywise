import { useEffect, useRef, useState } from 'react'
import { ApiError, searchOnlinePois } from '@/api/client'
import { loadAMap, searchPoi } from '@/lib/amap'
import { getAMap, getMap, panTo } from '@/lib/mapInstance'
import { useTripStore } from '@/store/useTripStore'
import { getCity } from '@/data/cities'
import type { PoiPreset } from '@/types'

/**
 * 酒店面板
 * - 酒店 = 固定起点，蓝色标记，UI 上不提供「删除/取消」入口
 * - 按当前城市搜索；服务器 Web 服务优先，SDK 备用
 */
export default function HotelPanel({ target = 'origin', onPicked }: { target?: 'origin' | 'end'; onPicked?: () => void }) {
  const cityId = useTripStore((s) => s.cityId)
  const city = getCity(cityId)
  const origin = useTripStore((s) => s.hotel)
  const endPoint = useTripStore((s) => s.endPoint)
  const originConfirmed = useTripStore((s) => s.hotelConfirmed)
  const setOrigin = useTripStore((s) => s.setHotel)
  const setEndPoint = useTripStore((s) => s.setEndPoint)
  const hotel = target === 'end' ? endPoint : origin
  const hotelConfirmed = target === 'end' ? Boolean(endPoint) : originConfirmed
  const setHotel = target === 'end' ? setEndPoint : setOrigin
  const label = target === 'end' ? '终点' : '出发地点'

  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<PoiPreset[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const searchId = useRef(0)
  const quickKeywords = target === 'end'
    ? city.id === 'shanghai' ? ['上海虹桥站', '上海站', '虹桥机场'] : [`${city.name}站`, `${city.name}机场`, city.pois[0]?.name].filter((name): name is string => Boolean(name))
    : city.id === 'shanghai'
    ? ['和平饭店', '上海外滩', '静安寺 酒店', '陆家嘴 酒店']
    : [...new Set([city.hotel.name.replace(/ · .*$/, ''), city.pois[0]?.name, `${city.name} 酒店`].filter((name): name is string => Boolean(name)))]

  useEffect(() => {
    searchId.current += 1
    setKeyword(''); setResults([]); setMessage(null); setLoading(false)
    return () => { searchId.current += 1 }
  }, [cityId, target])

  async function handleSearch(kw = keyword) {
    const q = kw.trim()
    if (!q) return
    const requestId = ++searchId.current
    setLoading(true)
    setResults([])
    setMessage(null)
    try {
      let list: PoiPreset[]
      let notice: string | null = null
      try {
        list = await searchOnlinePois(q, city.name, 8)
      } catch (serverError) {
        const reason = serverError instanceof ApiError ? serverError.detail || serverError.message : '服务器搜索暂不可用'
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          const AMap = getAMap() || await Promise.race([
            loadAMap(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('地图搜索未就绪')), 8000) }),
          ])
          list = await searchPoi(AMap, q, city.name, 8)
          notice = list.length ? '当前使用地图端搜索结果' : `地图端未返回结果；${reason}`
        } catch (sdkError) {
          const sdkReason = sdkError instanceof Error && sdkError.message !== 'MISSING_AMAP_KEY' ? sdkError.message : '地图搜索未就绪'
          throw new Error(`${reason}；${sdkReason}`)
        } finally { clearTimeout(timer) }
      }
      if (requestId !== searchId.current) return
      setResults(list)
      setMessage(notice || (!list.length ? `在${city.name}没有搜到「${q}」，可尝试完整名称或附近地标` : null))
    } catch (err) {
      if (requestId === searchId.current) setMessage(err instanceof Error ? err.message : '搜索暂不可用，请重试')
    } finally {
      if (requestId === searchId.current) setLoading(false)
    }
  }

  function pick(poi: PoiPreset) {
    searchId.current += 1
    setLoading(false)
    setHotel({ name: poi.name, lng: poi.lng, lat: poi.lat, address: poi.address || poi.district })
    setResults([])
    setKeyword('')
    setMessage(null)
    panTo(poi.lng, poi.lat, 15)
    onPicked?.()
  }

  /** 以当前地图中心作为酒店（现场演示很好用） */
  function useMapCenter() {
    const map = getMap()
    if (!map) {
      setMessage('地图还没加载好')
      return
    }
    const c = map.getCenter()
    searchId.current += 1
    setLoading(false); setResults([])
    setHotel({
      name: `地图中心选定的${target === 'end' ? '终点' : '起点'}`,
      lng: c.getLng(),
      lat: c.getLat(),
      address: '',
    })
    setMessage(`已把地图中心设为${target === 'end' ? '终点' : '起点'}`)
    onPicked?.()
  }

  return (
    <section className="border-b border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-hotel" />
          {label}
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-500">
            {target === 'end' ? '最后一天到达' : '固定起点'}
          </span>
        </h2>
        {!hotelConfirmed && target === 'origin' && (
          <span className="text-[11px] text-slate-400">当前为默认值，建议搜索确认</span>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="truncate text-sm font-medium text-slate-800">{hotel?.name || '尚未设置终点，请搜索后选择'}</div>
        <div className="mt-0.5 text-[11px] text-slate-500">
          {hotel ? `${hotel.address || '—'} · ${hotel.lng.toFixed(5)}, ${hotel.lat.toFixed(5)}` : '也可以拖动地图，再点“取中心”'}
        </div>
      </div>

      <div className="mt-2 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none placeholder:text-slate-400 focus:border-blue-500"
          aria-label={`搜索${city.name}的${label}`}
          placeholder={`搜索${city.name}的酒店或地名`}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSearch()
          }}
        />
        <button
          className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          onClick={() => void handleSearch()}
          disabled={loading}
        >
          {loading ? '搜索中…' : '搜索'}
        </button>
        <button
          className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          onClick={useMapCenter}
          title={`把当前地图中心设为${label}`}
        >
          取中心
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {quickKeywords.map((k) => (
          <button
            key={k}
            className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 hover:border-slate-400 hover:text-slate-700"
            onClick={() => {
              setKeyword(k)
              void handleSearch(k)
            }}
          >
            {k}
          </button>
        ))}
      </div>

      {message && <p role="status" className="mt-2 text-[11px] text-slate-500">{message}</p>}

      {results.length > 0 && (
        <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-200 tc-scroll">
          {results.map((p, i) => (
            <li key={`${p.name}-${i}`}>
              <button
                className="w-full border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50"
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
