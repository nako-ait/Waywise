/**
 * 高德搜索结果的字段解析（纯函数，零依赖，方便单独测）。
 *
 * 这些规则是照着**真实返回结构**写的 —— 写之前先用 Web 服务 Key 打过
 * `restapi.amap.com/v3/place/text`，确认了字段长什么样：
 *   type:     "风景名胜;风景名胜;风景名胜"（分号分级，和预置库的中文标签词完全不同）
 *   location: REST 是字符串 "121.492127,31.233516"，JS SDK 是对象 {lng,lat}
 *   biz_ext.open_time: "24小时营业" 或 []      ← 人话字符串，不是时间区间
 *   biz_ext.opentime2: "周二至周日 09:00-17:00 最晚进入15:00，周一闭馆…" ← 时间窗要解析这个
 */

/** "风景名胜;风景名胜;风景名胜" → ["风景名胜"]（去重、限量） */
export function tagsFromType(type: unknown): string[] {
  const raw = Array.isArray(type) ? type.join(';') : typeof type === 'string' ? type : ''
  return [...new Set(raw.split(';').map((tag) => tag.trim()).filter(Boolean))].slice(0, 4)
}

/** 坐标既可能是 "lng,lat" 字符串（REST），也可能是 {lng,lat} / AMap.LngLat 对象（JS SDK） */
export function coordsFrom(location: unknown): { lng: number; lat: number } | null {
  if (!location) return null

  if (typeof location === 'string') {
    const [lngText, latText] = location.split(',')
    const lng = Number(lngText)
    const lat = Number(latText)
    return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null
  }

  const candidate = location as {
    lng?: unknown
    lat?: unknown
    getLng?: () => number
    getLat?: () => number
  }
  const lng = typeof candidate.getLng === 'function' ? candidate.getLng() : Number(candidate.lng)
  const lat = typeof candidate.getLat === 'function' ? candidate.getLat() : Number(candidate.lat)
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null
}

export interface ParsedHours {
  openTime?: string
  closeTime?: string
  /** 原始文案，用于界面展示（例如「24小时营业」「周一闭馆」这类说明） */
  raw?: string
}

/**
 * 从营业时间文案里析出「每周固定哪天全天关闭」。
 *
 * ⚠️ **只用于界面提示，绝不进求解器** —— 我们的时间窗模型没有星期维度。
 *
 * 规则与后端 `refresh_poi_snapshot.py::parse_closed_weekdays` 保持一致
 * （两边都实现了是因为：预置库的闭馆日是 Python 离线算好存进数据的，
 *   而在线搜索结果是浏览器里现算的，不能为了这点事再跑一趟后端）。
 *
 * 严格准入，宁可漏报也不误报 —— 误报会让界面显示错误的"今天闭馆"：
 *   · 规则 A（主）：紧邻的「周X + 闭馆词」，「（周一闭馆）」这种写法也能命中
 *   · 规则 B：「周X至周Y」只在**不含时间区间**的分句里才算闭馆
 *     （否则「周一至周日 09:00-17:00 开放」会被误判成整周闭馆）
 *   · 跳过含"上午/下午/暂停/提前"的半天情况与「08-09至08-10」这类具体日期
 */
const WEEKDAY_CHARS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
}
const DATE_SPECIFIC_RE = /(\d{1,2}月\d{1,2}日|\d{1,2}月至\d{1,2}月|\d{2}-\d{2}\s*至)/
const TIME_RANGE_RE = /(\d{1,2}):(\d{2})\s*[-–—－~～至]\s*(\d{1,2}):(\d{2})/
const CLOSURE_WORD_RE = /全天关闭|闭馆|不开放|停业|不营业/
// ⚠️ 必须**逐个星期往后看**，不能用消费式正则：
//    `周([一二三四五六日天])[^；;。]{0,8}?(?:闭馆|…)` 会把「周一,周日 全天关闭」
//    整段一次吃掉，只命中第一个「周一」，周日就丢了（这个回归真出现过）。
const WEEKDAY_RE = /周([一二三四五六日天])/g
const ADJACENT_CLOSURE_TAIL_RE = /^[^；;。]{0,8}?(?:全天关闭|闭馆|全天不开放|不开放|停业|不营业)/
const RANGE_RE = /周([一二三四五六日天])\s*至\s*周?([一二三四五六日天])/g

export function parseClosedWeekdays(text?: string | null): number[] {
  if (!text) return []
  const closed = new Set<number>()

  for (const segment of text.split(/[；;。]/)) {
    if (!CLOSURE_WORD_RE.test(segment)) continue
    if (/上午|下午|暂停|提前/.test(segment)) continue
    if (DATE_SPECIFIC_RE.test(segment)) continue

    const days = new Set<number>()

    // 规则 A（主）：紧邻的「周X + 闭馆词」。逐个字看后面的一小段，
    // 不受"含时间区间"限制 ——「（周一闭馆，法定节假日除外）」就是跟在开放时间后面的。
    for (const match of segment.matchAll(WEEKDAY_RE)) {
      const start = (match.index ?? 0) + match[0].length
      const tail = segment.slice(start, start + 12)
      if (ADJACENT_CLOSURE_TAIL_RE.test(tail)) {
        const day = WEEKDAY_CHARS[match[1]]
        if (day) days.add(day)
      }
    }

    // 规则 B
    if (!TIME_RANGE_RE.test(segment)) {
      for (const match of segment.matchAll(RANGE_RE)) {
        const start = WEEKDAY_CHARS[match[1]]
        const end = WEEKDAY_CHARS[match[2]]
        if (start === 1 && end === 7) continue // 「周一至周日」是全周，不是闭馆
        if (start && end && start <= end) {
          for (let day = start; day <= end; day += 1) days.add(day)
        }
      }
    }

    if (days.size === 7) continue // 兜底：全周闭馆不可能是"每周规律"
    for (const day of days) closed.add(day)
  }

  return [...closed].sort((a, b) => a - b)
}

/** 今天是不是闭馆日（1=周一…7=周日；JS 的 getDay() 里 0 是周日） */
export function isClosedToday(weekdays?: number[] | null, date: Date = new Date()): boolean {
  if (!weekdays?.length) return false
  const jsDay = date.getDay()
  const ours = jsDay === 0 ? 7 : jsDay
  return weekdays.includes(ours)
}

/** 「周一 / 周三」这样的中文说明，用于界面提示 */
export function formatClosedWeekdays(weekdays?: number[] | null): string {
  if (!weekdays?.length) return ''
  const chars = '一二三四五六日'
  return weekdays.map((day) => `周${chars[day - 1] ?? '?'}`).join(' / ')
}

/**
 * 从 biz_ext 解析营业时间。
 *
 * 解析不出、或判断为全天营业时返回空时段 —— **空 = 求解器不加时间窗约束**，
 * 这是安全的默认值：宁可不管，也不要用一个错的关门时间把景点排掉。
 */
export function parseOpenHours(bizExt: unknown): ParsedHours {
  if (!bizExt || typeof bizExt !== 'object') return {}
  const ext = bizExt as Record<string, unknown>

  const texts: string[] = []
  for (const candidate of [ext.opentime2, ext.open_time]) {
    const text = (Array.isArray(candidate) ? candidate.join(' ') : String(candidate ?? '')).trim()
    if (text && text !== '[]') texts.push(text)
  }
  if (!texts.length) return {}

  const joined = texts.join('；')

  // ⚠️ 顺序很重要（踩过坑）：**先找时间区间**。
  //    高德文案里常混着「全天关闭」这种句子，"全天"两个字的含义可能是"全天不开放"；
  //    反过来先匹配"全天"，就会把「周一,周日 全天关闭；周二至周六 09:00-16:00」
  //    错判成"全天营业"（徐家汇天主教堂、长风海洋世界都栽在这上面）。
  const match = joined.match(TIME_RANGE_RE)
  if (match) {
    const openTime = `${match[1].padStart(2, '0')}:${match[2]}`
    const closeRaw = `${match[3].padStart(2, '0')}:${match[4]}`
    // 高德会写 24:00，而我们的时间模型只接受 00:00~23:59
    const closeTime = closeRaw === '24:00' ? '23:59' : closeRaw
    return { openTime, closeTime, raw: joined.slice(0, 200) }
  }

  if (/24\s*小时|全天/.test(joined) && !/关闭|闭馆|不开放|停业/.test(joined)) {
    return { raw: joined.slice(0, 200) } // 全天营业 → 不加时间窗约束
  }

  return { raw: joined.slice(0, 200) } // 有文案但解析不出时段 → 只作界面提示
}
