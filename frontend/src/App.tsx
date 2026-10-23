import BackendStatus from '@/components/BackendStatus'
import MapView from '@/components/MapView'
import Sidebar from '@/components/Sidebar'
import BottomBar from '@/components/BottomBar'
import DayTabs from '@/components/DayTabs'
import Timeline from '@/components/Timeline'

/**
 * 整体布局
 *
 *  ┌────────────────────────────────────────────────┐
 *  │ Header：产品名 + 城市 + 后端状态（就绪/未启动）  │
 *  ├───────────────┬────────────────────────────────┤
 *  │ Sidebar       │ MapView（标记 + 路线 + 等时圈） │
 *  │ AI / 酒店 /   │                                │
 *  │ 线路 / 列表   │                                │
 *  ├───────────────┴────────────────────────────────┤
 *  │ Timeline：每站到达/停留/交通（有路书才出现）      │
 *  │ DayTabs：多日切换（多日才出现）                  │
 *  ├────────────────────────────────────────────────┤
 *  │ BottomBar：交通方式 + 统计 + 编译入口            │
 *  └────────────────────────────────────────────────┘
 */
export default function App() {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
        <div className="flex items-baseline gap-2">
          <h1 className="text-base font-bold tracking-tight text-slate-900">
            路书编译师 <span className="text-slate-400">TripCompiler</span>
          </h1>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
            上海 · GCJ-02
          </span>
        </div>
        <p className="hidden text-xs text-slate-400 sm:block">
          以酒店为固定起点 · 地图选点 · AI 编译多日路书
        </p>
        <BackendStatus />
      </header>

      <main className="flex min-h-0 flex-1">
        <Sidebar />
        <section className="relative min-w-0 flex-1">
          <MapView />
        </section>
      </main>

      <Timeline />
      <DayTabs />
      <BottomBar />
    </div>
  )
}
