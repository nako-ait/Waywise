/**
 * 路线上的「流动箭头」。
 *
 * 高德 JS API 2.0 的 Polyline 支持虚线（strokeDasharray），但**不支持** dashoffset，
 * 没法靠改虚线偏移做流动动画；所以这里用最朴素也最可靠的办法：
 * 沿路径摆一串小箭头 Marker，用 requestAnimationFrame 逐帧推进它们的弧长位置，
 * 并按当前线段的方位角让箭头自动转向 —— 视觉上就是一路向前流动的方向指示。
 *
 * 注意：只有真实路网折线（点数 > 2）才做流动；两点直线（离线估算）不流动，
 * 免得把「估算」伪装成「真实路径」。
 */
import type { LngLatPath } from './routeGeometry'

interface Segment {
  a: [number, number]
  b: [number, number]
  len: number
  /** 方位角（正北顺时针，度） */
  bearing: number
}

interface FlowItem {
  marker: any
  segments: Segment[]
  total: number
  /** 0~1 的弧长进度 */
  progress: number
  /** 每秒推进的进度 */
  speed: number
}

/** 粗略把「度」换成公里（上海纬度附近 1 度 ≈ 111km，经度已按 cos 修正） */
const DEG_TO_KM = 111

/** 箭头间距（公里）：密度按长度算，长短路段的「每公里箭头数」才一致 */
const SPACING_KM = 0.28

/** 箭头前进速度（公里/秒）：与段长无关，所以各段的流动观感一致 */
const SPEED_KM_PER_SEC = 0.32

function buildSegments(path: LngLatPath): { segments: Segment[]; total: number } {
  const segments: Segment[] = []
  let total = 0
  for (let i = 1; i < path.length; i += 1) {
    const [lng1, lat1] = path[i - 1]
    const [lng2, lat2] = path[i]
    const midLat = ((lat1 + lat2) / 2) * (Math.PI / 180)
    const dx = (lng2 - lng1) * Math.cos(midLat)
    const dy = lat2 - lat1
    const len = Math.hypot(dx, dy)
    if (len <= 0) continue
    segments.push({
      a: [lng1, lat1],
      b: [lng2, lat2],
      len,
      bearing: (Math.atan2(dx, dy) * 180) / Math.PI,
    })
    total += len
  }
  return { segments, total }
}

function pointAt(segments: Segment[], total: number, progress: number): { point: [number, number]; bearing: number } {
  const target = Math.min(Math.max(progress, 0), 1) * total
  let walked = 0
  for (const segment of segments) {
    if (walked + segment.len >= target) {
      const ratio = segment.len === 0 ? 0 : (target - walked) / segment.len
      return {
        point: [
          segment.a[0] + (segment.b[0] - segment.a[0]) * ratio,
          segment.a[1] + (segment.b[1] - segment.a[1]) * ratio,
        ],
        bearing: segment.bearing,
      }
    }
    walked += segment.len
  }
  const last = segments[segments.length - 1]
  return { point: last.b, bearing: last.bearing }
}

/**
 * 流动箭头：白色「>」形，尺寸小于线宽，所以它「包」在路线条带内部，
 * 视觉上像线条本身在往前推，而不是贴了一圈图标。
 */
function chevronEl(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'tc-flow'
  el.innerHTML =
    '<svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">' +
    '<path d="M4.1 3.1 L7.5 5.5 L4.1 7.9" fill="none" stroke="#ffffff" stroke-width="2.1" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>'
  return el
}

export class RouteFlow {
  private readonly AMap: any
  private readonly map: any
  private items: FlowItem[] = []
  private raf = 0
  private lastTime = 0
  private running = false

  constructor(AMap: any, map: any) {
    this.AMap = AMap
    this.map = map
  }

  /**
   * 重设要流动的路径。
   * 只接受真实路网折线（点数 > 2）；每段按长度决定箭头数量与速度。
   */
  setPaths(paths: LngLatPath[]) {
    this.clear()
    if (!this.map || !this.AMap) return

    for (const path of paths) {
      if (!path || path.length < 3) continue
      const { segments, total } = buildSegments(path)
      if (!segments.length || total <= 0) continue

      const km = total * DEG_TO_KM
      // 密度恒定：约每 0.28km 一个（不再对长段砍到 14 个、短段硬塞 3 个）
      const count = Math.max(1, Math.min(48, Math.round(km / SPACING_KM)))
      // 速度按公里/秒算，所以长短路段的流动快慢一致
      const speed = SPEED_KM_PER_SEC / Math.max(km, 0.05)
      for (let i = 0; i < count; i += 1) {
        const marker = new this.AMap.Marker({
          position: segments[0].a,
          anchor: 'center',
          content: chevronEl(),
          zIndex: 140,
          bubble: false,
          extData: { kind: 'flow' },
        })
        marker.setMap(this.map)
        this.items.push({
          marker,
          segments,
          total,
          progress: i / count,
          speed,
        })
      }
    }

    if (this.items.length) this.start()
  }

  private tick = (time: number) => {
    if (!this.running) return
    if (this.lastTime === 0) this.lastTime = time
    const elapsed = time - this.lastTime

    // 30fps 足够顺滑：点位多时把一半的帧省下来给地图渲染
    if (!document.hidden && elapsed >= 32) {
      const dt = Math.min(0.1, elapsed / 1000)
      this.lastTime = time
      for (const item of this.items) {
        item.progress = (item.progress + item.speed * dt) % 1
        const { point, bearing } = pointAt(item.segments, item.total, item.progress)
        item.marker.setPosition(point)
        // 箭头图形默认朝右（正东），所以方位角要减 90° 才对齐行进方向
        item.marker.setAngle(bearing - 90)
      }
    }
    this.raf = window.requestAnimationFrame(this.tick)
  }

  private start() {
    if (this.running) return
    this.running = true
    this.lastTime = 0
    this.raf = window.requestAnimationFrame(this.tick)
  }

  stop() {
    this.running = false
    if (this.raf) window.cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  clear() {
    this.stop()
    for (const item of this.items) item.marker.setMap(null)
    this.items = []
  }

  destroy() {
    this.clear()
  }
}
