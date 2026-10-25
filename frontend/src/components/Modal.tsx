import { useEffect, type ReactNode } from 'react'

/**
 * 极简弹窗：白底 + 圆角 + 阴影，与地图风格一致。
 * 点遮罩或按 Esc 关闭；不做动画库依赖（只用一个 CSS transition）。
 */
interface ModalProps {
  open: boolean
  title: string
  desc?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

export default function Modal({ open, title, desc, onClose, children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-[2px]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-[min(440px,92vw)] rounded-2xl border border-slate-200 bg-white p-5 shadow-panel"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {desc && <p className="mt-1 text-xs leading-5 text-slate-500">{desc}</p>}
          </div>
          <button
            className="shrink-0 rounded px-1 text-lg leading-none text-slate-300 transition-colors hover:text-slate-600"
            onClick={onClose}
            aria-label="关闭"
            type="button"
          >
            ×
          </button>
        </div>

        <div className="mt-4">{children}</div>

        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}
