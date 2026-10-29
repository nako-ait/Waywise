/**
 * 导出「长图」：把一份路书渲染成一张竖图（1080 宽），用于发微信/朋友圈。
 *
 * 纯 Canvas 手绘，不引第三方库：标题 + 路线缩略图 + 按天时间轴 + 统计。
 * 地图不是截图（第三方 canvas 拿不到瓦片），而是把折线按 bounding box 缩放到画布上，
 * 作为"路线示意"——足够看出形状，也不会有版权/跨域问题。
 */
import type { Hotel, PlanResponse } from '@/types'

const WIDTH = 1080
const PAD = 56

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

interface Options {
  title?: string
  hotel: Hotel
  plan: PlanResponse
}

export function exportTripLongImage({ title, hotel, plan }: Options) {
  const days = plan.days ?? []
  const stopCount = days.reduce((sum, day) => sum + day.stops.length, 0)
  const lineHeight = 30

  // 先算高度
  let height = 300 // 头部 + 地图
  for (const day of days) height += 70 + day.stops.length * lineHeight + 24
  height += 140 // 统计 + 页脚

  const scale = 2 // 高分屏
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(scale, scale)

  // 背景
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, WIDTH, height)

  // 顶部标题区
  ctx.fillStyle = '#0f172a'
  ctx.font = '700 40px system-ui, "Microsoft YaHei", sans-serif'
  ctx.fillText(title?.trim() || `${hotel.name.replace(/ · .*$/, '')} · ${days.length} 日路书`, PAD, 92)

  const meta = plan.solver
  ctx.fillStyle = '#64748b'
  ctx.font = '400 20px system-ui, "Microsoft YaHei", sans-serif'
  const subtitle =
    `${hotel.name} 出发 · ${days.length} 天 · ${stopCount} 站 · ` +
    `${meta?.modeLabel ?? ''}${meta?.dataSource === 'amap' ? ' · 高德路线' : ' · 离线估算'}`
  ctx.fillText(subtitle, PAD, 126)

  // 路线示意
  const mapTop = 156
  const mapH = 120
  roundRect(ctx, PAD, mapTop, WIDTH - PAD * 2, mapH, 18)
  ctx.fillStyle = '#f4f6f8'
  ctx.fill()
  ctx.strokeStyle = '#e2e8f0'
  ctx.lineWidth = 2
  ctx.stroke()

  const polylines = plan.polylines ?? days.flatMap((day) => day.polylines ?? [])
  const points = polylines.flat()
  if (points.length > 1) {
    const lngs = points.map((p) => p[0])
    const lats = points.map((p) => p[1])
    const minLng = Math.min(...lngs)
    const maxLng = Math.max(...lngs)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const spanLng = Math.max(maxLng - minLng, 1e-4)
    const spanLat = Math.max(maxLat - minLat, 1e-4)
    const innerW = WIDTH - PAD * 2 - 40
    const innerH = mapH - 24
    const ratio = Math.min(innerW / spanLng, innerH / spanLat)
    const offsetX = PAD + 20 + (innerW - spanLng * ratio) / 2
    const offsetY = mapTop + 12 + (innerH - spanLat * ratio) / 2
    const toXY = (p: [number, number]): [number, number] => [
      offsetX + (p[0] - minLng) * ratio,
      offsetY + (maxLat - p[1]) * ratio,
    ]
    ctx.strokeStyle = '#60a5fa'
    ctx.lineWidth = 5
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    for (const line of polylines) {
      if (line.length < 2) continue
      ctx.beginPath()
      line.forEach((point, index) => {
        const [x, y] = toXY(point as [number, number])
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }
  }

  // 按天
  let cursor = mapTop + mapH + 54
  const statLine = (day: typeof days[number]) =>
    `步行 ${day.stats.totalWalkKm} km · 交通 ${Math.round(day.stats.totalTransitMin)} 分 · ¥${day.stats.totalCost}`

  for (const [dayIndex, day] of days.entries()) {
    ctx.fillStyle = '#0f172a'
    ctx.font = '600 24px system-ui, "Microsoft YaHei", sans-serif'
    const dayTitle = day.title || `第 ${dayIndex + 1} 天`
    ctx.fillText(`${dayTitle}　${day.date.slice(5)}`, PAD, cursor)
    ctx.fillStyle = '#94a3b8'
    ctx.font = '400 16px system-ui, "Microsoft YaHei", sans-serif'
    ctx.fillText(statLine(day), PAD + 240, cursor)
    cursor += 30

    for (const [stopIndex, stop] of day.stops.entries()) {
      ctx.fillStyle = '#e2e8f0'
      ctx.fillRect(PAD, cursor - 8, 3, lineHeight - 6)

      ctx.fillStyle = '#0f172a'
      ctx.beginPath()
      ctx.arc(PAD + 1.5, cursor + 2, 7, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = '#ffffff'
      ctx.font = '600 12px system-ui, sans-serif'
      ctx.fillText(String(stopIndex + 1), PAD - 3, cursor + 6)

      ctx.fillStyle = '#0f172a'
      ctx.font = '500 20px system-ui, "Microsoft YaHei", sans-serif'
      ctx.fillText(stop.name, PAD + 24, cursor + 8)

      ctx.fillStyle = '#64748b'
      ctx.font = '400 16px system-ui, "Microsoft YaHei", sans-serif'
      ctx.fillText(`${stop.arriveTime}–${stop.leaveTime}`, WIDTH - PAD - 120, cursor + 8)
      cursor += lineHeight
    }
    cursor += 24
  }

  // 统计 + 页脚
  cursor += 6
  const totals = plan.solver?.totalStats
  ctx.fillStyle = '#0f172a'
  ctx.font = '600 22px system-ui, "Microsoft YaHei", sans-serif'
  ctx.fillText(
    totals
      ? `全程：步行 ${totals.totalWalkKm} km · 交通 ${Math.round(totals.totalTransitMin)} 分 · ¥${totals.totalCost}`
      : '',
    PAD,
    cursor,
  )
  cursor += 40

  ctx.fillStyle = '#cbd5e1'
  ctx.font = '400 16px system-ui, "Microsoft YaHei", sans-serif'
  ctx.fillText(`路书编译师 · 上海 · ${new Date().toLocaleDateString('zh-CN')}`, PAD, cursor)

  // 下载
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${(title?.trim() || '路书').replace(/[\\/:*?"<>|]/g, '_')}.png`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
  }, 'image/png')
}
