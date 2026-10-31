import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { fetchHealth } from '@/api/client'
import ShareActions from './ShareActions'
import { useTripStore } from '@/store/useTripStore'

const NAV = [
  { to: '/', label: '探索' },
  { to: '/plan', label: '工作台' },
  { to: '/me', label: '我的行程' },
]

/** 全局大导航：所有页面常驻（首页 / 工作台 / 个人），右侧放后端状态、分享与导入 */
export default function AppNav() {
  const location = useLocation()
  const profile = useTripStore((s) => s.profile)
  const [health, setHealth] = useState<'checking' | 'ok' | 'down'>('checking')

  function check() {
    setHealth('checking')
    fetchHealth()
      .then((info) => setHealth(info.status === 'ok' ? 'ok' : 'down'))
      .catch(() => setHealth('down'))
  }

  useEffect(() => {
    check()
  }, [])

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
  const isHome = location.pathname === '/'

  return (
    <header className={`waywise-nav ${isHome ? 'waywise-nav--home' : ''}`}>
      <Link to="/" className="waywise-wordmark" aria-label="Waywise 首页">
        <svg width="34" height="24" viewBox="0 0 34 24" fill="none" aria-hidden="true"><path d="M2 7 9 20 17 4 25 20 32 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span>Waywise</span>
      </Link>

      <nav className="waywise-nav-links" aria-label="主导航">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={isActive(item.to) ? 'is-active' : ''}
            aria-current={isActive(item.to) ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="waywise-nav-actions">
        {!isHome && <>
        <button
          onClick={check}
          title={
            health === 'ok'
              ? '服务连接正常，点击重新检查'
              : health === 'checking'
                ? '正在检查服务连接…'
                : '服务暂不可用，点击重试'
          }
          className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] ${
            health === 'ok'
              ? 'text-emerald-600 hover:bg-emerald-50'
              : health === 'checking'
                ? 'text-slate-400'
                : 'bg-red-50 text-red-600 hover:bg-red-100'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              health === 'ok' ? 'bg-emerald-500' : health === 'checking' ? 'bg-slate-300' : 'bg-red-500'
            }`}
          />
          {health === 'ok' ? '已连接' : health === 'checking' ? '连接中' : '连接中断'}
        </button>
        <ShareActions />
        </>}
        <Link
          to="/me"
          className="waywise-profile-link"
          aria-label={profile ? `${profile.nickname}的个人资料` : '个人资料与已保存行程'}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] text-white">
            {(profile?.nickname ?? '未').slice(0, 1)}
          </span>
          <span className="waywise-profile-name">{profile ? profile.nickname : '我的'}</span>
        </Link>
      </div>
    </header>
  )
}
