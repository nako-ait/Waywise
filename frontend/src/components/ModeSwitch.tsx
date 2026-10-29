import { usePlanController } from '@/hooks/usePlanController'
import { MODE_ORDER, MODE_STYLES } from '@/lib/routeStyle'
import { useTripStore } from '@/store/useTripStore'

/**
 * 交通方式切换（五种 + 混合）。
 *
 * 用户在右侧时间轴里逐段改过方式后，整体方式就不再是单一的"驾车/地铁"了，
 * 这时高亮「混合」，点它 = 保留逐段设置；点其它方式 = 清掉逐段覆盖、统一改成那种。
 */
export default function ModeSwitch() {
  const mode = useTripStore((s) => s.mode)
  const setMode = useTripStore((s) => s.setMode)
  const legModes = useTripStore((s) => s.legModes)
  const plan = useTripStore((s) => s.plan)
  const { run, planning } = usePlanController()

  const overrideCount = Object.keys(legModes).length
  const actualModes = new Set(
    plan?.days.flatMap((day) => [
      ...day.stops.map((stop) => stop.transportFromPrev?.transportMode ?? stop.transportFromPrev?.mode),
      day.returnLeg?.transportMode ?? day.returnLeg?.mode,
    ]).filter((key): key is string => Boolean(key)) ?? [],
  )
  const autoMixed = actualModes.size > 1 || [...actualModes].some((key) => key !== mode)
  const isMixed = overrideCount > 0 || autoMixed

  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
      {MODE_ORDER.map((key) => {
        const style = MODE_STYLES[key]
        const active = !isMixed && key === mode
        return (
          <button
            key={key}
            title={`${style.label}优先：${style.hint}；自动规划时会比较各段实际路线`}
            disabled={planning}
            onClick={() => {
              setMode(key) // 会顺带清空逐段覆盖
              if (plan) void run()
            }}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
              active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white'
            }`}
          >
            {style.label}
          </button>
        )
      })}

      <button
        title={
          overrideCount > 0
            ? `已指定 ${overrideCount} 段，点击清除指定并按路线偏好重新选择交通`
            : autoMixed ? '已根据实际路线、偏好和步行负担自动组合交通方式' : '在右侧时间轴里逐段改方式，就会变成混合出行'
        }
        disabled={!isMixed || planning}
        onClick={() => {
          if (overrideCount > 0) void run({ reselectTransport: true })
        }}
        className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
          isMixed ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-400 hover:bg-white'
        }`}
      >
        {overrideCount > 0 ? '恢复自动' : '混合'}
        {overrideCount > 0 && <span className="ml-1 text-[10px] opacity-80">{overrideCount}</span>}
      </button>
    </div>
  )
}
