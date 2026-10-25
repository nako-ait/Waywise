import { useMemo, useState } from 'react'
import { SHANGHAI_POIS } from '@/data/shanghaiPois'
import { useTripStore } from '@/store/useTripStore'
import Modal from './Modal'

interface Props {
  open: boolean
  onClose: () => void
  onAdded?: () => void
}

/** 在时间轴上补一个地点：本地 276 条预置 POI 里搜，选中即加入并重算 */
export default function AddStopDialog({ open, onClose, onAdded }: Props) {
  const [keyword, setKeyword] = useState('')
  const addDestinations = useTripStore((s) => s.addDestinations)
  const showToast = useTripStore((s) => s.showToast)

  const results = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const used = new Set(useTripStore.getState().destinations.map((d) => d.name))
    const pool = SHANGHAI_POIS.filter((poi) => !used.has(poi.name))
    if (!kw) return pool.slice(0, 8)
    return pool
      .filter(
        (poi) =>
          poi.name.toLowerCase().includes(kw) ||
          poi.tags?.some((tag) => tag.toLowerCase().includes(kw)) ||
          poi.district?.includes(keyword.trim()),
      )
      .slice(0, 10)
  }, [keyword, open])

  function add(name: string) {
    const poi = SHANGHAI_POIS.find((item) => item.name === name)
    if (!poi) return
    const { added } = addDestinations([
      {
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
      },
    ])
    if (added) {
      showToast('success', `已加入「${poi.name}」`)
      setKeyword('')
      onClose()
      onAdded?.()
    } else {
      showToast('error', '这个地点已经在列表里了')
    }
  }

  return (
    <Modal open={open} title="添加地点" desc="从本地 276 个上海 POI 里选一个（离线可用）。" onClose={onClose}>
      <input
        autoFocus
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder="搜地名 / 类型，如 外滩、咖啡、公园"
        className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs outline-none focus:border-slate-800"
      />
      <div className="tc-scroll mt-2 max-h-64 space-y-1 overflow-y-auto">
        {results.length === 0 && (
          <p className="py-6 text-center text-[11px] text-slate-400">没搜到，换个词试试</p>
        )}
        {results.map((poi) => (
          <button
            key={poi.name}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5 text-left hover:border-slate-300 hover:bg-slate-50"
            onClick={() => add(poi.name)}
          >
            <span className="min-w-0">
              <span className="block truncate text-[12px] text-slate-800">{poi.name}</span>
              <span className="block truncate text-[10px] text-slate-400">
                {poi.district ?? ''} · {poi.tags?.slice(0, 2).join(' / ')}
              </span>
            </span>
            <span className="shrink-0 text-[10px] text-slate-400">停留 {poi.stayMin} 分</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
