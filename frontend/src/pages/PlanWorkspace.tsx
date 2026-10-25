import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { aiParse, aiReplan } from '@/api/client'
import ChatDock, { type ChatMessage } from '@/components/ChatDock'
import HotelPanel from '@/components/HotelPanel'
import IntentCard from '@/components/IntentCard'
import MapView from '@/components/MapView'
import PoiQuickAdd from '@/components/PoiQuickAdd'
import ShareActions from '@/components/ShareActions'
import TimelineVertical from '@/components/TimelineVertical'
import BottomBar from '@/components/BottomBar'
import { usePlanController } from '@/hooks/usePlanController'
import { uid } from '@/lib/id'
import { usePlanStale } from '@/lib/routeOrder'
import { useTripStore } from '@/store/useTripStore'
import type { AiReplanConstraints } from '@/types'

/**
 * 工作台：左（地点/意图卡 + 左下角 AI 对话）｜中（地图）｜右（竖排路书）
 *
 * 关键流程（1.1）：
 *   第一句话 → 只做"解析 + 在地图上标点"，不编译；
 *   后续每句话 → 增量改参数并重新编译；
 *   也可以随时点意图卡上的「编译路书」。
 */
export default function PlanWorkspace() {
  const navigate = useNavigate()
  const { run, planning, buildPayload } = usePlanController()
  const stale = usePlanStale()
  const pendingPrompt = useTripStore((s) => s.pendingPrompt)
  const setPendingPrompt = useTripStore((s) => s.setPendingPrompt)
  const addDestinations = useTripStore((s) => s.addDestinations)
  const setPlan = useTripStore((s) => s.setPlan)
  const setWeight = useTripStore((s) => s.setWeight)
  const setOption = useTripStore((s) => s.setOption)
  const setDays = useTripStore((s) => s.setDays)
  const setMode = useTripStore((s) => s.setMode)
  const updateDestination = useTripStore((s) => s.updateDestination)
  const showToast = useTripStore((s) => s.showToast)
  const saveTrip = useTripStore((s) => s.saveTrip)
  const profile = useTripStore((s) => s.profile)
  const trips = useTripStore((s) => s.trips)
  const activeTripId = useTripStore((s) => s.activeTripId)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [source, setSource] = useState<'llm' | 'rules' | null>(null)
  const [hotelOpen, setHotelOpen] = useState(false)
  const startedRef = useRef(false)

  const hotel = useTripStore((s) => s.hotel)

  const title = trips.find((trip) => trip.id === activeTripId)?.title ?? '未命名路书'

  function pushAi(text: string, meta?: string) {
    setMessages((prev) => [...prev, { id: uid('m'), role: 'ai', text, meta }])
  }

  function applyConstraints(constraints: AiReplanConstraints, removed: string[]) {
    for (const [key, value] of Object.entries(constraints.weights ?? {})) {
      if (typeof value === 'number') setWeight(key as 'time' | 'convenience' | 'cost' | 'walking', value)
    }
    if (constraints.dayStartTime) setOption('dayStartTime', constraints.dayStartTime)
    if (constraints.dayEndTime) setOption('dayEndTime', constraints.dayEndTime)
    if (typeof constraints.lunchBreakMin === 'number') setOption('lunchBreakMin', constraints.lunchBreakMin)
    if (constraints.days) setDays(constraints.days)
    if (constraints.mode) setMode(constraints.mode)
    if (removed.length) {
      for (const dest of useTripStore.getState().destinations) {
        if (removed.some((name) => dest.name === name || dest.name.includes(name))) {
          updateDestination(dest.id, { selected: false })
        }
      }
    }
  }

  async function handleSend(text: string) {
    setMessages((prev) => [...prev, { id: uid('m'), role: 'user', text }])
    setBusy(true)
    try {
      const state = useTripStore.getState()
      const hasPlaces = state.destinations.some((dest) => dest.selected)

      if (!hasPlaces) {
        // 第一轮：只解析 + 标点，不编译
        const parsed = await aiParse(text)
        setSource(parsed.source === 'llm' ? 'llm' : 'rules')
        if (!parsed.places.length) {
          pushAi('没听出具体地点。可以直接说地名，比如「外滩、豫园、武康路」。')
          return
        }
        addDestinations(
          parsed.places.map((place) => ({
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
        const names = parsed.places.map((place) => place.name).join('、')
        pushAi(
          `先把这 ${parsed.places.length} 个地点标到地图上了：${names}。\n` +
            '再确认两件事，我就能编译：玩几天？交通偏公交、地铁还是打车？',
          parsed.source === 'llm' ? '大模型解析' : '规则解析',
        )
        if (parsed.unresolved.length) {
          pushAi(`这几个没认出来：${parsed.unresolved.join('、')}（可以换个说法再试）。`)
        }
        return
      }

      // 后续轮次：增量改参数 + 重新编译
      const result = await aiReplan({ ...buildPayload(), text })
      setSource(result.source === 'llm' ? 'llm' : 'rules')
      applyConstraints(result.constraints as AiReplanConstraints, result.removed)
      // 用后端算好的路书覆盖，并把指纹对齐
      setPlan(result.plan)
      const applied = result.applied.length ? result.applied.join('；') : '没有可执行的调整'
      pushAi(
        `${applied}。\n已按新参数重新编译：${result.plan.days.length} 天 / ` +
          `${result.plan.days.reduce((sum, day) => sum + day.stops.length, 0)} 站。`,
        result.source === 'llm' ? '大模型解析' : '规则解析',
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI 调用失败'
      showToast('error', message)
      pushAi(`❌ ${message}`)
    } finally {
      setBusy(false)
    }
  }

  // 从首页带过来的第一句话，只跑一次
  useEffect(() => {
    if (startedRef.current) return
    if (!pendingPrompt) return
    startedRef.current = true
    setPendingPrompt(null)
    void handleSend(pendingPrompt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt])

  function handleSave() {
    const record = saveTrip()
    showToast('success', `已保存「${record.title}」到「${record.group}」`)
  }

  return (
    <div className="flex h-full flex-col bg-slate-100">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <button className="text-[11px] text-slate-400 hover:text-slate-700" onClick={() => navigate('/')}>
          ← 首页
        </button>
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
          {profile ? profile.nickname : '本地草稿'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50"
            onClick={handleSave}
          >
            保存
          </button>
          <ShareActions />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左栏：地点 / 意图卡 + 左下角对话 */}
        <aside className="flex w-[380px] shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="tc-scroll min-h-0 flex-1 overflow-y-auto">
            <button
              className="flex w-full items-center gap-2 border-b border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
              onClick={() => setHotelOpen((value) => !value)}
            >
              <span className="h-2.5 w-2.5 rounded-[3px] bg-[#1d4ed8]" />
              <span className="text-[11.5px] font-medium text-slate-700">出发酒店</span>
              <span className="min-w-0 truncate text-[11px] text-slate-500">{hotel.name}</span>
              <span className="ml-auto shrink-0 text-[10px] text-slate-400">
                {hotelOpen ? '收起' : '更换'}
              </span>
            </button>
            {hotelOpen && <HotelPanel />}
            <PoiQuickAdd />
            <IntentCard
              onCompile={() => void run()}
              compiling={planning}
              source={source}
              stale={stale}
            />
          </div>
          <div className="h-[300px] shrink-0">
            <ChatDock
              messages={messages}
              busy={busy}
              onSend={(text) => void handleSend(text)}
              examples={
                messages.length <= 1
                  ? ['2 天，用地铁', '少走路，6 点前回酒店', '不想去田子坊了']
                  : ['改成 3 天', '省点钱', '多拍照，别太赶']
              }
              hint={planning ? '编译中…' : undefined}
            />
          </div>
        </aside>

        {/* 中间：地图 */}
        <section className="relative min-w-0 flex-1">
          <MapView />
        </section>

        {/* 右栏：竖排路书 */}
        <aside className="w-[340px] shrink-0 border-l border-slate-200 bg-white">
          <TimelineVertical />
        </aside>
      </div>

      <BottomBar />
    </div>
  )
}
