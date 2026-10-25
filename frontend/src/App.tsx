import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ToastHost from '@/components/ToastHost'
import Home from '@/pages/Home'
import PlanWorkspace from '@/pages/PlanWorkspace'
import Profile from '@/pages/Profile'
import ShareLanding from '@/pages/ShareLanding'
import TripDetail from '@/pages/TripDetail'

/**
 * 1.1 路由：
 *   /            首页（AI 主入口）
 *   /plan        工作台（左 AI 对话 / 中 地图 / 右 竖排路书）
 *   /trip/:id    路书详情（成稿）
 *   /s/:code     分享落地（只读 + 复制到我的）
 *   /me          我的（本地账号 / 密钥 / 路线库 / 分享记录）
 */
export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-full w-full flex-col overflow-hidden">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/plan" element={<PlanWorkspace />} />
          <Route path="/trip/:id" element={<TripDetail />} />
          <Route path="/s/:code" element={<ShareLanding />} />
          <Route path="/me" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <ToastHost />
    </BrowserRouter>
  )
}
