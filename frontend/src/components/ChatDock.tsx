import { useEffect, useRef, useState } from 'react'

export interface ChatMessage {
  id: string
  role: 'user' | 'ai'
  text: string
  /** 小字补充，如「大模型解析」 */
  meta?: string
  /** 提案里"准备改什么"的短列表 */
  preview?: string[]
  /** 执行后的一行变更回执（很小的字） */
  caption?: string
  /** 需要用户确认的提案 */
  pending?: boolean
  /** 提案的执行参数（点「确认执行」时提交），随消息一起持久化 */
  ops?: Record<string, unknown>
  /** 已经点过确认/取消 */
  resolved?: 'confirmed' | 'cancelled'
  /** 追问时的可点选项 */
  options?: string[]
}

interface Props {
  messages: ChatMessage[]
  busy: boolean
  onSend: (text: string) => void
  onConfirm?: (id: string) => void
  onCancel?: (id: string) => void
  examples?: string[]
  hint?: string
}

/** 输入框自动长高的最大行数，超过后在框内滚动 */
const MAX_INPUT_LINES = 5

/** 左栏常驻的 AI 助手：消息在上，输入框钉底 */
export default function ChatDock({
  messages,
  busy,
  onSend,
  onConfirm,
  onCancel,
  examples = [],
  hint,
}: Props) {
  const [text, setText] = useState('')
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = scrollerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  // 输入框随内容自动长高（最多 MAX_INPUT_LINES 行），内容变短时自动缩回
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const cs = window.getComputedStyle(el)
    const lineHeight = parseFloat(cs.lineHeight) || 16
    const padTop = parseFloat(cs.paddingTop) || 0
    const padBottom = parseFloat(cs.paddingBottom) || 0
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
    const minH = lineHeight + padTop + padBottom + border
    const maxH = MAX_INPUT_LINES * lineHeight + padTop + padBottom + border
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight + border, minH), maxH)}px`
  }, [text])

  function submit() {
    const value = text.trim()
    if (!value || busy) return
    onSend(value)
    setText('')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-2">
        <span className="text-[12px] font-semibold text-slate-800">AI 路书助手</span>
        <span className="text-[10px] text-slate-400">
          {busy ? '思考中…' : hint ?? '先说想法，确认后我才改'}
        </span>
      </div>

      <div ref={scrollerRef} className="tc-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">
            说说你想怎么玩：去哪、几天、和谁、累不累。
            <br />
            我会先把方案说清楚，你点头之后才改路书。
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id}>
            <div className={`flex gap-2 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${
                  message.role === 'ai' ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-600'
                }`}
              >
                {message.role === 'ai' ? 'AI' : '我'}
              </span>

              <div className="min-w-0 max-w-[86%] space-y-1">
                <div
                  className={`rounded-xl px-2.5 py-1.5 text-[12px] leading-5 ${
                    message.role === 'ai'
                      ? 'border border-slate-200 bg-white text-slate-700'
                      : 'bg-slate-100 text-slate-800'
                  }`}
                >
                  <span className="whitespace-pre-wrap">{message.text}</span>
                </div>

                {/* 提案：准备改什么 */}
                {message.preview && message.preview.length > 0 && (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-2.5 py-1.5">
                    <div className="text-[10px] font-medium text-slate-500">准备这样改</div>
                    <ul className="mt-0.5 space-y-0.5">
                      {message.preview.map((item) => (
                        <li key={item} className="text-[11px] leading-4 text-slate-600">
                          · {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 确认 / 取消 */}
                {message.pending && !message.resolved && (
                  <div className="flex items-center gap-1.5">
                    <button
                      className="rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-800 disabled:bg-slate-300"
                      disabled={busy}
                      onClick={() => onConfirm?.(message.id)}
                    >
                      确认执行
                    </button>
                    <button
                      className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => onCancel?.(message.id)}
                    >
                      换个说法
                    </button>
                  </div>
                )}

                {/* 执行后的变更回执：很小的字 */}
                {message.caption && (
                  <div className="flex items-center gap-1 pl-0.5 text-[10px] text-slate-400">
                    <span className="text-emerald-500">✓</span>
                    <span>{message.caption}</span>
                  </div>
                )}
                {message.resolved === 'cancelled' && (
                  <div className="pl-0.5 text-[10px] text-slate-300">已取消，没有改动</div>
                )}

                {/* 追问的可点选项 */}
                {message.options && message.options.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {message.options.map((option) => (
                      <button
                        key={option}
                        className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600 hover:border-slate-400 disabled:opacity-50"
                        disabled={busy}
                        onClick={() => onSend(option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}

                {message.meta && <div className="pl-0.5 text-[10px] text-slate-400">{message.meta}</div>}
              </div>
            </div>
          </div>
        ))}

        {busy && <div className="pl-7 text-[11px] text-slate-400">AI 正在整理…</div>}
      </div>

      {examples.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1 px-3 pb-1">
          {examples.map((example) => (
            <button
              key={example}
              className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500 hover:border-slate-400 hover:text-slate-700 disabled:opacity-50"
              onClick={() => onSend(example)}
              disabled={busy}
              title={example}
            >
              {example}
            </button>
          ))}
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2 border-t border-slate-100 p-2">
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Enter 直接发送；Shift+Enter 换行；中文输入法选字回车不触发发送
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder="继续说，例如：把外滩去掉、改成地铁"
          className="min-w-0 flex-1 resize-none overflow-y-auto rounded-lg border border-slate-300 px-2.5 py-2 text-xs outline-none placeholder:text-slate-400 focus:border-slate-800"
        />
        <button
          className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:bg-slate-300"
          onClick={submit}
          disabled={busy || !text.trim()}
        >
          发送
        </button>
      </div>
    </div>
  )
}
