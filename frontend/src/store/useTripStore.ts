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

export const useTripStore = create<TripState>()(
  persist(
    (set, get) => ({
      hotel: DEFAULT_HOTEL,
      hotelConfirmed: false,
      destinations: [],
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
    }),
    {
      name: 'tripcompiler:v1',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // v1 -> v2：新增 options / plan / planSignature，缺失的字段用默认值补齐
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<TripState>
        return {
          ...state,
          options: state.options ?? { ...DEFAULT_OPTIONS },
          plan: state.plan ?? null,
          planSignature: state.planSignature ?? null,
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
