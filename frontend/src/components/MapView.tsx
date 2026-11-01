import { useCallback, useEffect, useRef, useState } from 'react'
import { hasAmapKey, loadAMap, reverseGeocode } from '@/lib/amap'
import { useMemo } from 'react'
import { blockPropagation, escapeHtml } from '@/lib/dom'
import { layoutLabels, type LabelCandidate, type LabelObstacle } from '@/lib/labelLayout'
import { clearMapInstance, fitToPoints, setMapInstance } from '@/lib/mapInstance'
import { fetchLegGeometries, type LegEndpoints, type LegGeometry } from '@/lib/routeGeometry'
import { displayRoutes } from '@/lib/routeDisplay'
import { getCity } from '@/data/cities'
import type { Hotel, PlanDay, TravelMode } from '@/types'
import { RouteFlow } from '@/lib/routeFlow'
import { useOrderMap, useDayScope } from '@/lib/routeOrder'
import { bandColor, modeStyle, ROUTE_COLOR } from '@/lib/routeStyle'
import { useTripStore } from '@/store/useTripStore'
import MapLegend from './MapLegend'
import MissingKeyCard from './MissingKeyCard'

/* ------------------------------------------------------------------
 * 标记 DOM 工厂
 * AMap Marker 的 content 是高德自己插进地图容器的原生 DOM，
 * 这里用原生 DOM + 独立 CSS 类（见 src/index.css 的 .tc-pin）。
 * ------------------------------------------------------------------ */

/**
 * 名称标签（浮在标记上方）。
 * data-priority 供碰撞避让排序用：数字越小越优先（酒店 0 → 已选点 1..n → 候选点 9000）。
 */
function labelHtml(name: string, priority: number, key: string): string {
  return (
    `<div class="tc-pin__label" data-priority="${priority}" data-key="${escapeHtml(key)}">` +
    `<span class="tc-pin__label-text">${escapeHtml(name)}</span>` +
    `</div>`
  )
}

/** 酒店：蓝色方块徽标 + 地名（固定起点 / 终点） */
function createHotelPinEl(name: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'tc-pin tc-pin--hotel'
  el.innerHTML =
    labelHtml(name, 0, 'hotel') +
    `<div class="tc-pin__head"></div>` +
    `<div class="tc-pin__tail"></div>`
  // ⚠️ 关键：标记上的事件必须阻止冒泡，否则地图 click 会紧接着触发，
  //    于是「点标记」变成「点标记 + 在该处新增一个候选点」。
  blockPropagation(el)
  return el
}

/** 选中目的地：墨黑水滴形地图针（针头里是序号）+ 地名标签 */
function createPickedPinEl(
  order: number,
  name: string,
  key: string,
  showLabel = true,
): HTMLElement {
  const el = document.createElement('div')
  el.className = 'tc-pin tc-pin--poi'
  el.innerHTML =
    (showLabel ? labelHtml(name, order, key) : '') +
    `<div class="tc-pin__head">${order}</div>` +
    `<div class="tc-pin__tail"></div>`
  blockPropagation(el)
  return el
}

/**
 * 候选目的地（未选中）：浅灰小圆点 + 地名标签。
 *
 * showLabel=false 时退化为一个纯圆点（点多了可以关掉标签，避免地图太挤）。
 * 带标签时外面套一层 .tc-cand-wrap（14×14，标签绝对定位浮在上方），
 * 这样 anchor:'center' 依然对准圆心。
 *
 * 这里用 HTML Marker 而不是 CircleMarker，是为了能带标签；
 * 代价是点位特别多（>200）时性能不如 canvas 的 CircleMarker / MassMarks。
 */
function createCandidatePinEl(name: string, key: string, showLabel = true): HTMLElement {
  if (!showLabel) {
    const el = document.createElement('div')
    el.className = 'tc-cand'
    el.title = name
    blockPropagation(el)
    return el
  }
  const wrap = document.createElement('div')
  wrap.className = 'tc-cand-wrap'
  wrap.innerHTML = labelHtml(name, 9000, key) + `<div class="tc-cand"></div>`
  blockPropagation(wrap)
  return wrap
}

/** 路线上的交通方式徽标（时长 / 回酒店），挂在每一段折线的中间点 */
function createLegBadgeEl(text: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'tc-leg'
  el.textContent = text
  blockPropagation(el)
  return el
}

function infoWindowHtml(title: string, lines: string[]): string {  return (
    `<div class="tc-iw"><div class="tc-iw__title">${escapeHtml(title)}</div>` +
    lines.map((l) => `<div class="tc-iw__muted">${escapeHtml(l)}</div>`).join('') +
    `</div>`
  )
}

/**
 * 地图组件
 *
 * 三条硬性约束的实现方式：
 *  1) 酒店标记固定不可取消 —— 酒店数据独立于 destinations，UI 无删除入口。
 *  2) 目的地与酒店在视觉上区分得开：
 *       酒店       = 蓝色圆角方块（全图唯一的彩色标记）
 *       已选目的地 = 墨黑水滴形地图针 + 序号
 *       候选目的地 = 浅灰小圆点（点一下即变墨色针）
 *     三个图层都用「增量 diff 同步」而不是每次清空重建，避免闪烁与标记丢失。
 *  3) 点标记不能新增点 —— 三重保险：DOM stopPropagation + Marker bubble:false
 *     + 400ms 时间戳兜底。
 */
export default function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const AMapRef = useRef<any>(null)
  const mapRef = useRef<any>(null)
  const infoWindowRef = useRef<any>(null)

  /** 图层注册表：id -> overlay，用于增量同步 */
  const candidateMarkersRef = useRef<Map<string, any>>(new Map())
  const pickedMarkersRef = useRef<Map<string, any>>(new Map())
  /** 路线图层（折线 + 交通徽标），每次重算前整体清掉 */
  const routeOverlaysRef = useRef<any[]>([])
  /** 等时圈图层 */
  const isochroneOverlaysRef = useRef<any[]>([])
  /** 选中标记的渲染缓存（序号|名称|图标|是否显示标签），变化时才 setContent */
  const pickedMetaRef = useRef<Map<string, string>>(new Map())
  /** 候选点标记的渲染缓存（是否显示标签|图标|名称） */
  const candidateMetaRef = useRef<Map<string, string>>(new Map())
  const hotelMarkerRef = useRef<any>(null)
  /** 路线流动箭头（真实路网时才创建） */
  const flowRef = useRef<RouteFlow | null>(null)
  /** 兜底防冒泡：最近一次「点到标记」的时间戳 */
  const lastOverlayClickAtRef = useRef(0)

  const [booting, setBooting] = useState(true)
  const [initError, setInitError] = useState<string | null>(null)
  /** Partial geometry recovery is tied to the exact day/origin/city/mode. */
  const [clientPaths, setClientPaths] = useState<{ day: PlanDay; hotel: Hotel; cityId: string; mode: string; items: Array<LegGeometry | null> } | null>(null)
  const [geometryLoading, setGeometryLoading] = useState(false)
  const [geometryRetry, setGeometryRetry] = useState(0)

  /** 标签避让的下一帧句柄（连拖地图时只算最后一帧） */
  const labelFrameRef = useRef<number | null>(null)

  /**
   * 标签碰撞避让（屏幕空间贪心占位 + 上下翻转）：
   *   全部显示 → 量每个标签的矩形 → 酒店/已选点优先 → 上方放不下就翻到下方 → 都放不下才隐藏。
   * 只改 DOM class、不碰 React 状态，所以不会触发重渲染；
   * 被隐藏的只是文字标签，标记本身还在，点一下依旧能看详情。
   */
  const applyLabelCollision = useCallback(() => {
    const root = containerRef.current
    if (!root) return
    const labels = Array.from(root.querySelectorAll<HTMLElement>('.tc-pin__label'))
    if (!labels.length) return

    // 必须先把上一轮的隐藏/翻转还原，否则 display:none 的元素量不出尺寸
    for (const el of labels) {
      el.classList.remove('tc-pin__label--hidden', 'tc-pin__label--below')
    }

    const bounds = root.getBoundingClientRect()
    const items: Array<{ el: HTMLElement; candidate: LabelCandidate }> = []
    for (const el of labels) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      // 完全在视野外的标签不参与避让（反正也看不见）
      if (
        r.right < bounds.left ||
        r.left > bounds.right ||
        r.bottom < bounds.top ||
        r.top > bounds.bottom
      ) {
        continue
      }
      // 备选位置：标记正下方 6px（针尖或灰点之下），左右居中
      const markerRect = el.parentElement?.getBoundingClientRect()
      const centerX = markerRect ? markerRect.left + markerRect.width / 2 : (r.left + r.right) / 2
      const fallbackTop = markerRect ? markerRect.bottom + 6 : r.bottom + 6
      items.push({
        el,
        candidate: {
          key: el.dataset.key ?? el.textContent ?? '',
          priority: Number(el.dataset.priority ?? 9999),
          rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
          fallbackRect: {
            left: centerX - r.width / 2,
            top: fallbackTop,
            right: centerX + r.width / 2,
            bottom: fallbackTop + r.height,
          },
        },
      })
    }
    if (!items.length) return

    // 障碍物：别人的针头/酒店方块/灰点，以及路线上的时长徽标 —— 标签不能压住它们
    const obstacles: LabelObstacle[] = []
    for (const markerEl of Array.from(
      root.querySelectorAll<HTMLElement>('.tc-pin, .tc-cand, .tc-cand-wrap'),
    )) {
      const head = markerEl.querySelector<HTMLElement>('.tc-pin__head') ?? markerEl
      const r = head.getBoundingClientRect()
      if (!r.width || !r.height) continue
      obstacles.push({
        key: markerEl.querySelector<HTMLElement>('.tc-pin__label')?.dataset.key,
        rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      })
    }
    for (const badge of Array.from(root.querySelectorAll<HTMLElement>('.tc-leg'))) {
      const r = badge.getBoundingClientRect()
      if (!r.width || !r.height) continue
      obstacles.push({ rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } })
    }

    const placement = layoutLabels(
      items.map((i) => i.candidate),
      { padding: 3, obstacles },
    )
    for (const { el, candidate } of items) {
      const where = placement.get(candidate.key) ?? 'hidden'
      if (where === 'hidden') el.classList.add('tc-pin__label--hidden')
      else if (where === 'fallback') el.classList.add('tc-pin__label--below')
    }
  }, [])

  /** 双 rAF：等这一帧里高德把标记的 transform 定位应用完，再量尺寸 */
  const scheduleLabelLayout = useCallback(() => {
    if (labelFrameRef.current != null) cancelAnimationFrame(labelFrameRef.current)
    labelFrameRef.current = requestAnimationFrame(() => {
      labelFrameRef.current = requestAnimationFrame(() => {
        labelFrameRef.current = null
        applyLabelCollision()
      })
    })
  }, [applyLabelCollision])

  // 只订阅稳定引用，派生数组在下面用 useMemo/局部变量算
  const destinations = useTripStore((s) => s.destinations)
  const selectedLeg = useTripStore((s) => s.selectedLeg)
  const hotel = useTripStore((s) => s.hotel)
  const mapReady = useTripStore((s) => s.mapReady)
  const plan = useTripStore((s) => s.plan)
  const mode = useTripStore((s) => s.mode)
  const cityId = useTripStore((s) => s.cityId)
  const isochrone = useTripStore((s) => s.isochrone)
  const isochroneVisible = useTripStore((s) => s.isochroneVisible)
  /** 地图标记是否显示地名标签 */
  const showLabels = useTripStore((s) => s.showLabels)
  /** 序号来源：有路书按路线顺序，没有则按选中顺序 */
  const orderMap = useOrderMap()
  /** 多日模式：只高亮「当前这一天」，其他天的点退回灰色候选态 */
  const { day: activeDayPlan, dayIds } = useDayScope()
  const displayedRoutes = useMemo(() => {
    if (!activeDayPlan) return []
    const current = clientPaths?.day === activeDayPlan && clientPaths.hotel === hotel && clientPaths.cityId === cityId && clientPaths.mode === mode
    return displayRoutes(activeDayPlan, hotel, mode, current ? clientPaths.items : [], plan?.days[0] === activeDayPlan ? plan.polylines : [])
  }, [activeDayPlan, hotel, mode, cityId, clientPaths, plan])
  const unverifiedCount = displayedRoutes.filter(item => !item.verified).length
  const estimatedCount = displayedRoutes.filter(item => item.statsEstimated).length

  /* ============================================================
   * 1) 初始化地图（只执行一次；StrictMode 下会 mount→unmount→mount）
   * ============================================================ */
  useEffect(() => {
    if (!hasAmapKey) {
      setBooting(false)
      return
    }
    let disposed = false

    loadAMap()
      .then((AMap) => {
        if (disposed || !containerRef.current) return
        AMapRef.current = AMap

        const view = useTripStore.getState().view
        const map = new AMap.Map(containerRef.current, {
          zoom: view.zoom,
          center: [view.lng, view.lat],
          viewMode: '2D',
          resizeEnable: true,
          // 浅色底图：把高德默认的彩色路网压成灰白，数据（标记/路线）才是主角
          mapStyle: 'amap://styles/whitesmoke',
          // 隐藏底图自带的彩色 POI 图标（它们和我们的目的地标记抢注意力），
          // 只保留背景、道路与建筑 —— 地名标签仍在，便于定位
          features: ['bg', 'road', 'building'],
          // 统一 GCJ-02，高德不做任何坐标转换
        })
        mapRef.current = map
        setMapInstance(map, AMap)

        map.addControl(new AMap.Scale())
        map.addControl(new AMap.ToolBar({ position: { top: '96px', right: '16px' } }))
        infoWindowRef.current = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -30) })

        /* ---- 地图点击 = 新增候选点 ---- */
        const handleMapClick = (e: any) => {
          // 兜底 1：刚点过标记，400ms 内的地图 click 一律忽略
          if (Date.now() - lastOverlayClickAtRef.current < 400) return
          const lng = Number(e?.lnglat?.getLng?.())
          const lat = Number(e?.lnglat?.getLat?.())
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) return

          const store = useTripStore.getState()
          // 先用占位名立刻落点（灰点马上出现，交互无延迟），再异步逆地理编码改名
          const dest = store.addDestination({
            name: '选址中…',
            lng,
            lat,
            source: 'map-click',
            selected: false,
          })
          reverseGeocode(AMap, lng, lat)
            .then(({ name, address }) => {
              // 用户可能在等待期间把点删了，这里必须二次确认
              const exists = useTripStore.getState().destinations.some((d) => d.id === dest.id)
              if (!exists) return
              useTripStore.getState().updateDestination(dest.id, { name, address })
            })
            .catch(() => {
              useTripStore.getState().updateDestination(dest.id, { name: '候选点' })
            })
        }

        /* ---- 视野变化 → 持久化（刷新后回到原位，满足「刷新后仍在」的观感） ---- */
        const persistView = () => {
          const c = map.getCenter()
          if (!c) return
          useTripStore.getState().setView({
            lng: c.getLng(),
            lat: c.getLat(),
            zoom: map.getZoom(),
          })
        }

        /* ---- 视野变化：持久化 + 重排标签（避让随缩放/平移重新计算） ---- */
        const handleViewChange = () => {
          persistView()
          scheduleLabelLayout()
        }

        map.on('click', handleMapClick)
        map.on('moveend', handleViewChange)
        map.on('zoomend', handleViewChange)
        window.addEventListener('resize', scheduleLabelLayout)

        setBooting(false)
        useTripStore.getState().setMapReady(true)
        scheduleLabelLayout()

        // 清理函数需要拿到这几个 handler，挂到 map 实例上带出去
        ;(map as any).__tcHandlers = { handleMapClick, handleViewChange }
      })
      .catch((err: unknown) => {
        if (disposed) return
        setBooting(false)
        setInitError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      disposed = true
      window.removeEventListener('resize', scheduleLabelLayout)
      if (labelFrameRef.current != null) cancelAnimationFrame(labelFrameRef.current)
      const map = mapRef.current
      if (map) {
        const handlers = (map as any).__tcHandlers
        if (handlers) {
          map.off('click', handlers.handleMapClick)
          map.off('moveend', handlers.handleViewChange)
          map.off('zoomend', handlers.handleViewChange)
        }
        map.clearMap()
        map.destroy()
      }
      mapRef.current = null
      AMapRef.current = null
      infoWindowRef.current = null
      hotelMarkerRef.current = null
      flowRef.current?.destroy()
      flowRef.current = null
      candidateMarkersRef.current.clear()
      pickedMarkersRef.current.clear()
      pickedMetaRef.current.clear()
      candidateMetaRef.current.clear()
      routeOverlaysRef.current = []
      isochroneOverlaysRef.current = []
      clearMapInstance()
      useTripStore.getState().setMapReady(false)
    }
  }, [])

  /* ============================================================
   * 2) 酒店标记（蓝色，固定不可取消）
   * ============================================================ */
  useEffect(() => {
    const AMap = AMapRef.current
    const map = mapRef.current
    if (!AMap || !map) return

    const position: [number, number] = [hotel.lng, hotel.lat]
    const content = () => createHotelPinEl(hotel.name)

    if (!hotelMarkerRef.current) {
      const marker = new AMap.Marker({
        position,
        anchor: 'bottom-center',
        content: content(),
        zIndex: 300,
        bubble: false, // 不向地图冒泡
        extData: { kind: 'hotel' },
      })
      marker.on('click', () => {
        lastOverlayClickAtRef.current = Date.now()
        infoWindowRef.current?.setContent(
          infoWindowHtml(hotel.name, [
            hotel.address ?? '',
            '固定起点：出发与返回都在这里',
            '不可取消 · 可在左侧搜索替换',
          ]),
        )
        infoWindowRef.current?.open(map, position)
      })
      marker.setMap(map)
      hotelMarkerRef.current = marker
    } else {
      hotelMarkerRef.current.setPosition(position)
      hotelMarkerRef.current.setContent(content())
    }
    scheduleLabelLayout()
  }, [hotel, mapReady, scheduleLabelLayout])

  /* ============================================================
   * 3) 候选点图层：浅灰小圆点（可选地名标签）
   *    增量 diff：只增删差异项，已存在的仅更新坐标
   * ============================================================ */
  useEffect(() => {
    const AMap = AMapRef.current
    const map = mapRef.current
    if (!AMap || !map) return

    const candidates = dayIds
      ? destinations.filter((d) => !dayIds.has(d.id))
      : destinations.filter((d) => !d.selected)
    const wanted = new Set(candidates.map((d) => d.id))

    // 3.1 删除：已选中或已被删除的点
    for (const [id, marker] of candidateMarkersRef.current) {
      if (!wanted.has(id)) {
        marker.setMap(null)
        candidateMarkersRef.current.delete(id)
        candidateMetaRef.current.delete(id)
      }
    }

    // 3.2 新增 / 更新
    for (const d of candidates) {
      const meta = `${showLabels}|${d.name}`
      const exist = candidateMarkersRef.current.get(d.id)
      if (exist) {
        exist.setPosition([d.lng, d.lat])
        // 开关标签、改名时才重设内容，避免每次 setContent 闪一下
        if (candidateMetaRef.current.get(d.id) !== meta) {
          exist.setContent(createCandidatePinEl(d.name, d.id, showLabels))
          candidateMetaRef.current.set(d.id, meta)
        }
        continue
      }
      const marker = new AMap.Marker({
        position: [d.lng, d.lat],
        anchor: 'center', // 圆心即坐标点
        content: createCandidatePinEl(d.name, d.id, showLabels),
        zIndex: 60,
        bubble: false, // 兜底 2：不冒泡到地图
        extData: { kind: 'candidate', id: d.id },
      })
      marker.on('click', (ev: any) => {
        lastOverlayClickAtRef.current = Date.now()
        // 兜底 3：部分版本仍会向 map 派发 click，这里再拦一次
        ev?.originEvent?.stopPropagation?.()
        useTripStore.getState().toggleSelect(d.id)
      })
      marker.setMap(map)
      candidateMarkersRef.current.set(d.id, marker)
      candidateMetaRef.current.set(d.id, meta)
    }
    scheduleLabelLayout()
  }, [destinations, dayIds, showLabels, mapReady, scheduleLabelLayout])

  /* ============================================================
   * 4) 选中点图层：墨色带序号（单独渲染，序号 = 路线顺序）
   * ============================================================ */
  useEffect(() => {
    const AMap = AMapRef.current
    const map = mapRef.current
    if (!AMap || !map) return

    const picked = dayIds
      ? destinations.filter((d) => dayIds.has(d.id))
      : destinations.filter((d) => d.selected)
    const wanted = new Set(picked.map((d) => d.id))

    for (const [id, marker] of pickedMarkersRef.current) {
      if (!wanted.has(id)) {
        marker.setMap(null)
        pickedMarkersRef.current.delete(id)
        pickedMetaRef.current.delete(id)
      }
    }

    picked.forEach((d, index) => {
      // 序号来源：有路书就是路线顺序，没有就是选中顺序（与侧边栏/时间轴保持一致）
      const order = orderMap.get(d.id) ?? index + 1
      const meta = `${order}|${d.name}|${showLabels}`
      const exist = pickedMarkersRef.current.get(d.id)

      if (exist) {
        exist.setPosition([d.lng, d.lat])
        // 序号 / 名称 / 标签开关变了才重设内容（否则每次 setContent 会闪一下）
        if (pickedMetaRef.current.get(d.id) !== meta) {
          exist.setContent(createPickedPinEl(order, d.name, d.id, showLabels))
          pickedMetaRef.current.set(d.id, meta)
        }
        return
      }

      const marker = new AMap.Marker({
        position: [d.lng, d.lat],
        anchor: 'bottom-center',
        content: createPickedPinEl(order, d.name, d.id, showLabels),
        zIndex: 200 + order,
        bubble: false,
        extData: { kind: 'picked', id: d.id },
      })
      marker.on('click', () => {
        lastOverlayClickAtRef.current = Date.now()
        // 再点一次 = 取消选中（回到灰色候选图标）
        useTripStore.getState().toggleSelect(d.id)
      })
      marker.setMap(map)
      pickedMarkersRef.current.set(d.id, marker)
      pickedMetaRef.current.set(d.id, meta)
    })
    scheduleLabelLayout()
  }, [destinations, dayIds, orderMap, showLabels, mapReady, scheduleLabelLayout])

  /* ============================================================
   * 5) 按每段的来源与 approx 标记补查；未知路径始终保留未确认状态。
   * ============================================================ */
  useEffect(() => {
    const AMap = AMapRef.current
    const map = mapRef.current
    setClientPaths(null)
    if (!AMap || !map || !plan || !activeDayPlan || !activeDayPlan.stops.length) return
    const day = activeDayPlan
    const serverRoutes = displayRoutes(day, hotel, mode, [], plan.days[0] === day ? plan.polylines : [])
    if (serverRoutes.every(item => item.verified)) { setGeometryLoading(false); return }

    const stops = activeDayPlan.stops
    const points = [
      { lng: hotel.lng, lat: hotel.lat },
      ...stops.map((stop) => ({ lng: stop.lng, lat: stop.lat })),
      { lng: hotel.lng, lat: hotel.lat },
    ]
    const routeMode = mode
    const legs: LegEndpoints[] = []
    for (let i = 1; i < points.length; i += 1) {
      // 每一段用它自己的方式（逐段覆盖），没有就用整份路书的方式
      const legMode = serverRoutes[i - 1].mode as TravelMode
      legs.push({ from: points[i - 1], to: points[i], mode: legMode, skip: serverRoutes[i - 1].verified })
    }

    let cancelled = false
    setGeometryLoading(true)
    const progress = (items: Array<LegGeometry | null>) => {
      if (!cancelled) setClientPaths({ day, hotel, cityId, mode, items })
    }
    void fetchLegGeometries(AMap, legs, routeMode, getCity(cityId).name, { cancelled: () => cancelled, onProgress: progress }).then((geometries) => {
      if (cancelled || !geometries) return
      progress(geometries)
    }).catch(() => {}).finally(() => { if (!cancelled) setGeometryLoading(false) })
    return () => {
      cancelled = true
    }
  }, [plan, activeDayPlan, hotel, mode, cityId, mapReady, geometryRetry])

  /* ============================================================
   * 6) 路线图层：折线（白描边 + 浅蓝主色）+ 时长徽标 + 流动箭头
   *    每次重算整体重建 —— 段数只有 N+1，重建成本极低且不会残留旧线
   * ============================================================ */
  useEffect(() => {
    const AMap = AMapRef.current
    const map = mapRef.current
    if (!AMap || !map) return

    for (const overlay of routeOverlaysRef.current) overlay.setMap(null)
    routeOverlaysRef.current = []
    flowRef.current?.clear()

    const day = activeDayPlan
    if (!plan || !day || !day.stops.length) return

    displayedRoutes.forEach(({ path, leg, mode: legMode, verified, statsEstimated }, index) => {
      const isReturn = index >= day.stops.length
      const style = modeStyle(legMode)

      const isSelected = selectedLeg === index
      if (path.length > 1) {
        // 白色描边打底，让浅蓝主线在灰白底图上依然清晰
        const casing = verified ? new AMap.Polyline({
          path,
          strokeColor: '#ffffff',
          strokeWeight: 14,
          strokeOpacity: 0.92,
          lineJoin: 'round',
          lineCap: 'round',
          zIndex: 120,
          bubble: false,
        }) : null
        const line = new AMap.Polyline({
          path,
          strokeColor: verified ? (isSelected ? '#1d4ed8' : ROUTE_COLOR) : '#94a3b8',
          strokeWeight: verified ? (isSelected ? 12 : 10) : 3,
          strokeOpacity: verified ? 0.92 : 0.65,
          strokeStyle: verified ? 'solid' : 'dashed',
          strokeDasharray: [8, 8],
          lineJoin: 'round',
          lineCap: 'round',
          // 方向交给序号与时间轴表达，折线保持干净的实线
          showDir: false,
          zIndex: 121,
          bubble: false,
        })
        casing?.setMap(map)
        line.setMap(map)
        if (casing) routeOverlaysRef.current.push(casing)
        routeOverlaysRef.current.push(line)

        const midpoint = path[Math.floor(path.length / 2)]
        line.on('click', () => {
          lastOverlayClickAtRef.current = Date.now()
          useTripStore.getState().setSelectedLeg(index)
          infoWindowRef.current?.setContent(
            infoWindowHtml(`第 ${index + 1} 段 · ${style.label}`, [
              isReturn ? '返回酒店' : `前往 ${day.stops[index].name}`,
              leg && verified
                ? `${statsEstimated ? '估算：' : ''}${leg.durationMin} 分钟 / ${leg.distanceKm} km / ${leg.cost} 元`
                : '',
              !verified ? '路线未确认：虚线仅连接地点，不表示实际可通行路径' : '',
              verified && statsEstimated ? '地图已补齐路线形状，时长与费用仍为规划估算' : '',
            ].filter(Boolean)),
          )
          infoWindowRef.current?.open(map, midpoint)
        })
      }

      // 交通方式徽标放在这段折线的中间
      const anchor = path.length ? path[Math.floor(path.length / 2)] : null
      if (anchor) {
        const text = !verified ? '路线未确认' : `${isReturn ? '回程 · ' : ''}${statsEstimated ? '约' : ''}${Math.round(leg?.durationMin ?? 0)} 分`
        const marker = new AMap.Marker({
          position: anchor,
          anchor: 'center',
          content: createLegBadgeEl(text),
          zIndex: 260 + index,
          bubble: false,
        })
        marker.setMap(map)
        routeOverlaysRef.current.push(marker)
      }
    })

    // 真实路网折线才做流动箭头（两点直线 = 离线估算，不伪装成真实路径）
    const actualPaths = displayedRoutes.filter(item => item.verified).map(item => item.path)
    if (actualPaths.some((path) => path.length > 2)) {
      if (!flowRef.current) flowRef.current = new RouteFlow(AMap, map)
      flowRef.current.setPaths(actualPaths)
    }

    // 把整条路线框进视野
    fitToPoints([hotel, ...day.stops])
  }, [plan, activeDayPlan, mode, hotel, mapReady, displayedRoutes, selectedLeg])

  /* ============================================================
   * 7) 等时圈图层（模块 3）：酒店 15/30/45 分钟可达范围
   *    大圈先画、小圈压在上面，保证颜色叠加关系正确
   * ============================================================ */
  useEffect(() => {
    const AMap = AMapRef.current
    const map = mapRef.current
    if (!AMap || !map) return

    for (const overlay of isochroneOverlaysRef.current) overlay.setMap(null)
    isochroneOverlaysRef.current = []

    if (!isochroneVisible || !isochrone?.bands?.length) return

    const bands = [...isochrone.bands].sort((a, b) => b.minutes - a.minutes)
    for (const band of bands) {
      if (!band.polygon?.length) continue
      const color = bandColor(band.minutes)
      const polygon = new AMap.Polygon({
        path: band.polygon,
        strokeColor: color,
        strokeWeight: 1,
        strokeOpacity: 0.45,
        strokeStyle: 'solid',
        fillColor: color,
        fillOpacity: 0.07,
        zIndex: 30,
        bubble: false,
      })
      polygon.setMap(map)
      isochroneOverlaysRef.current.push(polygon)
    }
  }, [isochrone, isochroneVisible, mapReady])

  /* ============================================================
   * 渲染
   * ============================================================ */
  if (!hasAmapKey) return <MissingKeyCard />

  return (
    <div className="relative h-full w-full">
      {/* 地图容器必须一直挂着，否则 AMap 拿不到 DOM */}
      <div ref={containerRef} className="h-full w-full bg-slate-200" />

      {booting && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-100/80">
          <div className="rounded-lg bg-white px-4 py-3 text-sm text-slate-600 shadow-panel">
            正在加载高德地图…
          </div>
        </div>
      )}

      {initError && (
        <div className="absolute left-1/2 top-4 z-20 w-[min(560px,90%)] -translate-x-1/2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-700 shadow-panel">
          <div className="font-semibold">地图加载失败：{initError}</div>
          <div className="mt-1 text-red-600">
            常见原因：Key 类型不是「Web端(JS API)」、未填写安全密钥、Key 的域名白名单不含
            127.0.0.1、或当日配额用尽。修好后刷新页面即可。
          </div>
        </div>
      )}

      <MapLegend />
      {displayedRoutes.length > 0 && (unverifiedCount > 0 || estimatedCount > 0) && (
        <div role="status" className="absolute bottom-40 left-4 right-4 z-10 max-w-sm rounded-lg border border-amber-200 bg-amber-50/95 px-3 py-2 text-[11px] leading-5 text-amber-900 shadow-panel">
          {unverifiedCount > 0 ? <>
            <p>{geometryLoading ? '正在补查实际路线。' : ''}仍有 {unverifiedCount} 段未确认，灰色虚线仅表示地点顺序，不代表可通行道路。</p>
            {!geometryLoading && <button type="button" className="mt-1 underline underline-offset-2" onClick={() => setGeometryRetry(value => value + 1)}>重试路线查询</button>}
            {displayedRoutes.some(item => item.error) && <p className="mt-1">{displayedRoutes.find(item => item.error)?.error}</p>}
          </> : <p>路线形状已补齐；部分时长和费用仍为估算，请在工作台重新编译核实。</p>}
        </div>
      )}
    </div>
  )
}



