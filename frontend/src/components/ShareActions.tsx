import { useState } from 'react'
import { shareTrip } from '@/api/client'
import { recordShare } from '@/lib/shareHistory'
import { snapshotTrip, useTripStore } from '@/store/useTripStore'
import ImportDialog from './ImportDialog'
import Modal from './Modal'

/** 分享图标：三个节点连成的分享关系 */
function ShareIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="18" cy="5" r="2.6" />
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="19" r="2.6" />
      <path d="M8.4 10.7 15.6 6.6" />
      <path d="M8.4 13.3 15.6 17.4" />
    </svg>
  )
}

/** 导入图标：下载箭头 */
function ImportIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v11" />
      <path d="M7.5 9.5 12 14l4.5-4.5" />
      <path d="M4.5 20h15" />
    </svg>
  )
}

/**
 * 顶部「分享行程 / 导入行程」。
 * 分享：把当前行程快照换成 6 位口令；导入：用口令还原。
 */
export default function ShareActions() {
  const [shareOpen, setShareOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [copied, setCopied] = useState(false)
  const showToast = useTripStore((s) => s.showToast)

  async function openShare() {
    setShareOpen(true)
    setCode(null)
    setCopied(false)
    setSharing(true)
    try {
      const state = useTripStore.getState()
      const trip = snapshotTrip(state)
      const result = await shareTrip(trip)
      setCode(result.code)
      const title =
        state.trips.find((item) => item.id === state.activeTripId)?.title ??
        `${state.hotel.name.replace(/ · .*$/, '')} · ${state.days} 天`
      recordShare(result.code, title)
    } catch {
      setShareOpen(false)
      showToast('error', '生成口令失败，请确认后端已启动')
    } finally {
      setSharing(false)
    }
  }

  async function copyCode() {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      showToast('success', '口令已复制到剪贴板')
    } catch {
      // 非 https / 老浏览器的兜底
      const textarea = document.createElement('textarea')
      textarea.value = code
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(textarea)
      if (ok) {
        setCopied(true)
        showToast('success', '口令已复制到剪贴板')
      } else {
        showToast('error', '复制失败，请手动选中口令复制')
      }
    }
  }

  const buttonClass =
    'flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50'

  return (
    <>
      <div className="flex items-center gap-1.5">
        <button type="button" className={buttonClass} onClick={() => void openShare()} title="把当前行程生成 6 位口令">
          <ShareIcon />
          分享行程
        </button>
        <button type="button" className={buttonClass} onClick={() => setImportOpen(true)} title="输入口令还原别人的行程">
          <ImportIcon />
          导入行程
        </button>
      </div>

      <Modal
        open={shareOpen}
        title="分享行程"
        desc="把这串口令发给队友，对方在「导入行程」里输入即可还原。"
        onClose={() => setShareOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600 transition-colors hover:bg-slate-50"
              onClick={() => setShareOpen(false)}
            >
              关闭
            </button>
            <button
              type="button"
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              onClick={() => void copyCode()}
              disabled={!code}
            >
              {copied ? '已复制' : '一键复制'}
            </button>
          </>
        }
      >
        {sharing && <p className="py-6 text-center text-sm text-slate-500">正在生成口令…</p>}

        {!sharing && code && (
          <>
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-6 text-center">
              <div className="font-mono text-3xl font-bold tracking-[0.3em] text-slate-900">
                {code}
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-slate-400">
              口令 24 小时内有效。导入后对方的酒店、目的地、交通方式、权重、时间设置都会还原，
              并自动重新编译路线。
            </p>
          </>
        )}

        {!sharing && !code && (
          <p className="py-6 text-center text-sm text-slate-500">没能生成口令，请稍后重试。</p>
        )}
      </Modal>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  )
}
