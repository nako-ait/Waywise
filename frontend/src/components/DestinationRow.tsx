import { useState } from 'react'
import { formatClosedWeekdays, isClosedToday } from '@/lib/amapParse'
import { poiIcon } from '@/lib/poiIcon'
import type { Destination } from '@/types'

const SOURCE_LABEL: Record<Destination['source'], string> = {
  'map-click': '地图点选',
  search: '搜索',
  ai: 'AI 解析',
  import: '导入',
}

interface Props {
  dest: Destination
  /** 选中时的序号（从 1 开始）；未选中为 null */
  order: number | null
  /** 多日模式下「该点属于第几天」的标签（不在当前查看的那天时显示） */
  dayLabel?: string | null
  onToggle: () => void
  onLocate: () => void
  onRemove: () => void
  onRename: (name: string) => void
  onStayChange: (stayMin: number) => void
}

/**
 * 目的地行
 * - 点击整行 = 选中/取消 + 地图定位（双向联动）
 * - 名称支持双击改名（AI 解析出的名字经常需要微调）
 */
export default function DestinationRow({
  dest,
  order,
  dayLabel,
  onToggle,
  onLocate,
  onRemove,
  onRename,
  onStayChange,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(dest.name)

  const selected = dest.selected

  function commitName() {
    const next = draft.trim()
    if (next && next !== dest.name) onRename(next)
    else setDraft(dest.name)
    setEditing(false)
  }

  return (
    <li
      className={`group flex items-start gap-2 border-b border-slate-100 px-3 py-2 transition-colors ${
        selected ? 'bg-orange-50/60' : 'hover:bg-slate-50'
      }`}
    >
      {/* 序号 / 灰点：点击切换选中 */}
      <button
        className="mt-0.5 shrink-0"
        onClick={onToggle}
        title={selected ? '取消选中' : '选中参与规划'}
        aria-label={selected ? '取消选中' : '选中'}
      >
        {selected ? (
          order ? (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-picked text-[11px] font-bold text-white">
              {order}
            </span>
          ) : (
            // 多日模式：属于别的天，用灰色天数标签区分（序号只对当前这天有意义）
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-300 px-1 text-[9px] font-bold text-white">
              {dayLabel ?? '—'}
            </span>
          )
        ) : (
          <span className="mt-1 block h-2.5 w-2.5 rounded-full bg-candidate ring-2 ring-white" />
        )}
      </button>

      {/* 主体 */}
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            className="w-full rounded border border-blue-400 px-1.5 py-0.5 text-sm outline-none"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName()
              if (e.key === 'Escape') {
                setDraft(dest.name)
                setEditing(false)
              }
            }}
          />
        ) : (
          <button
            className="flex max-w-full items-center gap-1 text-left text-sm text-slate-800"
            onClick={onToggle}
            onDoubleClick={() => {
              setDraft(dest.name)
              setEditing(true)
            }}
            title={`${dest.name}（双击改名）`}
          >
            {/* 与地图上的标记用同一个分类图标，列表和地图对得上 */}
            <span className="shrink-0 text-[11px]">{poiIcon(dest.tags)}</span>
            <span className="truncate">{dest.name}</span>
          </button>
        )}

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
          <span>{SOURCE_LABEL[dest.source]}</span>
          {dest.openTime && dest.closeTime && (
            <span>
              🕘 {dest.openTime}–{dest.closeTime}
            </span>
          )}
          {/* 「周一闭馆」这类星期信息只在界面提示，不进求解器（模型没有星期维度） */}
          {dest.closedWeekdays?.length ? (
            <span
              className={`rounded px-1 text-[10px] ${
                isClosedToday(dest.closedWeekdays)
                  ? 'bg-red-50 font-medium text-red-600'
                  : 'bg-slate-100 text-slate-500'
              }`}
              title={dest.hoursRaw}
            >
              {isClosedToday(dest.closedWeekdays) ? '今天闭馆' : `${formatClosedWeekdays(dest.closedWeekdays)}闭馆`}
            </span>
          ) : null}
          {dest.tags?.slice(0, 2).map((t) => (
            <span key={t} className="rounded bg-slate-100 px-1 text-slate-500">
              {t}
            </span>
          ))}
        </div>

        <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
          <span>停留</span>
          <input
            type="number"
            min={5}
            max={600}
            step={5}
            className="w-14 rounded border border-slate-200 px-1 py-0.5 text-[11px] outline-none focus:border-blue-400"
            value={dest.stayMin ?? 60}
            onChange={(e) => onStayChange(Number(e.target.value) || 0)}
          />
          <span>分钟</span>
          <span className="ml-1 text-slate-300">
            {dest.lng.toFixed(4)}, {dest.lat.toFixed(4)}
          </span>
        </div>
      </div>

      {/* 操作 */}
      <div className="flex shrink-0 flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          className="rounded px-1 text-[11px] text-slate-500 hover:bg-slate-200"
          onClick={onLocate}
          title="在地图上定位"
        >
          📍 定位
        </button>
        <button
          className="rounded px-1 text-[11px] text-red-500 hover:bg-red-50"
          onClick={onRemove}
          title="删除该点"
        >
          🗑 删除
        </button>
      </div>
    </li>
  )
}
