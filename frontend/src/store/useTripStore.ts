/**
 * 全局状态：Zustand + persist(localStorage)
 *
 * 设计要点：
 *  1) 酒店与目的地是两套数据：酒店永远不进 destinations 数组，
 *     所以「清空 / 取消选中」在数据结构层面就不可能删掉酒店 —— 这是 P0 的硬约束。
 *  2) 持久化只保存业务数据 + 地图视野，不保存 mapReady 这类运行时状态。
 *  3) 组件里请选择稳定引用（如 destinations），派生数组用 useMemo 算，
 *     直接 select 派生数组会每次返回新引用，导致 useSyncExternalStore 反复重渲染。
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  Destination,
  DestinationSource,
  HealthInfo,
  Hotel,
  IsochroneResponse,
  PlanResponse,
  SharedTripData,
  TravelMode,
  Weights,
} from '@/types'
import { DEFAULT_WEIGHTS } from '@/types'
import { uid } from '@/lib/id'
import { haversineM } from '@/lib/geo'

/** 默认酒店：人民广场（可在地图上用 POI 搜索替换） */
export const DEFAULT_HOTEL: Hotel = {
  name: '人民广场 · 默认起点',
  address: '上海市黄浦区人民大道',
  lng: 121.4737,
  lat: 31.2304,
}

/** 同一个位置 30m 内视为重复点，避免误双击产生重叠标记 */
const DEDUP_RADIUS_M = 30

export interface MapView {
  lng: number
  lat: number
  zoom: number
}

/** 行程时间设置（模块 3 会给它们加 UI） */
export interface TripOptions {
  dayStartTime: string
  dayEndTime: string
  lunchBreakMin: number
}

/** 本地"我的路书"：一份可保存、可分组、可分享的行程 */
export interface TripRecord {
  id: string
  title: string
  /** 分组名，默认「未分组」 */
  group: string
  updatedAt: string
  snapshot: SharedTripData
  /** 保存时的编译结果，打开详情页可直接展示 */
  plan?: PlanResponse | null
}

/** 本地账号（1.1 先做本地版；服务端账号是下一步） */
export interface Profile {
  nickname: string
  loggedIn: boolean
  amapKey: string
  llmKey: string
}

export const TRIP_GROUPS_DEFAULT = ['未分组', '上海 · 亲子', '上海 · 陪朋友']

export const DEFAULT_OPTIONS: TripOptions = {
  dayStartTime: '09:00',
  dayEndTime: '21:00',
  lunchBreakMin: 60,
}

export interface NewDestinationInput {
  name: string
  lng: number
  lat: number
  source: DestinationSource
  stayMin?: number
  openTime?: string
  closeTime?: string
  tags?: string[]
  address?: string
  /** 在线搜索命中的高德 POI id */
  amapId?: string
  /** 高德营业时间原始文案（界面展示，含"周一闭馆"这类说明） */
  hoursRaw?: string
  /** 每周固定全天关闭的日子，1=周一…7=周日。只用于界面提示 */
  closedWeekdays?: number[]
  /** 默认 false：新加的点先作为候选（灰点），用户点一下才选中 */
  selected?: boolean
}

export interface TripState {
  /** 酒店：固定起点 */
  hotel: Hotel
  /** 酒店是否由用户主动确认过（未确认时 UI 提示搜索） */
  hotelConfirmed: boolean
  /** 目的地全集（候选 + 选中） */
  destinations: Destination[]
  /** 全局轻提示（分享 / 导入的结果） */
  toast: { id: number; kind: 'success' | 'error'; text: string } | null

  // —— 规划参数（模块 2/3 使用，先落库避免后面改结构） ——
  days: number
  mode: TravelMode
  weights: Weights

  /** 地图视野，刷新后回到上次位置 */
  view: MapView
  /** 地图是否初始化完成 */
  mapReady: boolean

  // —— 模块 2：路书 ——
  /** 最近一次编译出来的路书 */
  plan: PlanResponse | null
  /** 生成该路书时的输入指纹，用来判断「计划是否已过期」 */
  planSignature: string | null
  planning: boolean
  planError: string | null
  options: TripOptions

  // —— 模块 3：多日 / 等时圈 ——
  /** 当前在地图与时间轴上查看的是第几天（0-based） */
  activeDay: number
  /** 等时圈数据（按需拉取，不落盘） */
  isochrone: IsochroneResponse | null
  isochroneVisible: boolean
  isochroneLoading: boolean
  isochroneMinutes: number[]

  /** 地图标记是否显示地名标签（点多了可以关掉，只留图标） */
  showLabels: boolean

  // —— 模块 4：AI ——
  /** AI 讲解文本（llm 或 rules 来源） */
  aiExplain: { text: string; source: string } | null
  aiExplainLoading: boolean

  // —— 模块 5：后端状态 ——
  backendStatus: 'unknown' | 'ok' | 'down'
  backendInfo: HealthInfo | null

  // —— actions ——
  setHotel: (hotel: Hotel) => void
  addDestination: (input: NewDestinationInput) => Destination
  addDestinations: (inputs: NewDestinationInput[]) => { added: number; skipped: number }
  updateDestination: (id: string, patch: Partial<Destination>) => void
  removeDestination: (id: string) => void
  removeSelected: () => void
  clearDestinations: () => void
  toggleSelect: (id: string) => void
  setSelected: (id: string, selected: boolean) => void
  selectAll: () => void
  deselectAll: () => void
  setDays: (days: number) => void
  setMode: (mode: TravelMode) => void
  setWeight: (key: keyof Weights, value: number) => void
  resetAll: () => void
  setView: (view: MapView) => void
  setMapReady: (ready: boolean) => void

  // —— 模块 2 ——
  setPlan: (plan: PlanResponse | null) => void
  setPlanning: (planning: boolean) => void
  setPlanError: (message: string | null) => void
  setOption: <K extends keyof TripOptions>(key: K, value: TripOptions[K]) => void
  /** 当前输入指纹（与 planSignature 比对即可判断计划是否过期） */
  currentSignature: () => string

  // —— 模块 3 ——
  setActiveDay: (day: number) => void
  setIsochrone: (data: IsochroneResponse | null) => void
  setIsochroneVisible: (visible: boolean) => void
  setIsochroneLoading: (loading: boolean) => void
  toggleIsochroneMinute: (minutes: number) => void
  setShowLabels: (show: boolean) => void

  // —— 模块 4 ——
  setAiExplain: (value: { text: string; source: string } | null) => void
  setAiExplainLoading: (loading: boolean) => void

  // —— 模块 5 ——
  setBackend: (status: 'unknown' | 'ok' | 'down', info: HealthInfo | null) => void

  // —— 模块 6：行程分享 ——
  /** 用导入的行程整体替换当前状态（酒店 / 目的地 / 天数 / 方式 / 权重 / 时间设置） */
  setFullTripState: (data: SharedTripData) => void
  showToast: (kind: 'success' | 'error', text: string) => void
  clearToast: () => void

  // —— 1.1：多路书 + 本地账号 ——
  trips: TripRecord[]
  profile: Profile | null
  activeTripId: string | null
  /** 首页 Hero 输入后带进工作台的初始语料 */
  pendingPrompt: string | null
  setPendingPrompt: (text: string | null) => void
  /** 把当前草稿存成一份路书（返回记录） */
  saveTrip: (title?: string, group?: string) => TripRecord
  /** 打开一份已保存的路书（会替换当前草稿） */
  openTrip: (id: string) => boolean
  deleteTrip: (id: string) => void
  renameTrip: (id: string, title: string) => void
  moveTrip: (id: string, group: string) => void
  saveProfile: (patch: Partial<Profile>) => void
  logout: () => void
}

/** 输入指纹：酒店 + 选中集合 + 方式 + 天数 + 权重 + 时间设置 */
function computeSignature(
  state: Pick<TripState, 'hotel' | 'destinations' | 'mode' | 'days' | 'weights' | 'options'>,
): string {
  const picked = state.destinations
    .filter((d) => d.selected)
    .map((d) => `${d.id}|${d.stayMin ?? 60}|${d.lng.toFixed(5)},${d.lat.toFixed(5)}`)
  return JSON.stringify({
    hotel: `${state.hotel.lng.toFixed(5)},${state.hotel.lat.toFixed(5)}`,
    picked,
    mode: state.mode,
    days: state.days,
    weights: state.weights,
    options: [state.options.dayStartTime, state.options.dayEndTime, state.options.lunchBreakMin],
  })
}

/** 生成 Destination 实体 */
function makeDestination(input: NewDestinationInput): Destination {
  return {
    id: uid('d'),
    name: input.name || '未命名地点',
    lng: input.lng,
    lat: input.lat,
    selected: input.selected ?? false,
    source: input.source,
    stayMin: input.stayMin ?? 60,
    openTime: input.openTime,
    closeTime: input.closeTime,
    tags: input.tags,
    address: input.address,
    amapId: input.amapId,
    hoursRaw: input.hoursRaw,
    closedWeekdays: input.closedWeekdays,
  }
}

/* ------------------------------------------------------------------ */
/* 分享 / 导入：把外部数据洗一遍再用，绝不信任任何字段                    */
/* ------------------------------------------------------------------ */

const TRAVEL_MODES: TravelMode[] = ['walk', 'transit', 'subway', 'taxi', 'drive']
const DEST_SOURCES: DestinationSource[] = ['map-click', 'search', 'ai', 'import']

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function normalizeHotel(raw: unknown): Hotel | null {
  if (!raw || typeof raw !== 'object') return null
  const h = raw as Partial<Hotel>
  const lng = Number(h.lng)
  const lat = Number(h.lat)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null
  const name = typeof h.name === 'string' && h.name.trim() ? h.name.trim() : '导入的起点'
  return { name, lng, lat, address: typeof h.address === 'string' ? h.address : undefined }
}

function normalizeDestinations(raw: unknown): Destination[] {
  if (!Array.isArray(raw)) return []
  const out: Destination[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const d = item as Partial<Destination>
    const lng = Number(d.lng)
    const lat = Number(d.lat)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    // 同一个位置 30m 内视为重复（导入数据也可能带重复点）
    if (out.some((exist) => haversineM(exist, { lng, lat }) < DEDUP_RADIUS_M)) continue
    out.push({
      // 重新发 id：避免与本地已有目的地冲突
      id: uid('d'),
      name: typeof d.name === 'string' && d.name.trim() ? d.name.trim() : '未命名地点',
      lng,
      lat,
      selected: d.selected !== false,
      source: DEST_SOURCES.includes(d.source as DestinationSource)
        ? (d.source as DestinationSource)
        : 'import',
      stayMin: clampNumber(d.stayMin, 5, 600, 60),
      openTime: typeof d.openTime === 'string' ? d.openTime : undefined,
      closeTime: typeof d.closeTime === 'string' ? d.closeTime : undefined,
      tags: Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === 'string') : undefined,
      address: typeof d.address === 'string' ? d.address : undefined,
      amapId: typeof d.amapId === 'string' ? d.amapId : undefined,
      hoursRaw: typeof d.hoursRaw === 'string' ? d.hoursRaw : undefined,
      closedWeekdays: Array.isArray(d.closedWeekdays)
        ? d.closedWeekdays.filter((n): n is number => Number.isInteger(n))
        : undefined,
    })
  }
  return out
}

function normalizeWeights(raw: unknown): Weights {
  const w = (raw ?? {}) as Partial<Weights>
  return {
    time: clampNumber(w.time, 0, 1, DEFAULT_WEIGHTS.time),
    convenience: clampNumber(w.convenience, 0, 1, DEFAULT_WEIGHTS.convenience),
    cost: clampNumber(w.cost, 0, 1, DEFAULT_WEIGHTS.cost),
    walking: clampNumber(w.walking, 0, 1, DEFAULT_WEIGHTS.walking),
  }
}

function normalizeOptions(raw: unknown): TripOptions {
  const o = (raw ?? {}) as Partial<TripOptions>
  const time = (value: unknown, fallback: string) =>
    typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value) ? value : fallback
  return {
    dayStartTime: time(o.dayStartTime, DEFAULT_OPTIONS.dayStartTime),
    dayEndTime: time(o.dayEndTime, DEFAULT_OPTIONS.dayEndTime),
    lunchBreakMin: clampNumber(o.lunchBreakMin, 0, 180, DEFAULT_OPTIONS.lunchBreakMin),
  }
}

function normalizeMode(raw: unknown): TravelMode {
  return TRAVEL_MODES.includes(raw as TravelMode) ? (raw as TravelMode) : 'transit'
}

/** 收集当前行程快照（分享用）：只取"输入态"，不含已编译的路书 */
export function snapshotTrip(state: TripState): SharedTripData {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    hotel: {
      name: state.hotel.name,
      address: state.hotel.address,
      lng: state.hotel.lng,
      lat: state.hotel.lat,
    },
    destinations: state.destinations.map(({ id: _id, ...rest }) => rest),
    days: state.days,
    mode: state.mode,
    weights: { ...state.weights },
    options: { ...state.options },
  }
}

export const useTripStore = create<TripState>()(
  persist(
    (set, get) => ({
      hotel: DEFAULT_HOTEL,
      hotelConfirmed: false,
      destinations: [],
      toast: null,
      trips: [],
      profile: null,
      activeTripId: null,
      pendingPrompt: null,
      days: 1,
      mode: 'transit',
      weights: { ...DEFAULT_WEIGHTS },
      view: { lng: 121.4737, lat: 31.2304, zoom: 12.5 },
      mapReady: false,

      plan: null,
      planSignature: null,
      planning: false,
      planError: null,
      options: { ...DEFAULT_OPTIONS },

      activeDay: 0,
      isochrone: null,
      isochroneVisible: false,
      isochroneLoading: false,
      isochroneMinutes: [15, 30, 45],
      showLabels: true,

      aiExplain: null,
      aiExplainLoading: false,

      backendStatus: 'unknown',
      backendInfo: null,

      // 换酒店会让等时圈失效，顺手清掉
      setHotel: (hotel) => set({ hotel, hotelConfirmed: true, isochrone: null }),

      addDestination: (input) => {
        const state = get()
        // 30m 内去重：返回已存在的点（而不是新增），保证标记不重叠
        const dup = state.destinations.find(
          (d) => haversineM(d, input) < DEDUP_RADIUS_M,
        )
        if (dup) return dup
        const dest = makeDestination(input)
        set({ destinations: [...state.destinations, dest] })
        return dest
      },

      addDestinations: (inputs) => {
        let added = 0
        let skipped = 0
        // 逐个走 addDestination，天然复用去重逻辑
        for (const input of inputs) {
          const before = get().destinations.length
          get().addDestination(input)
          if (get().destinations.length > before) added += 1
          else skipped += 1
        }
        return { added, skipped }
      },

      updateDestination: (id, patch) =>
        set((s) => ({
          destinations: s.destinations.map((d) => (d.id === id ? { ...d, ...patch } : d)),
        })),

      removeDestination: (id) =>
        set((s) => ({ destinations: s.destinations.filter((d) => d.id !== id) })),

      removeSelected: () => set((s) => ({ destinations: s.destinations.filter((d) => !d.selected) })),

      clearDestinations: () => set({ destinations: [] }),

      toggleSelect: (id) =>
        set((s) => ({
          destinations: s.destinations.map((d) =>
            d.id === id ? { ...d, selected: !d.selected } : d,
          ),
        })),

      setSelected: (id, selected) =>
        set((s) => ({
          destinations: s.destinations.map((d) => (d.id === id ? { ...d, selected } : d)),
        })),

      selectAll: () =>
        set((s) => ({ destinations: s.destinations.map((d) => ({ ...d, selected: true })) })),

      deselectAll: () =>
        set((s) => ({ destinations: s.destinations.map((d) => ({ ...d, selected: false })) })),

      setDays: (days) => set({ days: Math.min(7, Math.max(1, Math.round(days))) }),
      setMode: (mode) => set({ mode }),
      setWeight: (key, value) =>
        set((s) => ({ weights: { ...s.weights, [key]: Math.min(1, Math.max(0, value)) } })),

      resetAll: () =>
        set({
          hotel: DEFAULT_HOTEL,
          hotelConfirmed: false,
          destinations: [],
          days: 1,
          mode: 'transit',
          weights: { ...DEFAULT_WEIGHTS },
        }),

      setView: (view) => set({ view }),
      setMapReady: (mapReady) => set({ mapReady }),

      // —— 模块 2：路书 ——
      setPlan: (plan) =>
        set({
          plan,
          planSignature: plan ? computeSignature(get()) : null,
          planError: null,
          // 重新编译后回到第 1 天，避免停留在已不存在的天数上
          activeDay: 0,
        }),
      setPlanning: (planning) => set({ planning }),
      setPlanError: (planError) => set({ planError }),
      setOption: (key, value) => set((s) => ({ options: { ...s.options, [key]: value } })),
      currentSignature: () => computeSignature(get()),

      // —— 模块 3 ——
      setActiveDay: (activeDay) => set({ activeDay }),
      setIsochrone: (isochrone) => set({ isochrone }),
      setIsochroneVisible: (isochroneVisible) => set({ isochroneVisible }),
      setIsochroneLoading: (isochroneLoading) => set({ isochroneLoading }),
      toggleIsochroneMinute: (minutes) =>
        set((s) => {
          const next = s.isochroneMinutes.includes(minutes)
            ? s.isochroneMinutes.filter((m) => m !== minutes)
            : [...s.isochroneMinutes, minutes].sort((a, b) => a - b)
          return { isochroneMinutes: next.length ? next : [minutes], isochrone: null }
        }),
      setShowLabels: (showLabels) => set({ showLabels }),

      // —— 模块 4 ——
      setAiExplain: (aiExplain) => set({ aiExplain }),
      setAiExplainLoading: (aiExplainLoading) => set({ aiExplainLoading }),

      // —— 模块 5 ——
      setBackend: (backendStatus, backendInfo) => set({ backendStatus, backendInfo }),

      // —— 模块 6：行程分享 ——
      setFullTripState: (data) => {
        const hotel = normalizeHotel(data?.hotel) ?? get().hotel
        const destinations = normalizeDestinations(data?.destinations)
        set({
          hotel,
          hotelConfirmed: true,
          destinations,
          days: Math.round(clampNumber(data?.days, 1, 7, 1)),
          mode: normalizeMode(data?.mode),
          weights: normalizeWeights(data?.weights),
          options: normalizeOptions(data?.options),
          // 导入的是"输入态"，旧路书必须清掉，交给编译器重算
          plan: null,
          planSignature: null,
          planError: null,
          planning: false,
          activeDay: 0,
          isochrone: null,
          isochroneVisible: false,
          isochroneLoading: false,
          aiExplain: null,
          // 视野跟到新酒店，导入后地图立刻有反应
          view: { lng: hotel.lng, lat: hotel.lat, zoom: 13.5 },
        })
      },

      showToast: (kind, text) =>
        set({ toast: { id: Date.now() + Math.floor(Math.random() * 1000), kind, text } }),

      clearToast: () => set({ toast: null }),

      // —— 1.1：多路书 + 本地账号 ——
      setPendingPrompt: (pendingPrompt) => set({ pendingPrompt }),

      saveTrip: (title, group) => {
        const state = get()
        const snapshot = snapshotTrip(state)
        const existing = state.activeTripId
          ? state.trips.find((trip) => trip.id === state.activeTripId)
          : undefined
        const record: TripRecord = {
          id: existing?.id ?? `trip_${Date.now().toString(36)}`,
          title:
            title?.trim() ||
            existing?.title ||
            `${state.hotel.name.replace(/ · .*$/, '')} · ${state.days} 天`,
          group: group || existing?.group || TRIP_GROUPS_DEFAULT[0],
          updatedAt: new Date().toISOString(),
          snapshot,
          plan: state.plan,
        }
        set({
          trips: [record, ...state.trips.filter((trip) => trip.id !== record.id)],
          activeTripId: record.id,
        })
        return record
      },

      openTrip: (id) => {
        const record = get().trips.find((trip) => trip.id === id)
        if (!record) return false
        get().setFullTripState(record.snapshot)
        if (record.plan) {
          set({ plan: record.plan, planSignature: get().currentSignature() })
        }
        set({ activeTripId: record.id })
        return true
      },

      deleteTrip: (id) =>
        set((state) => ({
          trips: state.trips.filter((trip) => trip.id !== id),
          activeTripId: state.activeTripId === id ? null : state.activeTripId,
        })),

      renameTrip: (id, title) =>
        set((state) => ({
          trips: state.trips.map((trip) =>
            trip.id === id ? { ...trip, title: title.trim() || trip.title } : trip,
          ),
        })),

      moveTrip: (id, group) =>
        set((state) => ({
          trips: state.trips.map((trip) => (trip.id === id ? { ...trip, group } : trip)),
        })),

      saveProfile: (patch) =>
        set((state) => ({
          profile: {
            nickname: state.profile?.nickname ?? '我',
            loggedIn: true,
            amapKey: state.profile?.amapKey ?? '',
            llmKey: state.profile?.llmKey ?? '',
            ...patch,
          },
        })),

      logout: () => set({ profile: null }),
    }),
    {
      name: 'tripcompiler:v1',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      // v1 -> v2：新增 options / plan / planSignature
      // v2 -> v3：新增多路书 trips / 本地账号 profile / activeTripId
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<TripState>
        return {
          ...state,
          options: state.options ?? { ...DEFAULT_OPTIONS },
          plan: state.plan ?? null,
          planSignature: state.planSignature ?? null,
          trips: state.trips ?? [],
          profile: state.profile ?? null,
          activeTripId: state.activeTripId ?? null,
        } as TripState
      },
      // 只持久化业务数据与视野，运行时状态（mapReady / planning）不落盘
      partialize: (s) => ({
        hotel: s.hotel,
        hotelConfirmed: s.hotelConfirmed,
        destinations: s.destinations,
        days: s.days,
        mode: s.mode,
        weights: s.weights,
        view: s.view,
        options: s.options,
        // 路书也持久化：刷新页面后路线与时间轴不会丢，演示更稳
        plan: s.plan,
        planSignature: s.planSignature,
        activeDay: s.activeDay,
        isochroneVisible: s.isochroneVisible,
        isochroneMinutes: s.isochroneMinutes,
        showLabels: s.showLabels,
        // 1.1：多路书 + 本地账号
        trips: s.trips,
        profile: s.profile,
        activeTripId: s.activeTripId,
      }),
    },
  ),
)

/**
 * 选中列表的派生 selector。
 * ⚠️ 不要直接写 useTripStore(selectSelectedDestinations)，会每次返回新数组。
 *    正确用法：const destinations = useTripStore(s => s.destinations) 然后用 useMemo 过滤。
 */
export const selectSelectedDestinations = (s: TripState): Destination[] =>
  s.destinations.filter((d) => d.selected)
