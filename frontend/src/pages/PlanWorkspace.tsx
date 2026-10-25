import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { aiParse, aiReplan } from '@/api/client'
import AddStopDialog from '@/components/AddStopDialog'
import ChatDock, { type ChatMessage } from '@/components/ChatDock'
import HotelPanel from '@/components/HotelPanel'
import MapView from '@/components/MapView'
import PoiQuickAdd from '@/components/PoiQuickAdd'
import TimelineVertical from '@/components/TimelineVertical'
import BottomBar from '@/components/BottomBar'
import { getCity } from '@/data/cities'
import { usePlanController } from '@/hooks/usePlanController'
import { uid } from '@/lib/id'
import { setSearchCity } from '@/lib/amapSearch'
import { usePlanStale } from '@/lib/routeOrder'
import { useTripStore } from '@/store/useTripStore'
import type { AiReplanConstraints, TravelMode } from '@/types'

/**
 * 工作台：左（起点/搜索 + 左下角 AI 对话）｜中（地图）｜右（可互动的竖排路书）
 *
 * 关键流程（1.1）：
 *   第一句话 → 只做"解析 + 在地图上标点"，不编译；
 *   后续每句话 → 增量改参数并重新编译；
 *   底栏「一键编译路书」随时可手动编译。
 */
const DAY_WORDS: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7 }

/** 从一句话里扒出"几天 / 什么交通方式"，第一轮就能用上，不用等到第二轮 */
function parseHints(text: string): { days: number | null; mode: TravelMode | null } {
  const dayMatch = text.match(/([一二两三四五六七\d])\s*(天|日)/)
  let days: number | null = null
  if (dayMatch) {
    const value = DAY_WORDS[dayMatch[1]] ?? Number(dayMatch[1])
    if (Number.isFinite(value) && value >= 1 && value <= 7) days = value
  }
  const modeRules: Array<[RegExp, TravelMode]> = [
    [/地铁/, 'subway'],
    [/打车|出租|的士/, 'taxi'],
    [/公交|大巴/, 'transit'],
    [/走路|步行/, 'walk'],
    [/自驾|开车/, 'drive'],
  ]
  const mode = modeRules.find(([pattern]) => pattern.test(text))?.[1] ?? null
  return { days, mode }
}

export default function PlanWorkspace() {
  const navigate = useNavigate()
  const { run, planning, buildPayload } = usePlanController()
  const stale = usePlanStale()
  const plan = useTripStore((s) => s.plan)
  const cityId = useTripStore((s) => s.cityId)
  const city = getCity(cityId)
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
  const [hotelOpen, setHotelOpen] = useState(false)
  const [cityAddOpen, setCityAddOpen] = useState(false)
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
        // 先从句子里扒出天数 / 交通方式（"两日游" "2 天" "用地铁"），能直接用上
        const hints = parseHints(text)
        if (hints.days) setDays(hints.days)
        if (hints.mode) setMode(hints.mode)

        // 第一轮：解析 + 标点，不编译
        const parsed = await aiParse(text)

        if (!parsed.places.length) {
          const wantsSuggestion = /推荐|随便|帮我|安排|规划|不知道|看着办|都行/.test(text)
        const hotelNote = /酒店|住宿|住哪/.test(text)
          ? ' 酒店那句我记下了——自动定位酒店要你在右侧「出发酒店 → 更换」里搜一下（或在地图上点）。'
          : ''
          if (wantsSuggestion && city.pois.length) {
            const picks = city.pois.slice(0, hints.days && hints.days > 1 ? 6 : 5)
            addDestinations(
              picks.map((poi) => ({
                name: poi.name,
                lng: poi.lng,
                lat: poi.lat,
                source: 'import' as const,
                selected: true,
                stayMin: poi.stayMin,
                openTime: poi.openTime,
                closeTime: poi.closeTime,
                tags: poi.tags,
                address: poi.district,
              })),
            )
            pushAi(
              `好，你没指名地点，我先按${city.name}这几个地方给你排：` +
                `${picks.map((poi) => poi.name).join('、')}。` +
                (hints.days ? `按 ${hints.days} 天算。` : '') +
                ` 直接编译出来了，想换掉哪个就说「不想去XX」。${hotelNote}`,
              '按城市地标推荐',
            )
            await run()
            return
          }
          const examples = city.pois
            .slice(0, 3)
            .map((poi) => poi.name)
            .join('、')
          pushAi(
            `这句话里我没认出具体地点。可以说地名（比如${examples || '外滩、豫园'}），` +
              `或者直接说「推荐一条两日游」，我按城市地标先给你排一版。${hotelNote}`,
          )
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
        // 大模型失败时把原因摊开说，别让人以为"AI 就是这样"
        if (parsed.warnings?.length) {
          pushAi(`⚠️ ${parsed.warnings[0]}`, '降级提示')
        } else if (parsed.source !== 'llm') {
          pushAi('当前用的是内置规则解析（没检测到可用的大模型 Key）。到「个人」页填 Key 后点「测试 AI 连接」。', '规则模式')
        }
        return
      }

      // 后续轮次：增量改参数 + 重新编译
      const result = await aiReplan({ ...buildPayload(), text })
      applyConstraints(result.constraints as AiReplanConstraints, result.removed)
      // 用后端算好的路书覆盖，并把指纹对齐
      setPlan(result.plan)
      // 优先用后端生成的人话回复（含取舍理由）；没有才退回变更清单
      const stops = result.plan.days.reduce((sum, day) => sum + day.stops.length, 0)
      const applied = result.applied.length ? result.applied.join('、') : '没有可执行的调整'
      const replyText =
        result.reply?.trim() ||
        `${applied}。已重新编译：${result.plan.days.length} 天 / ${stops} 站。`
      pushAi(replyText, result.source === 'llm' ? '大模型 · 已重新编译' : '规则解析 · 已重新编译')
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

  // 切城市时让在线搜索也按新城市过滤
  useEffect(() => {
    setSearchCity(city.name)
  }, [city.name])

  function handleSave() {
    const record = saveTrip()
    showToast('success', `已保存「${record.title}」到「${record.group}」`)
  }

  function addCityPoi(name: string) {
    const poi = city.pois.find((item) => item.name === name)
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
    showToast(added ? 'success' : 'error', added ? `已加入「${poi.name}」` : '这个地点已经在列表里了')
  }

  return (
    <div className="flex h-full flex-col bg-slate-100">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-white">{city.name}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
          {profile ? profile.nickname : '本地草稿'}
        </span>
        <span className="text-[10px] text-slate-400">
          {planning ? '编译中…' : stale ? '参数已改，待重算' : plan ? '已编译' : '未编译'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50"
            onClick={() => navigate('/')}
          >
            换城市
          </button>
          <button
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50"
            onClick={handleSave}
          >
            保存
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左栏：整栏给 AI 助手 */}
        <aside className="flex w-[380px] shrink-0 flex-col border-r border-slate-200 bg-white">
          <ChatDock
            messages={messages}
            busy={busy}
            onSend={(text) => void handleSend(text)}
            examples={
              messages.length <= 1
                ? ['2 天，用地铁', '少走路，6 点前回酒店', '别排太满']
                : ['改成 3 天', '省点钱', '多拍照，别太赶']
            }
            hint={planning ? '编译中…' : undefined}
          />
        </aside>

        {/* 中间：地图（左上角悬浮搜索 / 城市地标） */}
        <section className="relative min-w-0 flex-1">
          <MapView />

          <div className="absolute left-3 top-3 z-20 w-[320px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_18px_40px_-28px_rgba(15,23,42,.6)]">
            {city.id === 'shanghai' ? (
              <PoiQuickAdd />
            ) : (
              <div className="px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-slate-700">
                    {city.name} · 添加地点
                  </span>
                  <span className="text-[10px] text-slate-400">{city.pois.length} 个地标</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {city.pois.map((poi) => (
                    <button
                      key={poi.name}
                      className="max-w-full truncate rounded-full border border-slate-200 px-2 py-0.5 text-[10.5px] text-slate-600 hover:border-slate-400 hover:text-slate-900"
                      onClick={() => addCityPoi(poi.name)}
                      title={poi.name}
                    >
                      + {poi.name}
                    </button>
                  ))}
                </div>
                <button
                  className="mt-2 text-[10px] text-slate-400 hover:text-slate-700"
                  onClick={() => setCityAddOpen(true)}
                >
                  搜索更多 ›
                </button>
              </div>
            )}
          </div>
        </section>

        {/* 右栏：出发酒店 + 竖排路书 */}
        <aside className="flex w-[340px] shrink-0 flex-col border-l border-slate-200 bg-white">
          <button
            className="flex w-full shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
            onClick={() => setHotelOpen((value) => !value)}
          >
            <span className="h-2.5 w-2.5 rounded-[3px] bg-[#1d4ed8]" />
            <span className="text-[11.5px] font-medium text-slate-700">出发酒店</span>
            <span className="min-w-0 truncate text-[11px] text-slate-500">{hotel.name}</span>
            <span className="ml-auto shrink-0 text-[10px] text-slate-400">
              {hotelOpen ? '收起' : '更换'}
            </span>
          </button>
          {hotelOpen && (
            <div className="tc-scroll max-h-[45%] shrink-0 overflow-y-auto border-b border-slate-200">
              <HotelPanel />
            </div>
          )}
          <div className="min-h-0 flex-1">
            <TimelineVertical />
          </div>
        </aside>
      </div>

      <BottomBar />

      <AddStopDialog
        open={cityAddOpen}
        onClose={() => setCityAddOpen(false)}
        pool={city.pois}
        onAdded={() => window.setTimeout(() => void run(), 0)}
      />
    </div>
  )
}










