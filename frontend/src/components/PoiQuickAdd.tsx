import { useEffect, useRef, useState } from 'react'
import { SHANGHAI_POIS } from '@/data/shanghaiPois'
import { formatClosedWeekdays, isClosedToday } from '@/lib/amapParse'
import {
  originLabel,
  resolveSuggestion,
  searchPlaces,
  type PlaceSuggestion,
} from '@/lib/amapSearch'
import { panTo } from '@/lib/mapInstance'
import { poiIcon } from '@/lib/poiIcon'
import { useTripStore, type NewDestinationInput } from '@/store/useTripStore'

/**
 * 目的地搜索：**高德在线搜索**（AutoComplete 联想 + PlaceSearch 详情），
 * 在线不可用时自动回退到本地 37 个预置 POI。
 *
 * 交互要点：
 *  · 输入防抖 300ms；用序号丢弃过期响应，避免"打字快时结果乱跳"
 *  · 键盘可用：↑↓ 选择、Enter 添加、Esc 关闭（演示时不用鼠标）
 *  · 在线候选点选时会再拉一次详情，拿到**营业时间**——它会直接进求解器的时间窗约束
 *  · 加完自动清空输入框，方便连着加好几个
 */
export default function PoiQuickAdd() {
  const addDestinations = useTripStore((s) => s.addDestinations)

  const [keyword, setKeyword] = useState('')
  const [items, setItems] = useState<PlaceSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [degraded, setDegraded] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [tip, setTip] = useState<{ text: string; ok: boolean } | null>(null)

  const seqRef = useRef(0)
  const boxRef = useRef<HTMLDivElement | null>(null)

  /* 输入 → 防抖 → 在线搜索（失败自动降级本地） */
  useEffect(() => {
    const kw = keyword.trim()
    if (!kw) {
      setItems([])
      setOpen(false)
      setNotice(null)
      setDegraded(false)
      setLoading(false)
      return
    }
    setLoading(true)
    const seq = ++seqRef.current
    const timer = window.setTimeout(() => {
      void searchPlaces(kw).then((outcome) => {
        if (seq !== seqRef.current) return // 过期响应直接丢弃
        setItems(outcome.items)
        setDegraded(outcome.degraded)
        setNotice(outcome.notice ?? null)
        setActiveIndex(outcome.items.length ? 0 : -1)
        setOpen(true)
        setLoading(false)
      })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [keyword])

  /* 点击外部收起下拉 */
  useEffect(() => {
    function onDocMouseDown(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  async function addSuggestion(suggestion: PlaceSuggestion) {
    setPendingKey(suggestion.key)
    try {
      // 在线候选：先补详情（坐标 / 地址 / 营业时间）
      const place = await resolveSuggestion(suggestion)
      if (place.lng == null || place.lat == null) {
        setTip({ text: `没能取到「${place.name}」的坐标，换一条结果试试`, ok: false })
        return
      }

      const { added, skipped } = addDestinations([
        {
          name: place.name,
          lng: place.lng,
          lat: place.lat,
          source: 'search',
          selected: true,
          stayMin: place.stayMin,
          openTime: place.openTime,
          closeTime: place.closeTime,
          tags: place.tags,
          address: [place.district, place.address].filter(Boolean).join(' ') || undefined,
          amapId: place.amapId,
          hoursRaw: place.hoursRaw,
          closedWeekdays: place.closedWeekdays,
        } satisfies NewDestinationInput,
      ])

      const hours = place.openTime ? `（营业 ${place.openTime}–${place.closeTime}）` : ''
      const closedHint = isClosedToday(place.closedWeekdays)
        ? `⚠ 今天闭馆（${formatClosedWeekdays(place.closedWeekdays)}）`
        : ''
      setTip(
        added
          ? {
              text: `✅ 已添加「${place.name}」${hours}${closedHint}，并已选中（见下方目的地列表）`,
              ok: !closedHint,
            }
          : { text: `「${place.name}」已经在列表里了（${skipped} 个重复未重复添加）`, ok: false },
      )
      panTo(place.lng, place.lat, 15)
      // 清空输入，方便连着加下一个
      setKeyword('')
      setOpen(false)
    } finally {
      setPendingKey(null)
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!items.length) {
      if (event.key === 'Escape') setOpen(false)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((index) => (index + 1) % items.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index - 1 + items.length) % items.length)
    } else if (event.key === 'Enter') {
      const target = items[activeIndex]
      if (target) {
        event.preventDefault()
        void addSuggestion(target)
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  const onlineCount = items.filter((item) => item.origin === 'amap').length
  const localCount = items.length - onlineCount

  return (
    <section className="border-b border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">搜索添加目的地</h2>
        <span className="text-[11px] text-slate-400">
          {loading ? '搜索中…' : degraded ? '本地预置库' : '高德在线'}
          <span className="ml-1 text-slate-300">|</span>
          <span className="ml-1">本地兜底 {SHANGHAI_POIS.length} 个</span>
        </span>
      </div>

      <div ref={boxRef} className="relative">
        <div className="flex items-center gap-1.5">
          <input
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none placeholder:text-slate-400 focus:border-blue-500"
            placeholder="搜索任意地点：外滩 / 武康路 / 某某咖啡…"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onFocus={() => items.length && setOpen(true)}
            onKeyDown={onKeyDown}
            autoComplete="off"
          />
          {keyword && (
            <button
              className="shrink-0 rounded px-1.5 py-1 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              onClick={() => setKeyword('')}
              title="清空"
            >
              ✕
            </button>
          )}
        </div>

        {/* 候选下拉 */}
        {open && (items.length > 0 || loading) && (
          <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-panel tc-scroll">
            {items.map((item, index) => (
              <li key={item.key}>
                <button
                  className={`flex w-full items-start gap-2 border-b border-slate-100 px-2.5 py-2 text-left last:border-b-0 ${
                    index === activeIndex ? 'bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => void addSuggestion(item)}
                  disabled={pendingKey !== null}
                >
                  <span className="mt-0.5 shrink-0 text-[13px]">{poiIcon(item.tags)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <span className="truncate text-sm text-slate-800">{item.name}</span>
                      <span
                        className={`shrink-0 rounded px-1 text-[9px] ${
                          item.origin === 'amap'
                            ? 'bg-blue-50 text-blue-600'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {originLabel(item.origin)}
                      </span>
                      {item.rating && (
                        <span className="shrink-0 text-[9px] text-amber-600">★{item.rating}</span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-slate-400">
                      {[item.district, item.address].filter(Boolean).join(' · ')}
                      {item.tags.length ? ` · ${item.tags.slice(0, 2).join('/')}` : ''}
                      {item.openTime ? ` · ${item.openTime}-${item.closeTime}` : ''}
                    </span>
                    {/* 「周一闭馆」这类星期信息只在界面提示，不进求解器 */}
                    {item.closedWeekdays?.length ? (
                      <span className="mt-0.5 flex items-center gap-1">
                        <span
                          className={`rounded px-1 text-[9px] ${
                            isClosedToday(item.closedWeekdays)
                              ? 'bg-red-50 text-red-600'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                          title={item.hoursRaw}
                        >
                          {isClosedToday(item.closedWeekdays) ? '今天闭馆' : '部分日期闭馆'}
                        </span>
                        <span className="truncate text-[9px] text-slate-400">
                          {formatClosedWeekdays(item.closedWeekdays)}闭馆
                        </span>
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 shrink-0 text-[10px] text-blue-600">
                    {pendingKey === item.key ? '添加中…' : '添加 ⏎'}
                  </span>
                </button>
              </li>
            ))}
            {loading && (
              <li className="px-2.5 py-2 text-[11px] text-slate-400">正在搜索高德…</li>
            )}
          </ul>
        )}
      </div>

      {/* 状态行：在线 / 降级 / 计数 */}
      {notice && (
        <p
          className={`mt-1.5 rounded px-2 py-1 text-[11px] leading-4 ${
            degraded ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-500'
          }`}
        >
          {degraded ? '⚠ ' : ''}
          {notice}
        </p>
      )}
      {!notice && open && items.length > 0 && (
        <p className="mt-1.5 text-[11px] text-slate-400">
          在线 {onlineCount} 条{localCount ? ` · 本地预置 ${localCount} 条` : ''} · ↑↓ 选择，Enter 添加
        </p>
      )}

      {tip && (
        <p
          className={`mt-1.5 rounded px-2 py-1 text-[11px] leading-4 ${
            tip.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}
        >
          {tip.text}
        </p>
      )}
    </section>
  )
}
