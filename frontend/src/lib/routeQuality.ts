import type { PlanResponse } from '@/types'

const ROUTING_DATA_VERSION = 'multicity-endpoints-20261102'

export function needsTransportRefresh(plan: PlanResponse): boolean {
  if (plan.solver?.routingVersion !== ROUTING_DATA_VERSION) return true
  return plan.days.some((day) => [...day.stops.map((s) => s.transportFromPrev), day.returnLeg].some((leg) => {
    if (!leg || !['taxi', 'drive'].includes(leg.transportMode ?? leg.mode)) return false
    const queried = leg.queriedAt ? Date.parse(leg.queriedAt) : NaN
    return !Number.isFinite(queried) || Date.now() - queried > 5 * 60 * 1000
  }))
}
