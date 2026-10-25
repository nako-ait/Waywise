/**
 * 未配置高德 Key 时的引导卡片。
 * 与其白屏报错，不如直接把配置步骤打在屏幕上 —— 演示现场也能快速自救。
 */
export default function MissingKeyCard() {
  return (
    <div className="flex h-full items-center justify-center bg-slate-100 p-6">
      <div className="max-w-xl rounded-2xl border border-amber-200 bg-white p-6 shadow-panel">
        <h2 className="text-lg font-bold text-slate-900">还差一步：配置高德地图 Key</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          检测到环境变量 <code className="rounded bg-slate-100 px-1">VITE_AMAP_JS_KEY</code>{' '}
          为空，地图无法加载。请按下面三步配置：
        </p>
        <ol className="mt-4 space-y-3 text-sm leading-6 text-slate-700">
          <li>
            <span className="font-semibold">1.</span> 打开{' '}
            <a
              className="text-blue-600 underline"
              href="https://console.amap.com/dev/key/app"
              target="_blank"
              rel="noreferrer"
            >
              高德开放平台控制台
            </a>
            ，创建应用并添加 Key，服务平台选择{' '}
            <span className="font-semibold">「Web端 (JS API)」</span>。
          </li>
          <li>
            <span className="font-semibold">2.</span> 打开{' '}
            <code className="rounded bg-slate-100 px-1">frontend/.env.local</code>
            （没有就把 <code className="rounded bg-slate-100 px-1">.env.example</code> 复制一份），填入：
            <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-[12px] leading-5 text-slate-100">
{`VITE_AMAP_JS_KEY=你的JS API Key
VITE_AMAP_SECURITY_CODE=你的安全密钥（若控制台开启了安全密钥则必填）`}
            </pre>
          </li>
          <li>
            <span className="font-semibold">3.</span> 重启服务（Vite 只在启动时读取 .env，改完必须重启）：
            <code className="rounded bg-slate-100 px-1">双击 启动.bat</code>
            或
            <code className="rounded bg-slate-100 px-1">node node_modules\vite\bin\vite.js</code>
          </li>
        </ol>
        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-500">
          提示：高德 JS API 2.0 的安全密钥必须在加载脚本前通过{' '}
          <code>window._AMapSecurityConfig</code> 注入，本项目已在{' '}
          <code>src/lib/amap.ts</code> 中处理。
        </p>
      </div>
    </div>
  )
}
