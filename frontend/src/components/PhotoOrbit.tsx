import { useEffect, useRef, type CSSProperties } from 'react'
import { INSPIRATIONS, type Inspiration } from '@/data/inspiration'

interface Props {
  onPreview: (item: Inspiration) => void
  onOpen: (item: Inspiration) => void
  onClearPreview: () => void
  onCustom: () => void
}

const clamp = (n: number) => Math.max(0, Math.min(1, n))
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const ease = (t: number) => t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2

/** One animation clock for all photographs: radial geometry, no looping timers. */
export default function PhotoOrbit({ onPreview, onOpen, onClearPreview, onCustom }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const cards = useRef<Array<HTMLButtonElement | null>>([])
  const title = useRef<HTMLDivElement>(null)
  const replayRef = useRef<() => void>(() => {})
  const callbacks = useRef({ onPreview, onClearPreview })
  callbacks.current = { onPreview, onClearPreview }
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>()
  const entering = useRef(true)

  useEffect(() => {
    const container = scroller.current, scene = stage.current
    if (!container || !scene) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let raf = 0, cancelled = false, started = performance.now(), enter = true
    let progress = 0, target = 0, last = started
    let width = 0, height = 0
    const draw = (morph: number, scroll: number) => {
      if (width <= 760) return
      const radius = Math.min(300, height * .35, (width - 150) / 2)
      const zoom = ease(clamp(scroll * 1.85))
      const fan = ease(clamp((scroll - .43) / .57))
      const blend = ease(morph)
      cards.current.forEach((card, i) => {
        if (!card) return
        const angle = (-90 + i * 360 / INSPIRATIONS.length) * Math.PI / 180
        const line = (i - 15.5) * Math.min(30, (width - 100) / 31)
        const ringX = Math.cos(angle - (1 - blend) * .18) * radius * (1 + zoom * .8)
        const ringY = Math.sin(angle - (1 - blend) * .18) * radius * (1 + zoom * .8) + zoom * height * .31
        const fanX = (i - 15.5) * Math.min(31, width * .025)
        const x = mix(mix(line, ringX, blend), fanX, fan)
        const y = mix(ringY * blend, 20 - Math.cos((i / 31 - .5) * Math.PI) * 18, fan)
        card.style.setProperty('--photo-x', `${x.toFixed(2)}px`)
        card.style.setProperty('--photo-y', `${y.toFixed(2)}px`)
        card.style.setProperty('--photo-z', `${(fan * (i - 16) * 2).toFixed(2)}px`)
        card.style.setProperty('--photo-angle', `${mix(i * 360 / 32 * blend, -7, fan).toFixed(2)}deg`)
        card.style.setProperty('--photo-turn', `${(-28 * fan).toFixed(2)}deg`)
        card.style.setProperty('--photo-scale', `${mix(1 + zoom * .5, 2.3, fan).toFixed(3)}`)
      })
      if (title.current) title.current.style.opacity = `${clamp((blend - .6) / .4) * (1 - clamp(zoom * 1.5))}`
    }
    const tick = (now: number) => {
      if (cancelled) return
      const delta = Math.min(50, now - last); last = now
      const t = media.matches || width <= 760 ? 1 : clamp((now - started - 350) / 3500)
      entering.current = t < 1
      progress = mix(progress, target, 1 - Math.exp(-delta / 180))
      if (Math.abs(progress - target) < .0002) progress = target
      draw(enter ? t : 1, progress)
      scene.dataset.entering = String(t < 1)
      if (t < 1 || progress !== target) raf = requestAnimationFrame(tick)
      else raf = 0
    }
    const request = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick) } }
    const measure = () => {
      width = scene.clientWidth; height = scene.clientHeight
      if (width <= 760 || media.matches) { entering.current = false; enter = false }
      draw(enter ? clamp((performance.now() - started - 350) / 3500) : 1, progress)
      request()
    }
    const scroll = () => {
      target = media.matches || width <= 760 ? 0 : clamp(container.scrollTop / Math.max(1, height * 1.5))
      if (target > .02) { enter = false; entering.current = false; callbacks.current.onClearPreview() }
      request()
    }
    const replay = () => {
      container.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
      target = 0; progress = 0; enter = true; entering.current = !media.matches
      started = performance.now(); callbacks.current.onClearPreview(); request()
    }
    replayRef.current = replay
    const visibility = () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0 }
      else request()
    }
    const resize = new ResizeObserver(measure); resize.observe(scene)
    container.addEventListener('scroll', scroll, { passive: true })
    document.addEventListener('visibilitychange', visibility)
    media.addEventListener('change', measure)
    measure()
    return () => {
      cancelled = true; cancelAnimationFrame(raf); clearTimeout(hoverTimer.current)
      resize.disconnect(); container.removeEventListener('scroll', scroll)
      document.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', measure)
      replayRef.current = () => {}
    }
  }, [])

  function preview(item: Inspiration) {
    clearTimeout(hoverTimer.current)
    if (entering.current) return
    hoverTimer.current = setTimeout(() => callbacks.current.onPreview(item), 200)
  }

  return (
    <div ref={scroller} className="waywise-explore-scroll" aria-label="旅行灵感">
      <div className="waywise-orbit-story">
        <div ref={stage} className="waywise-orbit-stage">
          <div className="waywise-orbit-title" ref={title}>
            <p className="waywise-eyebrow">A QUIETER WAY TO EXPLORE.</p>
            <h1>让想去的地方，<br />成为刚刚好的旅程。</h1>
            <p>从一张照片，出发。</p>
            <button type="button" className="waywise-text-action" onClick={onCustom}>或者，告诉 Waywise 你的想法 <span aria-hidden="true">↗</span></button>
          </div>
          <div className="waywise-photo-orbit" aria-label="32 条推荐路线">
            {INSPIRATIONS.map((item, i) => (
              <button
                ref={(el) => { cards.current[i] = el }}
                key={item.id} type="button" className="waywise-photo"
                aria-label={`${item.cityName} · ${item.title}，打开推荐路线`}
                style={{ '--photo-order': i } as CSSProperties}
                onPointerEnter={(event) => { if (event.pointerType !== 'touch') preview(item) }}
                onPointerLeave={() => clearTimeout(hoverTimer.current)}
                onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) onPreview(item) }}
                onClick={() => { clearTimeout(hoverTimer.current); onOpen(item) }}
              >
                <img src={item.image} alt="" width="44" height="60" draggable={false} decoding="async" />
                <span className="waywise-photo-label">{item.cityName} · {item.title}</span>
              </button>
            ))}
          </div>
          <div className="waywise-scene-footer">
            <span>32 个故事，下一站由你决定。</span>
            <div><button type="button" onClick={() => replayRef.current()} aria-label="重播照片圆环入场动效">重播 <span aria-hidden="true">↻</span></button><span className="waywise-scroll-hint">滚动探索 <span aria-hidden="true">↓</span></span></div>
          </div>
        </div>
      </div>
    </div>
  )
}
