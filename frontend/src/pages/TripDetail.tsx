import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import MapView from '@/components/MapView'
import ShareActions from '@/components/ShareActions'
import TimelineVertical from '@/components/TimelineVertical'
import { exportTripLongImage } from '@/lib/longImage'
import { useTripStore } from '@/store/useTripStore'

/** 路书详情：成稿视图（地图 + 竖排路书），可分享、导出长图、继续编辑 */
export default function TripDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const trips = useTripStore((s) => s.trips)
  const openTrip = useTripStore((s) => s.openTrip)
  const plan = useTripStore((s) => s.plan)
  const hotel = useTripStore((s) => s.hotel)
  const showToast = useTripStore((s) => s.showToast)

  const record = trips.find((trip) => trip.id === id)

  useEffect(() => {
    if (id) openTrip(id)
  }, [id, openTrip])

  if (!record) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-white">
        <p className="text-sm text-slate-500">这份路书不存在（可能已被删除）</p>
        <button className="rounded-lg bg-slate-900 px-4 py-2 text-xs text-white" onClick={() => navigate('/')}>
          回首页
        </button>
      </div>
    )
  }

  function handleExport() {
    if (!plan) {
      showToast('error', '这份路书还没有编译结果，先去工作台编译一次')
      return
    }
    exportTripLongImage({ title: record?.title, hotel, plan })
    showToast('success', '长图已导出（浏览器下载里）')
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 px-4">
        <button className="text-[11px] text-slate-400 hover:text-slate-700" onClick={() => navigate('/')}>
          ← 首页
        </button>
        <span className="text-sm font-semibold text-slate-900">{record.title}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{record.group}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50"
            onClick={handleExport}
          >
            导出长图
          </button>
          <button
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50"
            onClick={() => navigate('/plan')}
          >
            继续编辑
          </button>
          <ShareActions />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="relative min-w-0 flex-1">
          <MapView />
        </section>
        <aside className="w-[360px] shrink-0 border-l border-slate-200 bg-white">
          <TimelineVertical readOnly />
        </aside>
      </div>
    </div>
  )
}
