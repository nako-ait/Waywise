import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TRIP_GROUPS_DEFAULT, useTripStore } from '@/store/useTripStore'
import { loadShares } from '@/lib/shareHistory'

/** 我的：本地账号 + 密钥 + 个人路线库（分组）+ 分享记录 */
export default function Profile() {
  const navigate = useNavigate()
  const profile = useTripStore((s) => s.profile)
  const trips = useTripStore((s) => s.trips)
  const saveProfile = useTripStore((s) => s.saveProfile)
  const logout = useTripStore((s) => s.logout)
  const renameTrip = useTripStore((s) => s.renameTrip)
  const moveTrip = useTripStore((s) => s.moveTrip)
  const deleteTrip = useTripStore((s) => s.deleteTrip)
  const openTrip = useTripStore((s) => s.openTrip)
  const showToast = useTripStore((s) => s.showToast)

  const [nickname, setNickname] = useState(profile?.nickname ?? '')
  // 密钥不预填：只显示掩码，改的时候才输入新的
  const [amapKey, setAmapKey] = useState('')
  const [llmKey, setLlmKey] = useState('')
  const shares = loadShares()

  const groups = Array.from(
    new Set([...TRIP_GROUPS_DEFAULT, ...trips.map((trip) => trip.group)]),
  )

  const mask = (value: string) => (value ? `${'•'.repeat(Math.max(4, value.length - 4))}${value.slice(-4)}` : '未配置')

  return (
    <div className="flex h-full flex-col bg-slate-100">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <span className="text-sm font-semibold text-slate-900">个人中心</span>
        <span className="text-[10px] text-slate-400">账号 · 密钥 · 路线库 · 分享记录</span>
        {profile && (
          <button
            className="ml-auto text-[11px] text-slate-400 hover:text-slate-700"
            onClick={() => {
              logout()
              showToast('success', '已退出本地账号')
            }}
          >
            退出登录
          </button>
        )}
      </header>

      <main className="tc-scroll min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto grid max-w-[1080px] grid-cols-2 gap-4">
          {/* 账号 */}
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-[13px] font-semibold text-slate-900">本地账号</h2>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">
              1.1 先做"本地账号"：昵称、密钥、路线库都存在这台机器上。
              服务端账号（换设备也能用）是下一步。
            </p>
            {profile ? (
              <div className="mt-3 flex items-center gap-2 text-[12px] text-slate-700">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[11px] text-white">
                  {profile.nickname.slice(0, 1)}
                </span>
                {profile.nickname}
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                  已登录（本地）
                </span>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <div className="flex gap-2">
                  <input
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    placeholder="给自己起个名字"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-2 text-xs outline-none focus:border-slate-800"
                  />
                  <button
                    className="rounded-lg bg-slate-900 px-3 py-2 text-xs text-white disabled:bg-slate-300"
                    disabled={!nickname.trim()}
                    onClick={() => {
                      saveProfile({ nickname: nickname.trim() })
                      showToast('success', '已登录（本地账号）')
                    }}
                  >
                    登录
                  </button>
                </div>
                <button
                  className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-[11px] text-slate-500 hover:border-slate-500 hover:text-slate-800"
                  onClick={() => {
                    saveProfile({ nickname: '演示用户' })
                    setNickname('演示用户')
                    showToast('success', '已用演示账号登录（本地）')
                  }}
                >
                  一键体验登录（本地演示账号）
                </button>
                <p className="text-[10px] leading-4 text-slate-400">
                  当前状态：未登录。登录态只存在这台浏览器里（localStorage），换浏览器/清缓存会丢。
                </p>
              </div>
            )}
          </section>

          {/* 密钥 */}
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-[13px] font-semibold text-slate-900">我的密钥</h2>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">
              真实版本由服务端加密保管、前端只显示掩码；本地版仅存在浏览器里，别在公用电脑上填。
            </p>
            <div className="mt-3 space-y-2">
              <label className="block text-[11px] text-slate-500">
                高德 Web 服务 Key
                <input
                  value={amapKey}
                  onChange={(event) => setAmapKey(event.target.value)}
                  placeholder={mask(profile?.amapKey ?? '')}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs outline-none focus:border-slate-800"
                />
              </label>
              <label className="block text-[11px] text-slate-500">
                大模型 Key（DeepSeek）
                <input
                  value={llmKey}
                  onChange={(event) => setLlmKey(event.target.value)}
                  placeholder={mask(profile?.llmKey ?? '')}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs outline-none focus:border-slate-800"
                />
              </label>
              <button
                className="rounded-lg bg-slate-900 px-3 py-2 text-xs text-white"
                onClick={() => {
                  const patch: { amapKey?: string; llmKey?: string } = {}
                  if (amapKey.trim()) patch.amapKey = amapKey.trim()
                  if (llmKey.trim()) patch.llmKey = llmKey.trim()
                  if (!Object.keys(patch).length) {
                    showToast('error', '先填一个 Key 再保存')
                    return
                  }
                  saveProfile(patch)
                  setAmapKey('')
                  setLlmKey('')
                  showToast('success', '密钥已保存到本地')
                }}
              >
                保存密钥
              </button>
            </div>
          </section>

          {/* 路线库 */}
          <section className="col-span-2 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-slate-900">个人路线库</h2>
              <span className="text-[11px] text-slate-400">共 {trips.length} 份 · 按分组管理</span>
            </div>
            {trips.length === 0 ? (
              <p className="mt-3 text-[11px] text-slate-400">
                还没有路线。去首页说一句话，或在首页「导入行程」输入别人给的口令。
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-3 gap-3">
                {groups.map((group) => {
                  const items = trips.filter((trip) => trip.group === group)
                  return (
                    <div key={group} className="rounded-lg border border-slate-200 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[12px] font-medium text-slate-800">{group}</span>
                        <span className="text-[10px] text-slate-400">{items.length}</span>
                      </div>
                      {items.length === 0 && <p className="text-[11px] text-slate-300">还没有</p>}
                      {items.map((trip) => (
                        <div key={trip.id} className="mb-1.5 rounded border border-slate-100 bg-slate-50 px-2 py-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              className="min-w-0 flex-1 truncate text-left text-[11.5px] font-medium text-slate-800 hover:text-slate-950"
                              onClick={() => {
                                openTrip(trip.id)
                                navigate(`/trip/${trip.id}`)
                              }}
                              title={trip.title}
                            >
                              {trip.title}
                            </button>
                            <div className="flex shrink-0 gap-1 text-[10px] text-slate-400">
                              <button
                                className="hover:text-slate-700"
                                onClick={() => {
                                  const next = window.prompt('重命名', trip.title)
                                  if (next) renameTrip(trip.id, next)
                                }}
                              >
                                改名
                              </button>
                              <button className="hover:text-red-600" onClick={() => deleteTrip(trip.id)}>
                                删
                              </button>
                            </div>
                          </div>
                          <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                            <span>{trip.snapshot.days ?? 1} 天</span>
                            <select
                              value={trip.group}
                              onChange={(event) => moveTrip(trip.id, event.target.value)}
                              className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-500"
                            >
                              {groups.map((item) => (
                                <option key={item} value={item}>
                                  {item}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* 分享记录 */}
          <section className="col-span-2 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-[13px] font-semibold text-slate-900">我分享过的</h2>
            {shares.length === 0 ? (
              <p className="mt-2 text-[11px] text-slate-400">还没有分享记录。</p>
            ) : (
              <div className="mt-2 divide-y divide-slate-100">
                {shares.map((share) => (
                  <div key={share.code} className="flex items-center justify-between py-1.5 text-[11.5px]">
                    <span className="font-mono font-semibold tracking-wider text-slate-800">{share.code}</span>
                    <span className="text-slate-500">{share.title}</span>
                    <span className="text-slate-300">{new Date(share.at).toLocaleString('zh-CN')}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
