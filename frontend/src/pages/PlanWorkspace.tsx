import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { aiApply, aiTurn } from '@/api/client'
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
import { needsTransportRefresh } from '@/lib/routeQuality'
import { clearChatHistory, DRAFT_CHAT_KEY, loadChatHistory, saveChatHistory } from '@/lib/chatHistory'
import { useTripStore } from '@/store/useTripStore'
import type { TravelMode } from '@/types'

/**
 * 工作台：左（起点/搜索 + 左下角 AI 对话）｜中（地图）｜右（可互动的竖排路书）
 *
 * 关键流程（1.1）：
 *   每句话 → 先出提案（要改什么），用户确认后才动路书；
 *   改动完回一行小字回执（+1 地点 / 更新 3 段交通 …）。
 */

/**
 * 有未处理提案时，整句输入视为「确认执行」/「取消」的自然语言说法。
 * 只匹配短句，避免把「确认一下还有没有别的方案」这类新需求误判成确认。
 */
const CONFIRM_TEXT = /^(?:(?:好的|是的|是|对|好|行|可以|嗯|确认|同意|没问题|没毛病|就这么办|就这样|动手做|动手|执行|开始|搞|弄|改|做|安排)[，。！!、\s吧]*)+$/u
const CANCEL_TEXT = /^(?:(?:算了|取消|不用了|不要了|不了|别改了|不执行|不确认|不弄了|换个说法|换个方案|再想想|重新想|重新说)[，。！!～~、\s吧]*)+$/u

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

  // 对话按路书存档：已保存的路书用它的 id，未保存的新会话用草稿槽
  const [chatKey, setChatKey] = useState<string>(() => activeTripId ?? DRAFT_CHAT_KEY)
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChatHistory(activeTripId ?? DRAFT_CHAT_KEY))
  const [busy, setBusy] = useState(false)
  const [hotelOpen, setHotelOpen] = useState(false)
  const [cityAddOpen, setCityAddOpen] = useState(false)
  const startedRef = useRef(false)
  const checkedTrafficRef = useRef(false)

  const hotel = useTripStore((s) => s.hotel)

  const title = trips.find((trip) => trip.id === activeTripId)?.title ?? '未命名路书'

  function pushAi(text: string, meta?: string) {
    setMessages((prev) => [...prev, { id: uid('m'), role: 'ai', text, meta }])
  }

  function applyOpsToStore(ops: Record<string, unknown>) {
    const addPlaces = ops.addPlaces as
      | Array<{ name: string; lng: number; lat: number; stayMin?: number; openTime?: string; closeTime?: string; tags?: string[] }>
      | undefined
    if (addPlaces?.length) {
      addDestinations(
        addPlaces.map((item) => ({
          name: item.name,
          lng: item.lng,
          lat: item.lat,
          source: 'ai' as const,
          selected: true,
          stayMin: item.stayMin ?? 60,
          openTime: item.openTime,
          closeTime: item.closeTime,
          tags: item.tags,
        })),
      )
    }
    const removeNames = ops.removeNames as string[] | undefined
    if (removeNames?.length) {
      for (const dest of useTripStore.getState().destinations) {
        if (removeNames.some((name) => dest.name === name || dest.name.includes(name) || name.includes(dest.name))) {
          updateDestination(dest.id, { selected: false })
        }
      }
    }
    if (typeof ops.days === 'number') setDays(ops.days)
    if (typeof ops.mode === 'string') setMode(ops.mode as TravelMode)
    const weights = ops.weights as Record<string, number> | undefined
    if (weights) {
      for (const [key, value] of Object.entries(weights)) {
        if (typeof value === 'number') setWeight(key as 'time' | 'convenience' | 'cost' | 'walking', value)
      }
    }
    const times = ops.times as { dayStartTime?: string; dayEndTime?: string } | undefined
    if (times?.dayStartTime) setOption('dayStartTime', times.dayStartTime)
    if (times?.dayEndTime) setOption('dayEndTime', times.dayEndTime)
    const stayChanges = ops.stayChanges as Array<{ name: string; stayMin: number }> | undefined
    if (stayChanges?.length) {
      const all = useTripStore.getState().destinations
      for (const change of stayChanges) {
        const target = all.find(
          (d) => d.name === change.name || d.name.includes(change.name) || change.name.includes(d.name),
        )
        if (target && typeof change.stayMin === 'number') {
          updateDestination(target.id, { stayMin: Math.max(5, Math.min(change.stayMin, 600)) })
        }
      }
    }
  }

  /** 一轮对话：只出提案，等用户点确认；也可以打字「确认 / 换个说法」直接处理提案 */
  async function handleSend(text: string) {
    const trimmed = text.trim()
    // 有待确认提案时，整句「确认 / 取消」直接执行或取消，不再发给大模型
    const pendingMessage = [...messages].reverse().find((m) => m.pending && !m.resolved)
    if (pendingMessage) {
      if (CONFIRM_TEXT.test(trimmed)) {
        setMessages((prev) => [...prev, { id: uid('m'), role: 'user', text: trimmed }])
        await handleConfirm(pendingMessage.id)
        return
      }
      if (CANCEL_TEXT.test(trimmed)) {
        setMessages((prev) => [...prev, { id: uid('m'), role: 'user', text: trimmed }])
        handleCancel(pendingMessage.id)
        return
      }
    }
    setMessages((prev) => [...prev, { id: uid('m'), role: 'user', text }])
    setBusy(true)
    try {
      const res = await aiTurn({
        ...buildPayload(),
        text,
        cityPois: city.pois as unknown as Array<Record<string, unknown>>,
        cityName: city.name,
        // 最近 6 轮，解决"刚才那个"这类指代
        history: messages.slice(-6).map((m) => ({ role: m.role, text: m.text })),
      })
      const id = uid('m')
      setMessages((prev) => [
        ...prev,
        {
          id,
          role: 'ai',
          text: res.question ? `${res.reply}\n${res.question}` : res.reply,
          preview: res.preview,
          pending: res.kind === 'act',
          ops: res.kind === 'act' ? res.ops : undefined,
          options: res.options,
          meta:
            res.source === 'llm'
              ? `大模型提案${res.warnings?.length ? ' · ' + res.warnings.join('、') : ''}`
              : res.warnings?.[0] ?? '规则兜底（模型未参与）',
        },
      ])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI 调用失败'
      showToast('error', message)
      pushAi(`❌ ${message}（可以再说一次，或者直接手动改）`)
    } finally {
      setBusy(false)
    }
  }

  /** 确认后才真正改参数 + 编译 */
  async function handleConfirm(id: string) {
    const ops = messages.find((message) => message.id === id)?.ops
    if (!ops) return
    setBusy(true)
    try {
      const res = await aiApply({ ...buildPayload(), ops })
      applyOpsToStore(ops)
      setPlan(res.plan)
      setMessages((prev) =>
        prev.map((message) =>
          message.id === id
            ? {
                ...message,
                pending: false,
                resolved: 'confirmed' as const,
                caption: res.caption,
                ops: undefined,
              }
            : message,
        ),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : '执行失败'
      showToast('error', message)
      pushAi(`❌ ${message}`)
    } finally {
      setBusy(false)
    }
  }

  function handleCancel(id: string) {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === id
          ? { ...message, pending: false, resolved: 'cancelled' as const, ops: undefined }
          : message,
      ),
    )
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

  // 刷新时重算旧版本或过期的车辆路线，保留地点、偏好与逐段选择。
  useEffect(() => {
    if (checkedTrafficRef.current || !plan || planning || busy || pendingPrompt) return
    checkedTrafficRef.current = true
    if (needsTransportRefresh(plan) && buildPayload().destinations.length > 0) {
      void run()
    }
  }, [plan, planning, busy, pendingPrompt, buildPayload, run])

  // 切城市时让在线搜索也按新城市过滤
  useEffect(() => {
    setSearchCity(city.name)
  }, [city.name])

  // 聊天记录落盘：按当前路书 key 保存（含待确认提案的 ops）
  useEffect(() => {
    saveChatHistory(chatKey, messages)
  }, [chatKey, messages])

  // 路书 id 变化（如首次保存分配新 id）：把当前对话迁到新 key，避免串台或丢失
  useEffect(() => {
    const next = activeTripId ?? DRAFT_CHAT_KEY
    if (next === chatKey) return
    saveChatHistory(next, loadChatHistory(chatKey))
    clearChatHistory(chatKey)
    setChatKey(next)
    setMessages(loadChatHistory(next))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTripId])

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
            onConfirm={(id) => void handleConfirm(id)}
            onCancel={handleCancel}
            examples={
              messages.length <= 1
                ? ['2 天，用地铁', '少走路，6 点前回酒店', '别排太满']
                : ['改成 3 天', '省点钱', '多拍照，别太赶']
            }
            hint={
              planning
                ? '编译中…'
                : messages.some((m) => m.pending && !m.resolved)
                  ? '有提案待确认：回复「确认」执行、「换个说法」取消'
                  : undefined
            }
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
















