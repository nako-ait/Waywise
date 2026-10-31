import catalog from './inspirationCatalog.json'
import { CITIES, resolveRoutePois, type CityRoute } from './cities'
import type { TravelMode } from '@/types'

export interface Inspiration {
  id: string
  cityId: string
  cityName: string
  title: string
  description: string
  poiNames: string[]
  mode: TravelMode
  days: number
  tags: string[]
  image: string
  photographer: string
  source: string
}

export const INSPIRATIONS: Inspiration[] = catalog.map((item) => ({
  ...item, mode: item.mode as TravelMode,
}))

/** Resolve the entire preset before touching a user's current draft. */
export function resolveInspiration(item: Inspiration) {
  const city = CITIES.find((candidate) => candidate.id === item.cityId)
  if (!city) throw new Error('这条路线的城市暂不可用')
  const route: CityRoute = {
    id: item.id, name: item.title, desc: item.description,
    hotel: { ...city.hotel }, days: item.days, mode: item.mode,
    poiNames: item.poiNames,
  }
  const pois = resolveRoutePois(city, route)
  if (!pois.length || pois.length !== item.poiNames.length) {
    throw new Error('这条路线的地点尚未准备完整，请换一条试试')
  }
  return { city, route, pois }
}
