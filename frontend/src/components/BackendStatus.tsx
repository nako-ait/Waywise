import { useCallback, useEffect, useState } from 'react'
import { fetchHealth } from '@/api/client'
import { useTripStore } from '@/store/useTripStore'

/**
 * 后端状态指示（模块 5 的「错误处理」）。
 *
 * 演示最怕的不是报错，而是"报错了但看不出来"。
 * 这里在页头常驻一个小胶囊：
 *   后端未启动 → 红色，鼠标悬停直接给启动命令
 *   后端就绪   → 灰色，顺带显示求解器与距离来源（ortools / 高德实时 or 离线估算）
 */
export default function BackendStatus() {
  const status = useTripStore((s) => s.backendStatus)
  const info = useTripStore((s) => s.backendInfo)
  const setBackend = useTripStore((s) => s.setBackend)
  const [checking, setChecking] = useState(false)

  const check = useCallback(async () => {
    setChecking(true)
    try {
      const health = await fetchHealth()
      setBackend('ok', health)
    } catch {
      setBackend('down', null)
    } finally {
      setChecking(false)
    }
  }, [setBackend])

  useEffect(() => {
    void check()
  }, [check])

  const base =
    'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-colors cursor-default'

  return (
    <div className="flex items-center gap-1">
      {status === 'unknown' && <span className={`${base} bg-slate-100 text-slate-500`}>检测后端…</span>}

      {status === 'down' && (
        <span
          className={`${base} bg-red-50 text-red-600`}
          title={'后端未启动。请在另一个终端执行：\ncd backend\n.venv\\Scripts\\python.exe run.py'}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
          后端未启动
        </span>
      )}

      {status === 'ok' && info && (
        <span
          className={`${base} bg-slate-100 text-slate-600`}
          title={
            `服务 v${info.version}\n求解器：${info.solver}\n距离来源：${info.distanceSource}\n` +
            `高德 Web Key：${info.amapConfigured ? '已配置' : '未配置'}\n` +
            `LLM：${info.llmProvider}（${info.llmConfigured ? '已配置' : '未配置，AI 走规则解析'}）\n` +
            `POI：${info.poiCount} 个 · 缓存条目：${info.cacheEntries}`
          }
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          后端就绪 · {info.solver}
          <span className="text-slate-400">
            {info.distanceSource === 'amap' ? ' · 高德实时' : ' · 离线估算'}
          </span>
        </span>
      )}

      <button
        className="rounded px-1 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        onClick={() => void check()}
        disabled={checking}
        title="重新检测后端"
      >
        {checking ? '…' : '刷新'}
      </button>
    </div>
  )
}
