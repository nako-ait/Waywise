import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { DEMO_ROUTES } from '@/data/demoRoutes'
import { SHANGHAI_POIS } from '@/data/shanghaiPois'
import { useTripStore, type NewDestinationInput } from '@/store/useTripStore'

/**
 * 首页：推荐线路做成上方悬浮气泡，AI 输入框沉到页面底部。
 * 点气泡 = 直接用这份示例进工作台；底部输入框 = 一句话起手。
 */
export default function Home() {
  const navigate = useNavigate()
  const trips = useTripStore((s) => s.trips)
  const setPendingPrompt = useTripStore((s) => s.setPendingPrompt)
  const setHotel = useTripStore((s) => s.setHotel)
  const setMode = useTripStore((s) => s.setMode)
  const setDays = useTripStore((s) => s.setDays)
  const clearDestinations = useTripStore((s) => s.clearDestinations)
  const addDestinations = useTripStore((s) => s.addDestinations)
  const showToast = useTripStore((s) => s.showToast)

  const [prompt, setPrompt] = useState('')

  function start() {
    const text = prompt.trim()
    if (!text) return
    setPendingPrompt(text)
    navigate('/plan')
  }

  function loadDemo(routeId: string) {
    const route = DEMO_ROUTES.find((item) => item.id === routeId)
    if (!route) return
    clearDestinations()
    setHotel({ ...route.hotel, name: route.hotel.name })
    setMode(route.mode)
    setDays(route.days)
    const inputs = route.poiNames
      .map((name) => SHANGHAI_POIS.find((poi) => poi.name === name))
      .filter((poi): poi is (typeof SHANGHAI_POIS)[number] => Boolean(poi))
      .map(
        (poi) =>
          ({
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
          }) satisfies NewDestinationInput,
      )
    const { added } = addDestinations(inputs)
    showToast('success', `已载入「${route.name}」${added} 个地点`)
    navigate('/plan')
  }

  const bubbleStyle = [
    { left: '7%', top: '30%', rotate: '-3deg', delay: '0s' },
    { left: '39%', top: '24%', rotate: '2deg', delay: '1.4s' },
    { left: '68%', top: '33%', rotate: '3deg', delay: '2.8s' },
  ]

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[linear-gradient(180deg,#ffffff_0%,#f6f9fc_55%,#eef4fa_100%)]">
      {/* 上方：悬浮的推荐路线气泡 */}
      <div className="relative min-h-0 flex-1">
        <div className="absolute left-1/2 top-10 w-full -translate-x-1/2 text-center">
          <h1 className="text-[26px] font-bold tracking-tight text-slate-900">今天想去哪逛逛？</h1>
          <p className="mt-1.5 text-[12px] text-slate-500">
            点一个现成线路，或者直接在下面说一句话
          </p>
        </div>

        {DEMO_ROUTES.map((route, index) => {
          const style = bubbleStyle[index] ?? bubbleStyle[0]
          return (
            <button
              key={route.id}
              className="tc-bubble group absolute w-[300px] rounded-3xl border border-white/70 bg-white/85 px-5 py-4 text-left shadow-[0_18px_38px_-24px_rgba(15,23,42,.55)] backdrop-blur transition-colors hover:border-slate-300 hover:bg-white"
              style={
                {
                  left: style.left,
                  top: style.top,
                  animationDelay: style.delay,
                  '--tc-rotate': style.rotate,
                } as CSSProperties
              }
              onClick={() => loadDemo(route.id)}
              title={route.desc}
            >
              <div className="text-[15px] font-semibold text-slate-900">{route.name}</div>
              <div className="mt-1 line-clamp-2 text-[11.5px] leading-5 text-slate-500">
                {route.desc}
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-400">
                <span className="rounded-full bg-slate-100 px-2 py-0.5">{route.days} 天</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5">{route.poiNames.length} 个地点</span>
                <span className="ml-auto text-slate-500 group-hover:text-slate-900">载入 →</span>
              </div>
            </button>
          )
        })}

        {trips.length > 0 && (
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 text-[11px] text-slate-400">
            最近：
            {trips.slice(0, 3).map((trip) => (
              <button
                key={trip.id}
                className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-400"
                onClick={() => navigate(`/trip/${trip.id}`)}
              >
                {trip.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 底部：AI 输入框 */}
      <div className="shrink-0 px-6 pb-8 pt-2">
        <div className="mx-auto w-full max-w-[760px]">
          <div className="rounded-2xl border border-slate-300 bg-white p-3 shadow-[0_20px_44px_-30px_rgba(15,23,42,.6)]">
            <textarea
              rows={2}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) start()
              }}
              placeholder="告诉我你想怎么玩：去哪、几天、和谁、累不累…"
              className="w-full resize-none bg-transparent text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400"
            />
            <div className="mt-1 flex items-center justify-between">
              <div className="flex gap-1.5">
                {['2 天亲子', '少走路', '公交优先'].map((chip) => (
                  <button
                    key={chip}
                    className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 hover:bg-slate-200"
                    onClick={() => setPrompt((prev) => (prev ? `${prev}，${chip}` : chip))}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <button
                className="rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-slate-800 disabled:bg-slate-300"
                onClick={start}
                disabled={!prompt.trim()}
              >
                生成路书 →
              </button>
            </div>
          </div>
          <p className="mt-2 text-center text-[10px] text-slate-400">
            AI 会先标点、再问清细节，最后编译成一份带时间轴的路书 · 1.1
          </p>
        </div>
      </div>
    </div>
  )
}

