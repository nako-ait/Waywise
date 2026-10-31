import { resolveInspiration, type Inspiration } from '@/data/inspiration'
import { clearChatHistory, DRAFT_CHAT_KEY } from './chatHistory'
import { DEFAULT_OPTIONS, useTripStore } from '@/store/useTripStore'
import { DEFAULT_WEIGHTS } from '@/types'

/** Start a new draft. Saved journeys and their chat archives stay intact. */
export function loadInspiration(item: Inspiration, prompt?: string) {
  const { city, route, pois } = resolveInspiration(item)
  const state = useTripStore.getState()
  state.setCity(city.id)
  state.startNewTrip()
  state.setFullTripState({
    cityId: city.id,
    hotel: { ...route.hotel, address: city.name },
    destinations: pois.map((poi) => ({
      ...poi, source: 'import', selected: true, address: poi.district,
    })),
    days: route.days, mode: route.mode, legModes: {},
    weights: { ...DEFAULT_WEIGHTS }, options: { ...DEFAULT_OPTIONS },
  })
  state.setSelectedLeg(null)
  state.setPendingPrompt(prompt?.trim() || null)
  clearChatHistory(DRAFT_CHAT_KEY)
  return { city, route }
}
