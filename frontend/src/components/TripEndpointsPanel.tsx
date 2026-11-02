import { useState } from 'react'
import HotelPanel from './HotelPanel'
import { useTripStore } from '@/store/useTripStore'
import type { TripEndMode } from '@/types'

export default function TripEndpointsPanel() {
  const hotel = useTripStore(s => s.hotel)
  const endMode = useTripStore(s => s.endMode)
  const endPoint = useTripStore(s => s.endPoint)
  const days = useTripStore(s => s.days)
  const setEndMode = useTripStore(s => s.setEndMode)
  const [editing, setEditing] = useState<'origin' | 'end' | null>(null)
  return <section className="shrink-0 border-b border-slate-200 bg-white">
    <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50" aria-expanded={editing === 'origin'} onClick={() => setEditing(value => value === 'origin' ? null : 'origin')}>
      <span className="h-2.5 w-2.5 rounded-[3px] bg-[#1d4ed8]" />
      <span className="text-[11.5px] font-medium text-slate-700">出发地点</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{hotel.name}</span>
      <span className="text-[10px] text-slate-400">{editing === 'origin' ? '收起' : '更换'}</span>
    </button>
    <div className="px-3 pb-2">
      <label className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
        {days > 1 ? '最后一天终点' : '行程终点'}
        <select aria-label="行程终点方式" className="max-w-[70%] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-800" value={endMode} onChange={event => {
          const value = event.target.value as TripEndMode
          setEndMode(value); setEditing(value === 'custom' ? 'end' : null)
        }}>
          <option value="return">返回起点</option>
          <option value="last_stop">最后一站结束</option>
          <option value="custom">到指定地点结束</option>
        </select>
      </label>
      {endMode === 'custom' && <button type="button" aria-expanded={editing === 'end'} onClick={() => setEditing(value => value === 'end' ? null : 'end')} className="mt-2 flex w-full items-center gap-2 rounded-lg border border-teal-200 bg-teal-50/50 px-2 py-2 text-left text-[11px] text-teal-800">
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-teal-700" />
        <span className="min-w-0 flex-1 truncate">{endPoint?.name || '请选择终点（必填）'}</span><span>{editing === 'end' ? '收起' : '更换'}</span>
      </button>}
      {endMode === 'custom' && !endPoint && <p role="alert" className="mt-1 text-[10px] text-amber-700">请选择终点后再规划，终段交通会计入耗时与费用。</p>}
      {days > 1 && <p className="mt-1 text-[10px] leading-4 text-slate-400">前几天从起点出发并返回，最后一天按此设置结束。</p>}
    </div>
    {editing && <div className="tc-scroll max-h-[40dvh] overflow-y-auto border-t border-slate-100"><HotelPanel key={editing} target={editing} onPicked={() => setEditing(null)} /></div>}
  </section>
}
