import { useState } from 'react'
import { MODE_ORDER, MODE_STYLES } from '@/lib/routeStyle'
import { useTripStore } from '@/store/useTripStore'
import type { Weights } from '@/types'

const WEIGHT_META: Array<{ key: keyof Weights; label: string }> = [
  { key: 'time', label: '时间' },
  { key: 'convenience', label: '换乘' },
  { key: 'cost', label: '花费' },
  { key: 'walking', label: '步行' },
]

interface Props {
  onCompile: () => void
  compiling: boolean
  source: 'llm' | 'rules' | null
  stale: boolean
}

/**
 * 意图卡：AI 解析出来的结构，用户可以直接改。
 * 改任何字段都只更新参数（不自动重算），点「编译路书」才重算 —— 意图卡是合同，不是命令。
 */
export default function IntentCard({ onCompile, compiling, source, stale }: Props) {
  const [showWeights, setShowWeights] = useState(false)
  const destinations = useTripStore((s) => s.destinations)
  const days = useTripStore((s) => s.days)
  const mode = useTripStore((s) => s.mode)
  const weights = useTripStore((s) => s.weights)
  const options = useTripStore((s) => s.options)
  const setDays = useTripStore((s) => s.setDays)
  const setMode = useTripStore((s) => s.setMode)
  const setWeight = useTripStore((s) => s.setWeight)
  const setOption = useTripStore((s) => s.setOption)
  const setSelected = useTripStore((s) => s.setSelected)

  const picked = destinations.filter((d) => d.selected)

  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[12px] font-semibold text-slate-800">
          意图卡
          {source && (
            <span className="ml-1.5 rounded bg-slate-900 px-1.5 py-0.5 text-[9px] font-normal text-white">
              {source === 'llm' ? '大模型' : '规则解析'}
            </span>
          )}
        </span>
        <span className="text-[10px] text-slate-400">已标 {picked.length} 个地点</span>
      </div>

      <div className="space-y-2 px-3 pb-2">
        {/* 地点 */}
        <div className="flex flex-wrap gap-1">
          {picked.length === 0 && (
            <span className="text-[11px] text-slate-400">还没有地点 —— 在对话框里说一句</span>
          )}
          {picked.map((dest) => (
            <span
              key={dest.id}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700"
              title={dest.name}
            >
              <span className="max-w-[110px] truncate">{dest.name}</span>
              <button
                className="text-slate-300 hover:text-slate-600"
                onClick={() => setSelected(dest.id, false)}
                title="从路书里去掉"
              >
                ×
              </button>
            </span>
          ))}
        </div>

        {/* 天数 + 方式 */}
        <div className="flex items-center justify-between text-[11px] text-slate-600">
          <span>天数</span>
          <span className="flex items-center gap-1">
            <button
              className="h-5 w-5 rounded border border-slate-300 text-[11px] leading-none hover:bg-slate-50 disabled:opacity-40"
              onClick={() => setDays(days - 1)}
              disabled={days <= 1}
            >
              −
            </button>
            <b className="w-6 text-center text-slate-900">{days}</b>
            <button
              className="h-5 w-5 rounded border border-slate-300 text-[11px] leading-none hover:bg-slate-50 disabled:opacity-40"
              onClick={() => setDays(days + 1)}
              disabled={days >= 7}
            >
              +
            </button>
          </span>
        </div>

        <div className="flex flex-wrap gap-1">
          {MODE_ORDER.map((key) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              title={MODE_STYLES[key].hint}
              className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                mode === key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {MODE_STYLES[key].label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-slate-600">
          <label className="flex items-center gap-1">
            出发
            <input
              type="time"
              value={options.dayStartTime}
              onChange={(event) => setOption('dayStartTime', event.target.value)}
              className="rounded border border-slate-300 px-1 py-0.5 text-[10px] outline-none focus:border-slate-800"
            />
          </label>
          <label className="flex items-center gap-1">
            收工
            <input
              type="time"
              value={options.dayEndTime}
              onChange={(event) => setOption('dayEndTime', event.target.value)}
              className="rounded border border-slate-300 px-1 py-0.5 text-[10px] outline-none focus:border-slate-800"
            />
          </label>
        </div>

        {/* 权重（默认收起，避免把编译按钮挤下去） */}
        <button
          className="flex w-full items-center justify-between border-t border-slate-100 pt-1.5 text-[10px] text-slate-400 hover:text-slate-600"
          onClick={() => setShowWeights((value) => !value)}
        >
          <span>偏好权重（可选）</span>
          <span>{showWeights ? '收起' : '展开'}</span>
        </button>
        {showWeights && (
          <div className="space-y-1">
            {WEIGHT_META.map(({ key, label }) => (
              <div key={key} className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-[10px] text-slate-500">{label}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={weights[key]}
                  onChange={(event) => setWeight(key, Number(event.target.value))}
                  className="h-1 min-w-0 flex-1 cursor-pointer accent-slate-700"
                />
                <span className="w-6 shrink-0 text-right text-[10px] text-slate-500">
                  {weights[key].toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        )}

        <button
          className="w-full rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-800 disabled:bg-slate-300"
          onClick={onCompile}
          disabled={compiling || picked.length === 0}
        >
          {compiling ? '编译中…' : stale ? '参数已改，重新编译' : '编译路书'}
        </button>
      </div>
    </div>
  )
}
