import { useState } from 'react'
import { aiExplain, aiParse, aiReplan } from '@/api/client'
import { usePlanController } from '@/hooks/usePlanController'
import { useTripStore } from '@/store/useTripStore'

const EXAMPLES = [
  { label: '经典三件套', text: '我想去外滩、豫园、武康路' },
  { label: '少走路 6 点回', text: '少走路，多拍照，6 点前回酒店' },
  { label: '两天古镇', text: '带爸妈玩两天，想去朱家角、七宝老街，别安排太累' },
  { label: '省钱坐地铁', text: '改成 3 天，用地铁，省点钱' },
]

const SOURCE_LABEL: Record<string, string> = {
  llm: '大模型',
  rules: '规则解析',
}

/**
 * AI 面板（模块 4）—— 三个能力放在一处：
 *   1) 自然语言解析目的地：说出想去哪儿 → 自动标点（Function Calling → 地理编码）
 *   2) 一句话重规划：改偏好/时间/天数/交通方式，甚至"不想去 X 了" → 直接重算
 *   3) 路线解释：把求解器给出的事实讲成人话
 *
 * 无 LLM Key 时后端自动降级为规则解析，面板上的徽标会显示「规则解析」，
 * 功能照常可用 —— 这是现场演示的兜底。
 */
export default function AiPanel() {
  const [open, setOpen] = useState(true)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<null | 'parse' | 'replan' | 'explain'>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [source, setSource] = useState<string | null>(null)

  const plan = useTripStore((s) => s.plan)
  const aiExplainState = useTripStore((s) => s.aiExplain)
  const setAiExplain = useTripStore((s) => s.setAiExplain)
  const addDestinations = useTripStore((s) => s.addDestinations)
  const updateDestination = useTripStore((s) => s.updateDestination)
  const setPlan = useTripStore((s) => s.setPlan)
  const setWeight = useTripStore((s) => s.setWeight)
  const setOption = useTripStore((s) => s.setOption)
  const setDays = useTripStore((s) => s.setDays)
  const setMode = useTripStore((s) => s.setMode)
  const setPlanError = useTripStore((s) => s.setPlanError)
  const { buildPayload } = usePlanController()

  function reset() {
    setMessage(null)
    setWarnings([])
  }

  /** 1) 自然语言解析目的地并自动标点 */
  async function handleParse() {
    if (!text.trim()) return
    setBusy('parse')
    reset()
    try {
      const result = await aiParse(text)
      setSource(result.source)
      if (result.places.length) {
        const { added, skipped } = addDestinations(
          result.places.map((place) => ({
            name: place.name,
            lng: place.lng,
            lat: place.lat,
            source: 'ai' as const,
            selected: true,
            stayMin: place.stayMin,
            openTime: place.openTime,
            closeTime: place.closeTime,
            tags: place.tags,
            address: place.address ?? undefined,
          })),
        )
        setMessage(
          `已标点 ${added} 个地点${skipped ? `（${skipped} 个位置重复已跳过）` : ''}：` +
            result.places.map((p) => p.name).join('、'),
        )
      } else {
        setMessage(result.summary || '没有解析出地点')
      }
      if (result.unresolved.length) {
        setWarnings((prev) => [...prev, `没能定位：${result.unresolved.join('、')}`])
      }
      setWarnings((prev) => [...prev, ...result.warnings])
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'AI 解析失败')
    } finally {
      setBusy(null)
    }
  }

  /** 2) 一句话重规划：解析约束 → 写回参数 → 用后端重算好的路书替换当前计划 */
  async function handleReplan() {
    if (!text.trim()) return
    setBusy('replan')
    reset()
    try {
      const result = await aiReplan({ ...buildPayload(), text })
      setSource(result.source)
      const constraints = result.constraints ?? {}

      // 先把参数写回 store，再 setPlan —— 这样「计划指纹」与路书是一致的，不会误报"已过期"
      for (const [key, value] of Object.entries(constraints.weights ?? {})) {
        if (typeof value === 'number') setWeight(key as 'time' | 'convenience' | 'cost' | 'walking', value)
      }
      if (constraints.dayStartTime) setOption('dayStartTime', constraints.dayStartTime)
      if (constraints.dayEndTime) setOption('dayEndTime', constraints.dayEndTime)
      if (typeof constraints.lunchBreakMin === 'number') {
        setOption('lunchBreakMin', constraints.lunchBreakMin)
      }
      if (constraints.days) setDays(constraints.days)
      if (constraints.mode) setMode(constraints.mode)

      // 被移除的地点要同步取消选中，否则指纹对不上
      if (result.removed.length) {
        for (const dest of useTripStore.getState().destinations) {
          if (result.removed.some((name) => dest.name === name || dest.name.includes(name))) {
            updateDestination(dest.id, { selected: false })
          }
        }
      }

      setPlan(result.plan)
      setMessage(
        (result.applied.length ? `已重算：${result.applied.join('；')}` : '没有可执行的调整') +
          `，共 ${result.plan.days.length} 天 / ${
            result.plan.days.reduce((sum, day) => sum + day.stops.length, 0)
          } 站`,
      )
      setWarnings(result.warnings)
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'AI 重规划失败')
    } finally {
      setBusy(null)
    }
  }

  /** 3) 路线解释 */
  async function handleExplain() {
    if (!plan) {
      setPlanError('先编译一份路书，再让 AI 讲解')
      return
    }
    setBusy('explain')
    reset()
    try {
      const result = await aiExplain(plan, text.trim() || undefined)
      setSource(result.source)
      setAiExplain({ text: result.text, source: result.source })
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'AI 讲解失败')
    } finally {
      setBusy(null)
    }
  }

  const disabled = busy !== null

  return (
    <section className="border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          AI 路书助手
          {source && (
            <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-normal text-white">
              {SOURCE_LABEL[source] ?? source}
            </span>
          )}
        </h2>
        <span className="text-[11px] text-slate-400">{open ? '收起' : '展开'}</span>
      </button>

      {open && (
        <div className="space-y-2 px-3 pb-3">
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="用一句话说你想怎么玩：我想去外滩、豫园、武康路"
            className="w-full resize-none rounded-lg border border-slate-300 px-2.5 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-slate-800"
          />

          <div className="flex flex-wrap gap-1.5">
            <button
              className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              onClick={() => void handleParse()}
              disabled={disabled || !text.trim()}
              title="解析这句话里的地点，自动在地图上标点"
            >
              {busy === 'parse' ? '解析中…' : '解析并标点'}
            </button>
            <button
              className="rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
              onClick={() => void handleReplan()}
              disabled={disabled || !text.trim()}
              title="按这句话调整偏好/时间/天数/交通方式，并立刻重算路书"
            >
              {busy === 'replan' ? '重算中…' : '一句话重规划'}
            </button>
            <button
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => void handleExplain()}
              disabled={disabled || !plan}
              title="把当前路书讲成人话"
            >
              {busy === 'explain' ? '生成中…' : '讲讲为什么这样排'}
            </button>
          </div>

          <div className="flex flex-wrap gap-1">
            {EXAMPLES.map((example) => (
              <button
                key={example.label}
                className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500 hover:border-slate-400 hover:text-slate-700"
                onClick={() => setText(example.text)}
                title={example.text}
              >
                {example.label}
              </button>
            ))}
          </div>

          {message && (
            <p className="rounded bg-slate-50 px-2 py-1 text-[11px] leading-4 text-slate-600">
              {message}
            </p>
          )}
          {warnings.map((warning) => (
            <p key={warning} className="rounded bg-amber-50 px-2 py-1 text-[11px] leading-4 text-amber-700">
              {warning}
            </p>
          ))}

          {aiExplainState && (
            <div className="rounded-lg border border-slate-200 bg-white p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] text-slate-400">
                  {SOURCE_LABEL[aiExplainState.source] ?? aiExplainState.source} 生成
                </span>
                <button
                  className="text-[10px] text-slate-400 hover:text-slate-600"
                  onClick={() => setAiExplain(null)}
                >
                  关闭
                </button>
              </div>
              <p className="text-[11px] leading-5 text-slate-700">{aiExplainState.text}</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
