import { useEffect } from 'react'
import { useTripStore } from '@/store/useTripStore'

/** 全局轻提示：分享/导入的结果都在这里冒一下，2.6 秒自动消失 */
export default function ToastHost() {
  const toast = useTripStore((s) => s.toast)
  const clearToast = useTripStore((s) => s.clearToast)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(clearToast, 2600)
    return () => window.clearTimeout(timer)
  }, [toast, clearToast])

  if (!toast) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4">
      <div
        className={`pointer-events-auto max-w-[92vw] rounded-lg px-3.5 py-2 text-xs font-medium shadow-panel ${
          toast.kind === 'success' ? 'bg-slate-900 text-white' : 'bg-red-600 text-white'
        }`}
        role="status"
      >
        {toast.text}
      </div>
    </div>
  )
}
