/** 生成本地唯一 id（无需引入 nanoid 依赖） */
export function uid(prefix = 'd'): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}_${rand}`
}
