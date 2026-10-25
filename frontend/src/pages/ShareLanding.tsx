import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchSharedTrip } from '@/api/client'
import MapView from '@/components/MapView'
import TimelineVertical from '@/components/TimelineVertical'
import { usePlanController } from '@/hooks/usePlanController'
import { useTripStore } from '@/store/useTripStore'

/** 分享落地页：只读展示别人分享的行程，可一键复制到我的路书 */
export default function ShareLanding() {
  const { code } = useParams()
  const navigate = useNavigate()
  const setFullTripState = useTripStore((s) => s.setFullTripState)
  const saveTrip = useTripStore((s) => s.saveTrip)
  const showToast = useTripStore((s) => s.showToast)
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [error, setError] = useState('')
  const { run } = usePlanController()

  useEffect(() => {
    if (!code) return
    let cancelled = false
    setStatus('loading')
    fetchSharedTrip(code)
      .then(async (trip) => {
        if (cancelled) return
        setFullTripState(trip)
        setStatus('ok')
        // 分享的是"输入态"，落地页也要把路线算出来给人看
        await run()
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '口令无效')
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [code, setFullTripState, run])

  function copyToMine() {
    const record = saveTrip(`来自口令 ${code} 的行程`)
    showToast('success', '已复制到我的路书')
    navigate(`/trip/${record.id}`)
  }

  if (status === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-white">
        <p className="text-sm font-medium text-slate-800">打不开这份分享</p>
        <p className="text-xs text-slate-500">{error}</p>
        <button className="rounded-lg bg-slate-900 px-4 py-2 text-xs text-white" onClick={() => navigate('/')}>
          回首页
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 px-4">
        <span className="text-sm font-semibold text-slate-900">别人分享的路书</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">口令 {code}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-800 disabled:bg-slate-300"
            onClick={copyToMine}
            disabled={status !== 'ok'}
          >
            复制到我的路书
          </button>
        </div>
      </header>

      {status === 'loading' ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-400">正在获取行程…</div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <section className="relative min-w-0 flex-1">
            <MapView />
          </section>
          <aside className="w-[360px] shrink-0 border-l border-slate-200 bg-white">
            <TimelineVertical readOnly />
          </aside>
        </div>
      )}
    </div>
  )
}

