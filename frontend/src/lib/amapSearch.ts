/**
 * 目的地在线搜索：高德 JS API 的 AutoComplete（输入联想）+ PlaceSearch（详情）。
 *
 * 为什么要两个插件配合：
 *   AutoComplete 只负责「快速给出候选词」，返回的 tip 往往**没有完整详情**（有时连坐标都没有）；
 *   所以用户点选之后再调 PlaceSearch.getDetails(id) 拿完整 POI —— 坐标、地址、营业时间、评分。
 *
 * 解析逻辑是照着**真实返回结构**写的（用 Web 服务 Key 打过 restapi 的 /v3/place/text 核对）：
 *   type:     "风景名胜;风景名胜;风景名胜"（分号分级，和预置库的标签词完全不同）
 *   location: REST 是字符串 "121.49,31.23"，JS SDK 是对象 {lng,lat} —— 两种都兼容
 *   biz_ext.open_time:  "24小时营业" 或 []  ← 人话字符串，不是时间区间
 *   biz_ext.opentime2:  "周二至周日 09:00-17:00 最晚进入15:00，周一闭馆…" ← 时间窗要解析这个
 *
 * 降级：任何一步失败（没 Key、SDK 没就绪、超时、配额用尽、接口报错）都回退到本地预置 POI，
 * 并把原因通过 notice 交给 UI 显示 —— 绝不静默失败。
 */
import { searchLocalPois, SHANGHAI_POIS } from '@/data/shanghaiPois'
import { loadAMap } from '@/lib/amap'
import { coordsFrom, parseClosedWeekdays, parseOpenHours, tagsFromType } from '@/lib/amapParse'
import { getAMap } from '@/lib/mapInstance'

let searchCity = '上海'

/** 切城市时调用：重置 AutoComplete 实例，让在线搜索按新城市过滤 */
export function setSearchCity(cityName: string) {
  searchCity = cityName
  autoCompleteRef = null
}
/** 在线搜索的超时保护：高德的回调在断网时可能永远不回来 */
const SEARCH_TIMEOUT_MS = 6000
const ONLINE_LIMIT = 8
const LOCAL_LIMIT = 5

export interface PlaceSuggestion {
  /** 列表 key：在线用高德 poi id，本地用名字 */
  key: string
  name: string
  district?: string
  address?: string
  lng?: number
  lat?: number
  tags: string[]
  openTime?: string
  closeTime?: string
  /** 高德营业时间原始文案（界面展示，含"周一闭馆"这类说明） */
  hoursRaw?: string
  /** 每周固定全天关闭的日子，1=周一…7=周日。只用于界面提示 */
  closedWeekdays?: number[]
  /** 建议停留分钟数（在线结果默认 60，本地库带自己的建议值） */
  stayMin: number
  origin: 'amap' | 'local'
  /** 高德 POI id：点选后用它拉完整详情 */
  amapId?: string
  rating?: string
}

export interface SearchOutcome {
  items: PlaceSuggestion[]
  /** 是否降级到了本地库 */
  degraded: boolean
  /** 给用户看的说明（降级原因 / 在线无结果等） */
  notice?: string
}

/** 给高德 SDK 的回调套一层 Promise + 超时 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms / 1000}s）`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

async function ensureAMap(): Promise<any | null> {
  const existing = getAMap()
  if (existing) return existing
  try {
    return await loadAMap()
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* 字段解析：纯函数放在 amapParse.ts，方便单独测（见 README 的验证记录）  */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 在线搜索                                                            */
/* ------------------------------------------------------------------ */

let autoCompleteRef: any = null
let placeSearchRef: any = null

function autoCompleteSearch(AMap: any, keyword: string, limit: number): Promise<any[]> {
  if (!autoCompleteRef) {
    autoCompleteRef = new AMap.AutoComplete({
      city: searchCity,
      citylimit: true,
      // 只要 POI：默认的 'all' 会把公交线路也混进来，对旅行规划没有意义
      datatype: 'poi',
    })
  }
  return new Promise((resolve, reject) => {
    autoCompleteRef.search(keyword, (status: string, result: any) => {
      if (status === 'complete') resolve((result?.tips ?? []).slice(0, limit))
      else if (status === 'no_data') resolve([])
      else reject(new Error(result?.info || `AutoComplete ${status}`))
    })
  })
}

function placeDetail(AMap: any, poiId: string): Promise<any | null> {
  if (!placeSearchRef) {
    placeSearchRef = new AMap.PlaceSearch({
      city: searchCity,
      citylimit: true,
      extensions: 'all', // 必须 all 才有 biz_ext（营业时间/评分）
    })
  }
  return new Promise((resolve, reject) => {
    placeSearchRef.getDetails(poiId, (status: string, result: any) => {
      if (status !== 'complete') {
        reject(new Error(result?.info || `PlaceSearch.getDetails ${status}`))
        return
      }
      resolve(result?.poiList?.pois?.[0] ?? null)
    })
  })
}

function tipToSuggestion(tip: any): PlaceSuggestion | null {
  const name = String(tip?.name ?? '').trim()
  if (!name) return null
  const coords = coordsFrom(tip?.location)
  return {
    key: `amap:${tip?.id || name}`,
    name,
    district: tip?.district || tip?.adname,
    address: typeof tip?.address === 'string' ? tip.address : undefined,
    lng: coords?.lng,
    lat: coords?.lat,
    tags: tagsFromType(tip?.typecode || tip?.type),
    stayMin: 60,
    origin: 'amap',
    amapId: tip?.id,
  }
}

function localSuggestions(keyword: string, limit = LOCAL_LIMIT): PlaceSuggestion[] {
  return searchLocalPois(keyword, limit).map((poi) => ({
    key: `local:${poi.name}`,
    name: poi.name,
    district: poi.district,
    tags: poi.tags,
    openTime: poi.openTime,
    closeTime: poi.closeTime,
    // 预置库里的营业时间文案与闭馆日是高德快照离线算好的，直接用
    hoursRaw: poi.hoursRaw,
    closedWeekdays: poi.closedWeekdays,
    lng: poi.lng,
    lat: poi.lat,
    stayMin: poi.stayMin,
    origin: 'local' as const,
  }))
}

/**
 * 搜索目的地。
 * 在线优先；在线失败或没结果时自动补上本地预置库的结果，并通过 notice 说明情况。
 */
export async function searchPlaces(keyword: string, limit = ONLINE_LIMIT): Promise<SearchOutcome> {
  const kw = keyword.trim()
  if (!kw) return { items: [], degraded: false }

  const local = localSuggestions(kw)
  const AMap = await ensureAMap()
  if (!AMap) {
    return {
      items: local,
      degraded: true,
      notice: `地图未就绪（未配置高德 JS Key？），已回退到本地 ${SHANGHAI_POIS.length} 个预置 POI`,
    }
  }

  try {
    const tips = await withTimeout(autoCompleteSearch(AMap, kw, limit), SEARCH_TIMEOUT_MS, '在线搜索')
    const online = tips
      .map(tipToSuggestion)
      .filter((item): item is PlaceSuggestion => item !== null)

    if (!online.length) {
      return {
        items: local,
        degraded: false,
        notice: local.length
          ? `高德没有匹配「${kw}」的地点，下面是本地预置库的结果`
          : `高德没有匹配「${kw}」的地点`,
      }
    }

    // 在线结果在前，本地预置库里不重名的补在后面（本地带营业时间与建议停留，仍然有用）
    const onlineNames = new Set(online.map((item) => item.name))
    return {
      items: [...online, ...local.filter((item) => !onlineNames.has(item.name))],
      degraded: false,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return {
      items: local,
      degraded: true,
      notice: `在线搜索失败（${reason}），已回退到本地 ${SHANGHAI_POIS.length} 个预置 POI`,
    }
  }
}

/**
 * 点选某条候选后补齐完整信息（坐标 / 地址 / 营业时间 / 评分）。
 * 在线候选一律走这里：AutoComplete 的 tip 常常没有营业时间，而营业时间会直接进求解器的时间窗约束。
 */
export async function resolveSuggestion(suggestion: PlaceSuggestion): Promise<PlaceSuggestion> {
  if (suggestion.origin === 'local') return suggestion
  if (!suggestion.amapId) return suggestion

  const AMap = await ensureAMap()
  if (!AMap) return suggestion

  try {
    const poi = await withTimeout(
      placeDetail(AMap, suggestion.amapId),
      SEARCH_TIMEOUT_MS,
      '地点详情',
    )
    if (!poi) return suggestion

    const coords = coordsFrom(poi.location) ?? { lng: suggestion.lng, lat: suggestion.lat }
    const hours = parseOpenHours(poi.biz_ext)
    return {
      ...suggestion,
      name: String(poi.name ?? suggestion.name),
      lng: coords?.lng,
      lat: coords?.lat,
      address: typeof poi.address === 'string' ? poi.address : suggestion.address,
      district: poi.adname || suggestion.district,
      tags: tagsFromType(poi.type).length ? tagsFromType(poi.type) : suggestion.tags,
      openTime: hours.openTime,
      closeTime: hours.closeTime,
      hoursRaw: hours.raw ?? suggestion.hoursRaw,
      // 「周一闭馆」这类星期信息只作界面提示，不进求解器（我们的模型没有星期维度）
      closedWeekdays: parseClosedWeekdays(hours.raw),
      rating: typeof poi.biz_ext?.rating === 'string' ? poi.biz_ext.rating : undefined,
    }
  } catch {
    // 详情拉不到就退回 tip 自带的信息（tip 通常有坐标），不打断用户操作
    return suggestion
  }
}

/** 供 UI 显示的来源标签 */
export function originLabel(origin: PlaceSuggestion['origin']): string {
  return origin === 'amap' ? '在线' : '本地'
}

