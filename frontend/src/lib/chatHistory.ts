/**
 * 工作台 AI 对话的本地持久化：按「路书」分开存档，刷新 / 离开页面后各自恢复、互不串台。
 *
 * 存储结构：{ [路书id | 'draft']: ChatMessage[] }
 *   - 已保存的路书用它的 id 存档；
 *   - 未保存的新会话用草稿槽 'draft'；
 *   - 兼容旧格式：如果读到的还是单个数组（上一版），视作草稿会话。
 */
import type { ChatMessage } from '@/components/ChatDock'

const KEY = 'tripcompiler:chat:v1'
export const DRAFT_CHAT_KEY = 'draft'
const MAX_MESSAGES = 60

type ChatStore = Record<string, ChatMessage[]>

function readAll(): ChatStore {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return { [DRAFT_CHAT_KEY]: parsed }
    if (parsed && typeof parsed === 'object') return parsed as ChatStore
    return {}
  } catch {
    return {}
  }
}

function sanitize(list: unknown): ChatMessage[] {
  if (!Array.isArray(list)) return []
  return (list as ChatMessage[])
    .filter((m) => m && typeof m.id === 'string' && typeof m.text === 'string')
    .slice(-MAX_MESSAGES)
}

export function loadChatHistory(key: string): ChatMessage[] {
  return sanitize(readAll()[key])
}

export function saveChatHistory(key: string, messages: ChatMessage[]): void {
  try {
    const all = readAll()
    all[key] = sanitize(messages)
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // localStorage 满 / 隐私模式：静默失败，不影响对话本身
  }
}

export function clearChatHistory(key: string): void {
  try {
    const all = readAll()
    delete all[key]
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // 同上
  }
}
