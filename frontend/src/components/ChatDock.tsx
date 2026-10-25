import { useEffect, useRef, useState } from 'react'

export interface ChatMessage {
  id: string
  role: 'user' | 'ai'
  text: string
  /** 小字补充，如「已标点 3 个地点 · 规则解析」 */
  meta?: string
}

interface Props {
  messages: ChatMessage[]
  busy: boolean
  onSend: (text: string) => void
  examples?: string[]
  /** 底部提示，比如「还差 2 个问题就会编译」 */
  hint?: string
}

/** 左下角常驻的 AI 对话框：消息在上一屏，输入框钉在底部 */
export default function ChatDock({ messages, busy, onSend, examples = [], hint }: Props) {
  const [text, setText] = useState('')
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = scrollerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  function submit() {
    const value = text.trim()
    if (!value || busy) return
    onSend(value)
    setText('')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-slate-200 bg-white">
      <div className="flex shrink-0 items-center justify-between px-3 py-1.5">
        <span className="text-[12px] font-semibold text-slate-800">AI 路书助手</span>
        <span className="text-[10px] text-slate-400">{busy ? '思考中…' : hint ?? '多轮对话，随时改'}</span>
      </div>

      <div ref={scrollerRef} className="tc-scroll min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-1">
        {messages.length === 0 && (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">
            说说你想怎么玩：去哪、几天、和谁、累不累。
            <br />
            我会先把地点标到地图上，等细节聊清楚再编译整份路书。
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-2 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${
                message.role === 'ai' ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-600'
              }`}
            >
              {message.role === 'ai' ? 'AI' : '我'}
            </span>
            <div
              className={`max-w-[86%] rounded-xl px-2.5 py-1.5 text-[12px] leading-5 ${
                message.role === 'ai'
                  ? 'bg-white border border-slate-200 text-slate-700'
                  : 'bg-slate-100 text-slate-800'
              }`}
            >
              <span className="whitespace-pre-wrap">{message.text}</span>
              {message.meta && (
                <div className="mt-1 text-[10px] text-slate-400">{message.meta}</div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="pl-7 text-[11px] text-slate-400">AI 正在解析…</div>}
      </div>

      {examples.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1 px-3 py-1">
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
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
          placeholder="继续说，例如：2 天，用地铁，别太累"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-2 text-xs outline-none placeholder:text-slate-400 focus:border-slate-800"
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
