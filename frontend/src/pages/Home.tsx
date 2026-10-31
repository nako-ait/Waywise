import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { CITIES, getCity } from '@/data/cities'
import { resolveInspiration, type Inspiration } from '@/data/inspiration'
import PhotoOrbit from '@/components/PhotoOrbit'
import { clearChatHistory, DRAFT_CHAT_KEY } from '@/lib/chatHistory'
import { loadInspiration } from '@/lib/loadInspiration'
import { useTripStore } from '@/store/useTripStore'
import './Home.css'

type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> }
}

export default function Home() {
  const navigate = useNavigate()
  const trips = useTripStore((s) => s.trips)
  const currentCityId = useTripStore((s) => s.cityId)
  const [selected, setSelected] = useState<Inspiration | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [cityId, setCityId] = useState(currentCityId)
  const [prompt, setPrompt] = useState('')
  const [opening, setOpening] = useState<string | null>(null)
  const panel = useRef<HTMLElement>(null)
  const focusReturn = useRef<HTMLElement | null>(null)
  const resolved = selected ? resolveInspiration(selected) : null
  const city = resolved?.city ?? getCity(cityId)

  const close = useCallback(() => {
    setPanelOpen(false)
    if (panel.current?.contains(document.activeElement)) focusReturn.current?.focus()
  }, [])
  const preview = useCallback((item: Inspiration) => {
    if (document.activeElement instanceof HTMLElement && document.activeElement.matches('.waywise-photo')) focusReturn.current = document.activeElement
    setSelected(item); setCityId(item.cityId); setPanelOpen(true)
  }, [])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [close])

  const open = useCallback((item: Inspiration) => {
    if (opening) return
    try {
      resolveInspiration(item)
      const go = () => {
        loadInspiration(item)
        navigate('/plan', { state: { presetName: item.title, compilePreset: true } })
      }
      const doc = document as TransitionDocument
      if (doc.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        flushSync(() => setOpening(item.id))
        doc.startViewTransition(() => flushSync(go)).finished.catch(() => {})
      } else go()
    } catch (error) {
      setOpening(null)
      useTripStore.getState().showToast('error', error instanceof Error ? error.message : '路线暂时无法打开')
    }
  }, [navigate, opening])

  function custom() {
    focusReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelected(null); setCityId(currentCityId); setPanelOpen(true)
    requestAnimationFrame(() => panel.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus())
  }

  function start(event: FormEvent) {
    event.preventDefault()
    const text = prompt.trim()
    if (!text || opening) return
    const state = useTripStore.getState()
    if (selected) loadInspiration(selected, text)
    else {
      state.setCity(cityId); state.startNewTrip()
      state.setFullTripState({ cityId, hotel: getCity(cityId).hotel, destinations: [], mode: 'transit', days: 1 })
      state.setPendingPrompt(text)
      clearChatHistory(DRAFT_CHAT_KEY)
    }
    navigate('/plan', { state: selected ? { presetName: selected.title } : null })
  }

  return (
    <div className={`waywise-home ${panelOpen ? 'waywise-home--assistant' : ''}`}>
      <PhotoOrbit onPreview={preview} onOpen={open} onClearPreview={close} onCustom={custom} />
      <aside ref={panel} className="waywise-home-assistant" aria-label="Waywise 旅行助手" aria-hidden={!panelOpen}>
        <div className="waywise-assistant-heading">
          <span><span className="waywise-spark" aria-hidden="true">✧</span> Waywise 旅行助手</span>
          <button type="button" onClick={close} aria-label="收起旅行助手">×</button>
        </div>
        <div className="waywise-assistant-content">
          {selected && resolved ? (
            <>
              <span className="waywise-eyebrow">{city.name} / 一张照片，一段旅程</span>
              <h2>{selected.title}</h2><p>{selected.description}</p>
              <img className="waywise-assistant-cover" src={selected.image} alt={`${city.name}旅行摄影`} />
              <a className="waywise-photo-credit" href={selected.source} target="_blank" rel="noopener noreferrer">
                {selected.photographer === 'Unsplash photographer' ? '照片原页' : selected.photographer} / Unsplash ↗
              </a>
              <div className="waywise-preset-meta"><span>{selected.days} 天</span>{selected.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              <p className="waywise-route-origin">从 {resolved.route.hotel.name.replace(/ · .*$/, '')} 出发</p>
              <ol className="waywise-preset-stops">{resolved.pois.map((poi) => <li key={poi.name}>{poi.name}</li>)}</ol>
              <button className="waywise-open-route" type="button" disabled={Boolean(opening)} onClick={() => open(selected)}>{opening ? '正在打开…' : '打开这条路线'} <span aria-hidden="true">↗</span></button>
              <p className="waywise-route-note">进入工作台后计算交通与时间，也可以继续调整地点和偏好。</p>
            </>
          ) : (
            <>
              <span className="waywise-eyebrow">YOUR NEXT JOURNEY</span>
              <h2>今天，想去哪里走走？</h2><p>告诉我目的地、时间和偏好，一起把旅程安排得更从容。</p>
              <label className="waywise-city-label">目的地城市<select value={cityId} onChange={(e) => setCityId(e.target.value)} aria-label="目的地城市">{CITIES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              {trips.length > 0 && <div className="waywise-recent"><h3>接着上次的旅程</h3>{trips.slice(0, 3).map((trip) => <button key={trip.id} type="button" onClick={() => navigate(`/trip/${trip.id}`)}>{trip.title}<span aria-hidden="true">↗</span></button>)}</div>}
            </>
          )}
        </div>
        <form className="waywise-home-composer" onSubmit={start}>
          <label htmlFor="waywise-home-prompt">{selected ? '想让这条路线更适合你？' : `在${city.name}，你想怎么玩？`}</label>
          <textarea id="waywise-home-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder="比如：少走路，下午早点回来…" onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && prompt.trim()) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} />
          <div className="waywise-composer-actions"><div>{['少走路', '多拍照'].map((chip) => <button key={chip} type="button" onClick={() => setPrompt((value) => value ? `${value}，${chip}` : chip)}>{chip}</button>)}</div><button className="waywise-send" type="submit" disabled={!prompt.trim() || Boolean(opening)} aria-label="把想法交给 Waywise">↑</button></div>
        </form>
      </aside>
      <div className="waywise-home-quick"><button type="button" onClick={custom}>用自己的想法出发 <span aria-hidden="true">↗</span></button>{trips.length > 0 && <button type="button" onClick={() => navigate(`/trip/${trips[0].id}`)}>继续上次的旅程 ↗</button>}</div>
      <span className="sr-only" role="status">{opening ? '正在打开推荐路线' : ''}</span>
    </div>
  )
}
