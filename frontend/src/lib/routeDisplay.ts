import type { Hotel, PlanDay, TransportLeg } from '@/types'
import type { LegGeometry, LngLatPath } from './routeGeometry'
import { dayEndPoint } from './tripEndpoints'

export function usablePath(path: unknown): path is LngLatPath {
  return Array.isArray(path) && path.length >= 2 && path.every(point =>
    Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]))
}

/** Matrix provenance does not establish that an individual route was fetched. */
export function verifiedServerPath(leg: TransportLeg | null | undefined, path: unknown): boolean {
  return usablePath(path) && leg?.dataSource === 'amap' && leg.approx === false
}

export function displayRoutes(day: PlanDay, origin: Hotel, fallbackMode: string, client: Array<LegGeometry | null> = [], fallbackPaths: LngLatPath[] = []) {
  const end = dayEndPoint(day, origin)
  const points = [origin, ...day.stops, ...(end ? [end] : [])]
  return points.slice(1).map((to, index) => {
    const leg = index < day.stops.length ? day.stops[index].transportFromPrev : day.returnLeg
    const mode = leg?.transportMode ?? leg?.mode ?? fallbackMode
    const serverPath = day.polylines?.[index] ?? fallbackPaths[index]
    const recovered = client[index]
    const serverVerified = verifiedServerPath(leg, serverPath)
    const clientVerified = recovered?.resolvedMode === mode && usablePath(recovered.path)
    const straight: LngLatPath = [[points[index].lng, points[index].lat], [to.lng, to.lat]]
    return {
      leg, mode, verified: serverVerified || clientVerified,
      statsEstimated: leg?.dataSource !== 'amap' || leg?.approx !== false,
      path: serverVerified ? serverPath! : clientVerified ? recovered!.path : straight,
      error: !serverVerified && !clientVerified ? recovered?.error : undefined,
    }
  })
}
