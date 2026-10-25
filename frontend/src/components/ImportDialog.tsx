import { useState } from 'react'
import { ApiError, fetchSharedTrip } from '@/api/client'
import { usePlanController } from '@/hooks/usePlanController'
import { useTripStore } from '@/store/useTripStore'
import Modal from './Modal'

interface Props {
  open: boolean
  onClose: () => void
  /** 导入成功后的回调（首页用它跳到工作台） */
  onImported?: () => void
}

/** 导入行程：输入 6 位口令 → 拉取 → 覆盖当前状态 → 自动重算 */
export default function ImportDialog({ open, onClose, onImported }: Props) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const setFullTripState = useTripStore((s) => s.setFullTripState)
  const showToast = useTripStore((s) => s.showToast)
  const { run } = usePlanController()

  function close() {
    if (busy) return
    setCode('')
    onClose()
  }

  async function handleImport() {
    const value = code.trim().toUpperCase()
    if (value.length !== 6) {
      showToast('error', '请输入 6 位行程口令')
      return
    }
    setBusy(true)
    try {
      const trip = await fetchSharedTrip(value)
      setFullTripState(trip)
      setCode('')
      onClose()
      onImported?.()

      const picked = useTripStore.getState().destinations.filter((d) => d.selected).length
      if (picked === 0) {
        showToast('success', '行程已导入（这份行程没有选中的目的地）')
        return
      }

      showToast('success', '行程已导入，正在重算路线…')
      await run()
      const error = useTripStore.getState().planError
      showToast(
        error ? 'error' : 'success',
        error ?? `行程已还原，${picked} 个地点已重新编译`,
      )
    } catch (err) {
      const notFound = err instanceof ApiError && err.status === 404
      showToast('error', notFound ? '口令无效，请检查后重试' : '导入失败，请检查网络后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="导入行程"
      desc="输入对方给你的 6 位口令，把那份行程搬到当前页面。"
      onClose={close}
      footer={
        <>
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
            onClick={close}
            disabled={busy}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            onClick={() => void handleImport()}
            disabled={busy || code.trim().length !== 6}
          >
            {busy ? '导入中…' : '确认导入'}
          </button>
        </>
      }
    >
      <input
        autoFocus
        value={code}
        onChange={(event) => {
          const next = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
          setCode(next)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void handleImport()
        }}
        placeholder="例如 A8F2K9"
        autoComplete="off"
        spellCheck={false}
        inputMode="text"
        className="w-full rounded-xl border border-slate-300 px-3 py-3 text-center font-mono text-2xl font-semibold uppercase tracking-[0.35em] text-slate-900 outline-none transition-colors placeholder:text-sm placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-300 focus:border-slate-800"
      />
      <p className="mt-2 text-[11px] leading-5 text-slate-400">
        口令 24 小时内有效。导入会覆盖当前页面的酒店、目的地、交通方式与权重，之后会自动重算路线。
      </p>
    </Modal>
  )
}
