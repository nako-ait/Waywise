/**
 * 地图地名标签的碰撞避让（纯函数，方便单测与在动画帧里反复调用）。
 *
 * 屏幕空间上的**贪心占位 + 上下翻转**：
 *   1) 按优先级从高到低排序（酒店 → 已选点按路线序号 → 候选点）；
 *   2) 每个标签先试默认位置（针头上方），被占了就试备选位置（针头下方）；
 *   3) 两个位置都放不下，才隐藏这个标签。
 *
 * 障碍物分两类：
 *   · 已占位的其他标签；
 *   · 别人的标记针头 / 酒店方块 / 路线上的时长徽标（obstacle.key !== 自己的 key）。
 *     自己的针头不算障碍 —— 标签本来就长在它上方。
 *
 * 为什么用贪心而不是力导向排布：标签只有几十个，贪心足够；
 * 而且「宁可少显示，也不要糊成一片」比挪来挪去更可读 —— 标记本身还在，点一下照样能看详情。
 */
export interface LabelRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface LabelCandidate {
  /** 唯一键（酒店用 'hotel'，目的地用 id） */
  key: string
  /** 数字越小越优先 */
  priority: number
  /** 默认位置（针头上方） */
  rect: LabelRect
  /** 备选位置（针头下方），放不下时才用 */
  fallbackRect?: LabelRect
}

export interface LabelObstacle {
  /** 该障碍物属于哪个标记（用于放行「自己的针头」）；不填表示对所有人都算障碍 */
  key?: string
  rect: LabelRect
}

export interface LabelLayoutOptions {
  /** 标签之间至少留出的间隙（像素） */
  padding?: number
  /** 不能压住的标记/徽标 */
  obstacles?: LabelObstacle[]
}

/** 标签最终落在哪：默认位置 / 翻到下方 / 隐藏 */
export type LabelPlacement = 'primary' | 'fallback' | 'hidden'

function overlaps(a: LabelRect, b: LabelRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function pad(rect: LabelRect, padding: number): LabelRect {
  return {
    left: rect.left - padding,
    top: rect.top - padding,
    right: rect.right + padding,
    bottom: rect.bottom + padding,
  }
}

/**
 * @returns key -> 摆放方式
 */
export function layoutLabels(
  candidates: LabelCandidate[],
  options: LabelLayoutOptions = {},
): Map<string, LabelPlacement> {
  const padding = options.padding ?? 3
  const obstacles = options.obstacles ?? []
  const placement = new Map<string, LabelPlacement>()
  const taken: LabelRect[] = []

  const free = (rect: LabelRect, key: string): boolean => {
    const padded = pad(rect, padding)
    if (taken.some((occupied) => overlaps(occupied, padded))) return false
    return !obstacles.some(
      (obstacle) => obstacle.key !== key && overlaps(pad(obstacle.rect, 1), padded),
    )
  }

  // 优先级相同时按从左到右排，保证结果稳定（不会在两帧之间闪烁互换）
  const sorted = [...candidates].sort(
    (a, b) => a.priority - b.priority || a.rect.left - b.rect.left || a.rect.top - b.rect.top,
  )

  for (const item of sorted) {
    if (free(item.rect, item.key)) {
      taken.push(pad(item.rect, padding))
      placement.set(item.key, 'primary')
      continue
    }
    if (item.fallbackRect && free(item.fallbackRect, item.key)) {
      taken.push(pad(item.fallbackRect, padding))
      placement.set(item.key, 'fallback')
      continue
    }
    placement.set(item.key, 'hidden')
  }
  return placement
}
