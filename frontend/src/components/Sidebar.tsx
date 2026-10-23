import AiPanel from './AiPanel'
import DemoRoutesPanel from './DemoRoutesPanel'
import HotelPanel from './HotelPanel'
import IsochronePanel from './IsochronePanel'
import PoiQuickAdd from './PoiQuickAdd'
import DestinationList from './DestinationList'
import TripParamsPanel from './TripParamsPanel'

/**
 * 左侧操作区（按演示时的使用顺序排列）：
 * AI 助手 → 出发酒店 → 主题演示线路 → 搜索加点 → 目的地列表 → 行程参数 → 酒店便利度
 *
 * ⚠️ 整体可滚动（overflow-y-auto）：面板有 6 个，屏幕不够高时必须让用户能滚到下面，
 *    而不是让 flex 把「目的地列表」压成 0 高度（那会表现为「点了添加没反应」）。
 */
export default function Sidebar() {
  return (
    <aside className="tc-scroll flex w-[380px] shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white">
      <AiPanel />
      <HotelPanel />
      <DemoRoutesPanel />
      <PoiQuickAdd />
      <DestinationList />
      <TripParamsPanel />
      <IsochronePanel />
    </aside>
  )
}
