import { useEffect, useRef, useState } from 'react'
import { hasAmapKey, loadAMap, reverseGeocode } from '@/lib/amap'
import { blockPropagation, escapeHtml } from '@/lib/dom'
import { clearMapInstance, fitToPoints, setMapInstance } from '@/lib/mapInstance'
import { useOrderMap, useDayScope } from '@/lib/routeOrder'
import { bandColor, modeStyle } from '@/lib/routeStyle'
import { poiIcon } from '@/lib/poiIcon'
import { useTripStore } from '@/store/useTripStore'
import MapLegend from './MapLegend'
import MissingKeyCard from './MissingKeyCard'

/* ------------------------------------------------------------------
 * 标记 DOM 工厂
 * AMap Marker 的 content 是高德自己插进地图容器的原生 DOM，
 * 这里用原生 DOM + 独立 CSS 类（见 src/index.css 的 .tc-pin）。
 * ------------------------------------------------------------------ */

/** 名称标签（浮在标记上方）：图标 + 地名 */
function labelHtml(icon: string, name: string): string {
  return (
    `<div class="tc-pin__label">` +
    `<span class="tc-pin__label-icon">${escapeHtml(icon)}</span>` +
    `<span class="tc-pin__label-text">${escapeHtml(name)}</span>` +
    `</div>`
  )
}

/** 酒店：绿色圆角方形徽标 + 🏨 + 地名（固定起点 / 终点） */
function createHotelPinEl(name: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'tc-pin tc-pin--hotel'
  el.innerHTML =
    labelHtml('🏨', name) +
    `<div class="tc-pin__head">🏨</div>` +
    `<div class="tc-pin__tail"></div>`
  // ⚠️ 关键：标记上的事件必须阻止冒泡，否则地图 click 会紧接着触发，
  //    于是「点标记」变成「点标记 + 在该处新增一个候选点」。
  blockPropagation(el)
  return el
}

/** 选中目的地：橙色水滴形地图针（针头里是序号）+ 带分类图标的地名标签 */
function createPickedPinEl(
  order: number,
  name: string,
  icon: string,
  showLabel = true,
): HTMLElement {
  const el = document.createElement('div')
  el.className = 'tc-pin tc-pin--poi'
  el.innerHTML =
    (showLabel ? labelHtml(icon, name) : '') +
    `<div class="tc-pin__head">${order}</div>` +
    `<div class="tc-pin__tail"></div>`
  blockPropagation(el)
  return el
}

/**
 * 候选目的地（未选中）：灰色圆形 + 灰度分类图标 + 地名标签。
 *
 * showLabel=false 时退化为一个纯图标小圆（点多了可以关掉标签，避免地图太挤）。
 * 带标签时外面套一层 .tc-cand-wrap（30×30，标签绝对定位浮在上方），
 * 这样 anchor:'center' 依然对准圆心。
 *
 * 这里用 HTML Marker 而不是 CircleMarker，是为了能带图标与标签；
 * 代价是点位特别多（>200）时性能不如 canvas 的 CircleMarker / MassMarks。
 */
function createCandidatePinEl(icon: string, name: string, showLabel = true): HTMLElement {
  const circle = `<div class="tc-cand"><span class="tc-cand__icon">${escapeHtml(icon)}</span></div>`
  if (!showLabel) {
    const el = document.createElement('div')
    el.className = 'tc-cand'
    el.title = name
    el.innerHTML = `<span class="tc-cand__icon">${escapeHtml(icon)}</span>`
    blockPropagation(el)
    return el
  }
  const wrap = document.createElement('div')
  wrap.className = 'tc-cand-wrap'
  wrap.innerHTML = labelHtml(icon, name) + circle
  blockPropagation(wrap)
  return wrap
}

/** 路线上的交通方式徽标（图标 + 分钟数），挂在每一段折线的中间点 */
function createLegBadgeEl(icon: string, text: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'tc-leg'
  el.innerHTML =
    `<span class="tc-leg__icon">${escapeHtml(icon)}</span>` +
    `<span class="tc-leg__text">${escapeHtml(text)}</span>`
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
 *  1) 酒店蓝色标记固定不可取消 —— 酒店数据独立于 destinations，UI 无删除入口。
 *  2) 目的地也有图标，且与酒店明显不同：
 *       酒店     = 蓝色圆角方形徽标 + 🏨（带呼吸动画）
 *       已选目的地 = 橙色水滴形地图针 + 序号 + 分类图标标签
 *       候选目的地 = 灰色小圆 + 灰度分类图标（常显，点一下即变橙色针）
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
  /** 兜底防冒泡：最近一次「点到标记」的时间戳 */
  const lastOverlayClickAtRef = useRef(0)

  const [booting, setBooting] = useState(true)
  const [initError, setInitError] = useState<string | null>(null)

  // 只订阅稳定引用，派生数组在下面用 useMemo/局部变量算
  const destinations = useTripStore((s) => s.destinations)
  const hotel = useTripStore((s) => s.hotel)
  const mapReady = useTripStore((s) => s.mapReady)
  const plan = useTripStore((s) => s.plan)
  const mode = useTripStore((s) => s.mode)
  const isochrone = useTripStore((s) => s.isochrone)
  const isochroneVisible = useTripStore((s) => s.isochroneVisible)
  /** 地图标记是否显示地名标签 */
  const showLabels = useTripStore((s) => s.showLabels)
  /** 序号来源：有路书按路线顺序，没有则按选中顺序 */
  const orderMap = useOrderMap()
  /** 多日模式：只高亮「当前这一天」，其他天的点退回灰色候选态 */
  const { day: activeDayPlan, dayIds } = useDayScope()

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

        map.on('click', handleMapClick)
        map.on('moveend', persistView)
        map.on('zoomend', persistView)

        setBooting(false)
        useTripStore.getState().setMapReady(true)

        // 清理函数需要拿到这两个 handler，挂到 map 实例上带出去
        ;(map as any).__tcHandlers = { handleMapClick, persistView }
      })
      .catch((err: unknown) => {
        if (disposed) return
        setBooting(false)
        setInitError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      disposed = true
      const map = mapRef.current
      if (map) {
        const handlers = (map as any).__tcHandlers
        if (handlers) {
          map.off('click', handlers.handleMapClick)
          map.off('moveend', handlers.persistView)
          map.off('zoomend', handlers.persistView)
        }
        map.clearMap()
        map.destroy()
      }
      mapRef.current = null
      AMapRef.current = null
      infoWindowRef.current = null
      hotelMarkerRef.current = null
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
          infoWindowHtml('🏨 ' + hotel.name, [
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
  }, [hotel, mapReady])

  /* ============================================================
   * 3) 候选点图层：灰色圆形图标（带分类 emoji，灰度处理）
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
      const icon = poiIcon(d.tags)
      const meta = `${showLabels}|${icon}|${d.name}`
      const exist = candidateMarkersRef.current.get(d.id)
      if (exist) {
        exist.setPosition([d.lng, d.lat])
        // 开关标签、改名、换图标时才重设内容，避免每次 setContent 闪一下
        if (candidateMetaRef.current.get(d.id) !== meta) {
          exist.setContent(createCandidatePinEl(icon, d.name, showLabels))
          candidateMetaRef.current.set(d.id, meta)
        }
        continue
      }
      const marker = new AMap.Marker({
        position: [d.lng, d.lat],
        anchor: 'center', // 圆心即坐标点
        content: createCandidatePinEl(icon, d.name, showLabels),
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
  }, [destinations, dayIds, showLabels, mapReady])

  /* ============================================================
   * 4) 选中点图层：橙色带序号（单独渲染，序号 = 选中顺序）
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
      const icon = poiIcon(d.tags)
      const meta = `${order}|${d.name}|${icon}|${showLabels}`
      const exist = pickedMarkersRef.current.get(d.id)

      if (exist) {
        exist.setPosition([d.lng, d.lat])
        // 序号 / 名称 / 图标 / 标签开关变了才重设内容（否则每次 setContent 会闪一下）
        if (pickedMetaRef.current.get(d.id) !== meta) {
          exist.setContent(createPickedPinEl(order, d.name, icon, showLabels))
          pickedMetaRef.current.set(d.id, meta)
        }
        return
      }

      const marker = new AMap.Marker({
        position: [d.lng, d.lat],
        anchor: 'bottom-center',
        content: createPickedPinEl(order, d.name, icon, showLabels),
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
  }, [destinations, dayIds, orderMap, showLabels, mapReady])

  /* ============================================================
   * 5) 路线图层：折线（白描边 + 方式配色 + 方向箭头）+ 交通方式徽标
   *    每次重算整体重建 —— 段数只有 N+1，重建成本极低且不会残留旧线
   * ============================================================ */
  useEffect(() => {
    const AMap = AMapRef.current
    const map = mapRef.current
    if (!AMap || !map) return

    for (const overlay of routeOverlaysRef.current) overlay.setMap(null)
    routeOverlaysRef.current = []

    const day = activeDayPlan
    if (!plan || !day || !day.stops.length) return

    const legs = day.polylines ?? plan.polylines ?? []
    const fallbackMode = plan.solver?.mode ?? mode

    legs.forEach((path, index) => {
      const isReturn = index >= day.stops.length
      const leg = isReturn ? null : day.stops[index].transportFromPrev
      const style = modeStyle(leg?.mode ?? fallbackMode)

      if (path.length > 1) {
        // 白色描边打底，让彩色主线在任何底图上都清晰
        const casing = new AMap.Polyline({
          path,
          strokeColor: '#ffffff',
          strokeWeight: 9,
          strokeOpacity: 0.85,
          lineJoin: 'round',
          lineCap: 'round',
          zIndex: 120,
          bubble: false,
        })
        const line = new AMap.Polyline({
          path,
          strokeColor: style.color,
          strokeWeight: 5,
          strokeOpacity: 0.95,
          lineJoin: 'round',
          lineCap: 'round',
          showDir: true, // 方向箭头：一眼看出行进方向
          zIndex: 121,
          bubble: false,
        })
        casing.setMap(map)
        line.setMap(map)
        routeOverlaysRef.current.push(casing, line)

        const midpoint = path[Math.floor(path.length / 2)]
        line.on('click', () => {
          lastOverlayClickAtRef.current = Date.now()
          infoWindowRef.current?.setContent(
            infoWindowHtml(`第 ${index + 1} 段 · ${style.label}`, [
              isReturn ? '返回酒店' : `前往 ${day.stops[index].name}`,
              leg
                ? `${leg.durationMin} 分钟 / ${leg.distanceKm} km / ${leg.cost} 元`
                : '返回酒店段',
              leg?.approx ? '该折线为直线近似（离线估算）' : '',
            ].filter(Boolean)),
          )
          infoWindowRef.current?.open(map, midpoint)
        })
      }

      // 交通方式徽标放在这段折线的中间
      const anchor = path.length ? path[Math.floor(path.length / 2)] : null
      if (anchor) {
        const text = isReturn ? '回酒店' : `${Math.round(leg?.durationMin ?? 0)} 分`
        const marker = new AMap.Marker({
          position: anchor,
          anchor: 'center',
          content: createLegBadgeEl(style.icon, text),
          zIndex: 260 + index,
          bubble: false,
        })
        marker.setMap(map)
        routeOverlaysRef.current.push(marker)
      }
    })

    // 把整条路线框进视野
    fitToPoints([hotel, ...day.stops])
  }, [plan, activeDayPlan, mode, hotel, mapReady])

  /* ============================================================
   * 6) 等时圈图层（模块 3）：酒店 15/30/45 分钟可达范围
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
        strokeWeight: 1.5,
        strokeOpacity: 0.85,
        strokeStyle: 'dashed',
        fillColor: color,
        fillOpacity: 0.1,
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
    </div>
  )
}
