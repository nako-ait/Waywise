import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DEMO_ROUTES } from '@/data/demoRoutes'
import { SHANGHAI_POIS } from '@/data/shanghaiPois'
import { useTripStore, type NewDestinationInput } from '@/store/useTripStore'
import ImportDialog from '@/components/ImportDialog'

/** 首页：一句话起手 + 三条示例 + 最近路书 + 导入口令 */
export default function Home() {
  const navigate = useNavigate()
  const trips = useTripStore((s) => s.trips)
  const profile = useTripStore((s) => s.profile)
  const setPendingPrompt = useTripStore((s) => s.setPendingPrompt)
  const setHotel = useTripStore((s) => s.setHotel)
  const setMode = useTripStore((s) => s.setMode)
  const setDays = useTripStore((s) => s.setDays)
  const clearDestinations = useTripStore((s) => s.clearDestinations)
  const addDestinations = useTripStore((s) => s.addDestinations)
  const showToast = useTripStore((s) => s.showToast)

  const [prompt, setPrompt] = useState('')
  const [importOpen, setImportOpen] = useState(false)

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

  return (
    <div className="flex h-full flex-col bg-white">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-5">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-slate-900">路书编译师</span>
          <span className="text-[11px] text-slate-400">TripCompiler · 上海</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50"
            onClick={() => setImportOpen(true)}
          >
            导入行程
          </button>
          <button
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50"
            onClick={() => navigate('/me')}
          >
            {profile ? profile.nickname : '登录 / 我的'}
          </button>
          <button
            className="rounded-lg px-2.5 py-1.5 text-[11px] text-slate-400 hover:text-slate-700"
            onClick={() => navigate('/plan')}
          >
            手动规划 →
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto tc-scroll">
        <section className="mx-auto max-w-[820px] px-6 pb-10 pt-16 text-center">
          <h1 className="text-[32px] font-bold leading-tight tracking-tight text-slate-900">
            想去哪、玩几天、怎么玩？
          </h1>
          <p className="mx-auto mt-3 max-w-[560px] text-[13px] leading-6 text-slate-500">
            一句话说清楚。AI 会先把地点标到地图上，再和你确认天数、交通、节奏，
            最后编译成一份带时间轴的路书。
          </p>

          <div className="mx-auto mt-8 max-w-[680px] rounded-2xl border border-slate-300 bg-white p-4 text-left shadow-[0_18px_40px_-32px_rgba(15,23,42,.6)]">
            <textarea
              rows={2}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) start()
              }}
              placeholder="带爸妈玩两天，想去朱家角、七宝老街，别安排太累，住静安寺"
              className="w-full resize-none text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400"
            />
            <div className="mt-2 flex items-center justify-between">
              <div className="flex gap-1.5">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">解析地点</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">天数</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">少走路</span>
              </div>
              <button
                className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-300"
                onClick={start}
                disabled={!prompt.trim()}
              >
                生成路书 →
              </button>
            </div>
          </div>

          <div className="mt-4 text-[11px] text-slate-400">
            或者试试：
            <span className="ml-1 inline-flex gap-1.5">
              {DEMO_ROUTES.map((route) => (
                <button
                  key={route.id}
                  className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-400 hover:text-slate-900"
                  onClick={() => loadDemo(route.id)}
                  title={route.desc}
                >
                  {route.name}
                </button>
              ))}
            </span>
          </div>
        </section>

        {trips.length > 0 && (
          <section className="mx-auto max-w-[820px] px-6 pb-16">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-700">最近的路书</h2>
              <button className="text-[11px] text-slate-400 hover:text-slate-700" onClick={() => navigate('/me')}>
                全部 →
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {trips.slice(0, 3).map((trip) => (
                <button
                  key={trip.id}
                  className="rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors hover:border-slate-400"
                  onClick={() => navigate(`/trip/${trip.id}`)}
                >
                  <div className="truncate text-[12px] font-semibold text-slate-900">{trip.title}</div>
                  <div className="mt-1 text-[10px] text-slate-400">
                    {trip.snapshot.days ?? 1} 天 · {trip.snapshot.destinations.length} 个地点
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-300">{trip.group}</div>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="shrink-0 border-t border-slate-100 px-5 py-2 text-[10px] text-slate-300">
        路书编译师 1.1 · AI 规划 · 口令分享 · 上海
      </footer>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => navigate('/plan')}
      />
    </div>
  )
}
