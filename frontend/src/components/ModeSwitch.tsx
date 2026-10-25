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
  const isMixed = overrideCount > 0

  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
      {MODE_ORDER.map((key) => {
        const style = MODE_STYLES[key]
        const active = !isMixed && key === mode
        return (
          <button
            key={key}
            title={style.hint}
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
          isMixed
            ? `逐段自定义了 ${overrideCount} 段，总时长/费用按每段自己的方式算`
            : '在右侧时间轴里逐段改方式，就会变成混合出行'
        }
        disabled={!isMixed || planning}
        onClick={() => {
          // 混合态下点它不动任何设置，只是确认"保留逐段"
        }}
        className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
          isMixed ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-400 hover:bg-white'
        }`}
      >
        混合
        {isMixed && <span className="ml-1 text-[10px] opacity-80">{overrideCount}</span>}
      </button>
    </div>
  )
}
