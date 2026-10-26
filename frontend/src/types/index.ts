/**
 * 路书编译师 —— 全局核心数据结构
 * 与后端 app/models.py 中的 Pydantic 模型保持一致（字段名一一对应，便于联调）。
 *
 * ⚠️ 坐标约定：全项目统一使用 GCJ-02（火星坐标系 / 高德坐标系）。
 *    绝不要混入 WGS-84（GPS 原始）或 BD-09（百度）坐标，否则会出现 300~600m 偏移。
 */

/** 目的地来源，用于 UI 打标与埋点 */
export type DestinationSource = 'map-click' | 'search' | 'ai' | 'import'

/** 交通方式（P1 全部支持） */
export type TravelMode = 'walk' | 'transit' | 'subway' | 'taxi' | 'drive'

export const TRAVEL_MODE_LABEL: Record<TravelMode, string> = {
  walk: '步行',
  transit: '公交',
  subway: '地铁',
  taxi: '打车',
  drive: '驾车',
}

/** 目的地（候选点 / 选中点共用同一份数据，用 selected 区分） */
export interface Destination {
  id: string
  name: string
  /** 经度（GCJ-02） */
  lng: number
  /** 纬度（GCJ-02） */
  lat: number
  /** 是否被选中参与路线规划 */
  selected: boolean
  source: DestinationSource
  /** 建议停留时间（分钟） */
  stayMin?: number
  /** 营业开始时间 HH:mm */
  openTime?: string
  /** 营业结束时间 HH:mm */
  closeTime?: string
  tags?: string[]
  /** 高德逆地理/地点搜索返回的详细地址 */
  address?: string
  /** 在线搜索命中的高德 POI id（便于回头再拉详情/去重） */
  amapId?: string
  /** 高德营业时间原始文案（界面展示，含"周一闭馆"这类说明） */
  hoursRaw?: string
  /** 每周固定全天关闭的日子，1=周一…7=周日。**只用于界面提示，不进求解器** */
  closedWeekdays?: number[]
}

/** 酒店（固定起点，蓝色标记，不可取消） */
export interface Hotel {
  lng: number
  lat: number
  name: string
  address?: string
}

/** 用户可调权重（0~1 滑杆，后端归一化后使用） */
export interface Weights {
  time: number
  convenience: number
  cost: number
  walking: number
}

export const DEFAULT_WEIGHTS: Weights = {
  time: 0.6,
  convenience: 0.5,
  cost: 0.4,
  walking: 0.5,
}

/** 公交/地铁方案里的一段乘车 */
export interface TransitRide {
  kind: string
  line: string
  fullLine?: string
  fromStop: string
  toStop: string
  stops: number
  distanceKm: number
  durationMin: number
}

/** 一个完整的公交/地铁出行方案（高德 transits[] 里的一条） */
export interface TransitOption {
  durationMin: number
  cost: number
  walkKm: number
  distanceKm: number
  transfers: number
  /** 是否直达（只坐一条线，不换乘） */
  direct: boolean
  /** 可读线路链："步行 602m → 地铁8号线 → 地铁9号线" */
  label: string
  rides: TransitRide[]
}

/** 单段交通（前四个字段是后端契约的必需字段） */
export interface TransportLeg {
  mode: TravelMode | string
  durationMin: number
  cost: number
  distanceKm: number
  /** 该段里的步行里程（公里） */
  walkKm?: number
  /** 换乘次数（公交/地铁才有） */
  transfers?: number
  /** 折线是否为直线近似（离线估算时为 true） */
  approx?: boolean
  /** amap = 高德实时，offline = 离线估算 */
  dataSource?: string
  /** 公交/地铁的全部候选方案（最优在前，最多 3 条） */
  transitOptions?: TransitOption[] | null
  /** 当前采用方案的线路链摘要 */
  transitLabel?: string | null
}

/** 路线中的一站 */
export interface PlanStop {
  id: string
  name: string
  lng: number
  lat: number
  /** HH:mm */
  arriveTime: string
  /** HH:mm */
  leaveTime: string
  stayMin: number
  /** 从上一站到本站的交通；首站记录的是酒店→首站 */
  transportFromPrev: TransportLeg | null
  /** 这一站里包含的午餐时间（分钟），0 表示不含 */
  lunchMin?: number
}

export interface PlanDayStats {
  totalWalkKm: number
  totalTransitMin: number
  totalCost: number
}

export interface PlanDay {
  date: string
  stops: PlanStop[]
  stats: PlanDayStats
  /** 回到酒店的时刻 HH:mm */
  returnTime?: string | null
  /** 超出计划收工时间的分钟数 */
  overtimeMin?: number
  /** 「最后一站 → 酒店」这一段（时长/里程/费用），时间轴用它显示回程信息 */
  returnLeg?: TransportLeg | null
  /** 多日模式下的可读标题，如「第 2 天 · 江景」 */
  title?: string | null
  /** 本日折线（每段一条，长度 = 站点数 + 1） */
  polylines?: Array<Array<[number, number]>> | null
}

/** 后端求解元信息，用于在界面上显示「这份路书是怎么来的」 */
export interface PlanSolverMeta {
  name: string
  objectiveMinutes?: number
  dataSource: string
  elapsedMs?: number
  dropped?: Array<{ id: string; name: string; reason: string }>
  weights?: Weights
  mode?: string
  modeLabel?: string
  visitedCount?: number
  requestedCount?: number
  warnings?: string[]
  cache?: { entries: number; recent: Array<{ key: string; ageMin: number }> }
  legsApprox?: number
  /** 多日：实际天数 / 请求天数 / 分天方式 / 全行程合计 */
  dayCount?: number
  requestedDays?: number
  splitMethod?: string
  totalStats?: PlanDayStats
}

/** 规划请求（POST /api/plan） */
export interface PlanOptions {
  dayStartTime?: string
  dayEndTime?: string
  lunchBreakMin?: number
  lunchWindow?: [string, string]
  mustVisitIds?: string[]
}

export interface PlanRequest {
  hotel: { lng: number; lat: number; name: string }
  destinations: Destination[]
  days: number
  mode: TravelMode
  /** 逐段覆盖：目的地 id → 该段交通方式；"__return__" 表示回酒店那一段 */
  legModes?: Record<string, TravelMode>
  weights: Weights
  naturalLanguage?: string
  options?: PlanOptions
}

/** 规划响应 */
export interface PlanResponse {
  days: PlanDay[]
  explanation: string
  /** 每一段一条折线（[lng, lat] 数组），长度 = 站点数 + 1 */
  polylines?: Array<Array<[number, number]>>
  solver?: PlanSolverMeta
}

/** 后端健康检查 */
export interface HealthInfo {
  status: string
  version: string
  amapConfigured: boolean
  distanceSource: 'amap' | 'offline-estimate' | string
  solver: string
  llmProvider: string
  llmConfigured: boolean
  poiCount: number
  cacheEntries: number
}

/** 等时圈（模块 3）：酒店交通便利度 */
export interface IsochronePoi {
  name: string
  lng: number
  lat: number
  minutes: number
  km: number
  tags: string[]
}

export interface IsochroneBand {
  minutes: number
  /** 等时圈多边形（经纬度闭环） */
  polygon: Array<[number, number]>
  /** 这条带内可达的热门 POI 数量 */
  poiCount: number
  pois: IsochronePoi[]
  /** amap-isochrone = 高德真实路网；offline-circle = 等速圆近似 */
  source: string
}

export interface IsochroneResponse {
  mode: string
  modeLabel: string
  dataSource: string
  bands: IsochroneBand[]
  poiTotal: number
  warnings: string[]
}

/* ------------------------------------------------------------------ */
/* 模块 4：AI 能力                                                     */
/* ------------------------------------------------------------------ */

export interface ResolvedPlace {
  name: string
  lng: number
  lat: number
  stayMin: number
  tags: string[]
  openTime: string
  closeTime: string
  /** preset = 预置 POI 命中；geocode = 高德地理编码 */
  matchedBy: string
  address?: string | null
  reason?: string | null
}

export interface AiParseResponse {
  /** llm = 大模型 Function Calling；rules = 内置规则解析（无 Key 时降级） */
  source: string
  places: ResolvedPlace[]
  exclude: string[]
  unresolved: string[]
  summary: string
  notes: string[]
  warnings: string[]
  debug?: Record<string, unknown> | null
}

export interface AiReplanConstraints {
  weights?: Partial<Weights>
  dayStartTime?: string
  dayEndTime?: string
  lunchBreakMin?: number
  days?: number
  mode?: TravelMode
  mustVisitNames?: string[]
  removeNames?: string[]
  intentSummary?: string
}

export interface AiReplanResponse {
  source: string
  /** 后端生成的人话回复（改了什么、为什么） */
  reply?: string
  constraints: AiReplanConstraints
  applied: string[]
  removed: string[]
  plan: PlanResponse
  warnings: string[]
  debug?: Record<string, unknown> | null
}

export interface AiExplainResponse {
  source: string
  text: string
  debug?: Record<string, unknown> | null
}

export interface AiHealthInfo {
  configured: boolean
  provider: string
  model?: string
  ok?: boolean
  reply?: string
  error?: string | null
}

/** 高德地点搜索/预置演示数据用的 POI */
export interface PoiPreset {
  name: string
  lng: number
  lat: number
  openTime: string
  closeTime: string
  stayMin: number
  tags: string[]
  district?: string
  address?: string
  /** 高德 POI id（快照来源，便于回溯） */
  amapId?: string
  rating?: string
  category?: string
  /** 高德营业时间原始文案（含"周一闭馆"这类说明） */
  hoursRaw?: string
  /** 每周固定全天关闭的日子，1=周一…7=周日。**只用于界面提示，不进求解器** */
  closedWeekdays?: number[]
  /** 快照抓取日期 */
  fetchedAt?: string
}

/* ------------------------------------------------------------------ */
/* 行程分享（口令）                                                     */
/* ------------------------------------------------------------------ */

/** 分享出去的目的地（不含本地 id，导入端会重新发 id） */
export type SharedDestination = Omit<Destination, 'id'> & { id?: string }

/** POST /api/share 的 trip_data：一份行程的完整"输入态" */
export interface SharedTripData {
  version?: number
  createdAt?: string
  hotel: Pick<Hotel, 'name' | 'lng' | 'lat'> & { address?: string }
  destinations: SharedDestination[]
  days?: number
  mode?: TravelMode
  /** 逐段覆盖：目的地 id → 交通方式；"__return__" 表示回程 */
  legModes?: Record<string, TravelMode>
  weights?: Partial<Weights>
  options?: {
    dayStartTime?: string
    dayEndTime?: string
    lunchBreakMin?: number
  }
}

export interface ShareCodeResponse {
  code: string
  message: string
}



/** 1.9 对话提案（先确认再动手） */
export interface AiTurnResponse {
  kind: 'act' | 'clarify' | 'answer'
  reply: string
  preview: string[]
  question?: string | null
  options: string[]
  ops: Record<string, unknown>
  warnings: string[]
}

export interface AiApplyResponse {
  plan: PlanResponse
  changes: string[]
  caption: string
}
