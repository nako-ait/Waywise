/**
 * 地图实例的模块级单例。
 *
 * 为什么不放进 Zustand？—— AMap.Map 是庞大的可变对象，塞进 store 会让
 * 「状态变更 -> 渲染 -> diff」这条链路变得不可控，也容易触发无意义的 re-render。
 * 这里用模块变量持有实例，组件通过 getMap() 拿到命令式句柄做视野联动。
 */

let mapInstance: any = null
let amapInstance: any = null

export function setMapInstance(map: any, AMap: any): void {
  mapInstance = map
  amapInstance = AMap
}

export function clearMapInstance(): void {
  mapInstance = null
}

export function getMap(): any {
  return mapInstance
}

export function getAMap(): any {
  return amapInstance
}

/** 平滑移动视野到某个坐标 */
export function panTo(lng: number, lat: number, zoom?: number): void {
  const map = mapInstance
  if (!map) return
  const z = zoom ?? Math.max(map.getZoom?.() ?? 12, 15)
  map.setZoomAndCenter(z, [lng, lat], false, 420)
}

/** 自适应视野：把所有点都框进屏幕 */
export function fitToPoints(
  points: Array<{ lng: number; lat: number }>,
  padding: [number, number, number, number] = [80, 80, 80, 80],
): void {
  const map = mapInstance
  if (!map || !points.length) return
  if (points.length === 1) {
    panTo(points[0].lng, points[0].lat, 15)
    return
  }
  map.setFitView(undefined, false, padding, 16)
}
