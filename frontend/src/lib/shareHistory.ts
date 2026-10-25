/** 分享记录（本地）：用于"我分享过的口令"列表，配合路线库展示。 */
export interface ShareRecord {
  code: string
  title: string
  at: string
}

const KEY = 'tripcompiler:shares'

export function loadShares(): ShareRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as ShareRecord[]) : []
    return Array.isArray(list) ? list.slice(0, 20) : []
  } catch {
    return []
  }
}

export function recordShare(code: string, title: string): void {
  try {
    const list = loadShares().filter((item) => item.code !== code)
    list.unshift({ code, title, at: new Date().toISOString() })
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20)))
  } catch {
    // 本地存储满/被禁用时静默忽略，不影响分享本身
  }
}
