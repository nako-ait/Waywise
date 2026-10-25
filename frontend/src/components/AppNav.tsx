import { Link, useLocation } from 'react-router-dom'
import ShareActions from './ShareActions'
import { useTripStore } from '@/store/useTripStore'

const NAV = [
  { to: '/', label: '首页' },
  { to: '/plan', label: '工作台' },
  { to: '/me', label: '个人' },
]

/** 全局大导航：所有页面常驻（首页 / 工作台 / 个人），右侧放分享与导入 */
export default function AppNav() {
  const location = useLocation()
  const profile = useTripStore((s) => s.profile)

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)

  return (
    <header className="flex h-14 shrink-0 items-center gap-6 border-b border-slate-200 bg-white px-6">
      <Link to="/" className="flex items-baseline gap-2">
        <span className="text-[15px] font-bold tracking-tight text-slate-900">路书编译师</span>
        <span className="text-[11px] text-slate-400">TripCompiler · 上海</span>
      </Link>

      <nav className="flex items-center gap-1">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              isActive(item.to)
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <ShareActions />
        <Link
          to="/me"
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-slate-500 hover:bg-slate-100"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] text-white">
            {(profile?.nickname ?? '未').slice(0, 1)}
          </span>
          {profile ? profile.nickname : '未登录'}
        </Link>
      </div>
    </header>
  )
}
