/**
 * DOM 小工具
 */

/** 转义 HTML，防止用户输入的店名把标记结构撑坏（XSS 兜底） */
export function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 往元素及其子元素上挂「阻止冒泡」监听，用于地图标记 */
export function blockPropagation(el: HTMLElement): void {
  const stop = (ev: Event) => {
    ev.stopPropagation()
  }
  el.addEventListener('click', stop)
  el.addEventListener('dblclick', stop)
  el.addEventListener('pointerdown', stop)
  el.addEventListener('mousedown', stop)
  el.addEventListener('touchstart', stop, { passive: true })
}
