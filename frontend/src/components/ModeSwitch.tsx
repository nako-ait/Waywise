import { usePlanController } from '@/hooks/usePlanController'
import { MODE_ORDER, MODE_STYLES } from '@/lib/routeStyle'
import { useTripStore } from '@/store/useTripStore'

/**
 * 交通方式切换（五种）。
 * 已经编译过路书时，切换方式会自动重算 —— 不然用户会困惑「为什么没变」。
 */
export default function ModeSwitch() {
  const mode = useTripStore((s) => s.mode)
  const setMode = useTripStore((s) => s.setMode)
  const plan = useTripStore((s) => s.plan)
  const { run, planning } = usePlanController()

  return (
    <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
      {MODE_ORDER.map((key) => {
        const style = MODE_STYLES[key]
        const active = key === mode
        return (
          <button
            key={key}
            title={style.hint}
            disabled={planning}
            onClick={() => {
              setMode(key)
              // setMode 是同步的，run() 内部用 getState() 取到的一定是新方式
              if (plan) void run()
            }}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
              active ? 'text-white shadow-sm' : 'text-slate-600 hover:bg-white'
            }`}
            style={active ? { backgroundColor: style.color } : undefined}
          >
            <span>{style.icon}</span>
            {style.label}
          </button>
        )
      })}
    </div>
  )
}
