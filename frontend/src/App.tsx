import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppNav from '@/components/AppNav'
import ToastHost from '@/components/ToastHost'
import Home from '@/pages/Home'
import PlanWorkspace from '@/pages/PlanWorkspace'
import Profile from '@/pages/Profile'
import ShareLanding from '@/pages/ShareLanding'
import TripDetail from '@/pages/TripDetail'

/**
 * 1.1 路由 + 全局导航：
 *   顶部常驻 首页 / 工作台 / 个人
 *   /            首页（悬浮推荐气泡 + 底部一句话输入）
 *   /plan        工作台（左 地点+意图+对话 / 中 地图 / 右 可互动竖排路书）
 *   /trip/:id    路书详情
 *   /s/:code     分享落地
 *   /me          个人（本地账号 / 密钥 / 路线库）
 */
export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-full w-full flex-col overflow-hidden">
        <AppNav />
        <div className="min-h-0 flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/plan" element={<PlanWorkspace />} />
            <Route path="/trip/:id" element={<TripDetail />} />
            <Route path="/s/:code" element={<ShareLanding />} />
            <Route path="/me" element={<Profile />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
      <ToastHost />
    </BrowserRouter>
  )
}
