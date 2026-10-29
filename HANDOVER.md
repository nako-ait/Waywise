# HANDOVER.md —— 路书编译师 TripCompiler 交接文档

> 交接时间：**2026-10-27 22:17**
> 交接形式：从「DSH 会话内的临时代码改动」交给后续接手的 GPT / 新同学。
> 一句话状态：**本机可完整运行（前后端都活着、两把 Key 与 OR-Tools 均可用），核心功能可用；
> 但没有 git 提交记录，回滚依赖快照 zip，且有两处第三方接口不可用（详见 §2.3）。**

---

## 0. 先读这里（3 分钟版）

| 项 | 值 |
| --- | --- |
| **当前项目路径** | `C:\Users\35258\Desktop\lushu-main` |
| ⚠️ 已废弃路径 | `C:\Users\35258\dsh-workspace\lushu`（更早的工作副本，**不要再改它**，只留了补丁备份） |
| 版本 | README 标 **v1.11**；另有 **v1.12** 的改动（见 `docs/1.12_改动说明.md`），所以实际代码是 v1.12 |
| 前端 | React 18 + Vite 5 + TypeScript + Zustand + Tailwind + 高德 JS API 2.0 |
| 后端 | Python 3.14.3 + FastAPI + pydantic v2 + OR-Tools（已装）+ SQLite 缓存 |
| 前端地址 | http://127.0.0.1:5173 （Vite 把 `/api` 代理到 8000，同源无跨域） |
| 后端地址 | http://127.0.0.1:8000 ，接口文档 http://127.0.0.1:8000/docs |
| 一键启动 | 双击根目录 `启动.bat` |
| 自检命令 | `cd backend && .venv\Scripts\python.exe scripts\verify_all.py`（4 个套件）<br>`cd frontend && node node_modules\typescript\bin\tsc --noEmit` |
| 回滚点 | `C:\Users\35258\Desktop\lushu-main-snapshot-20261027-2217.zip`（143 个文件，仅源码+文档） |
| git | **本机未安装 git，代码未提交**（见 §6） |

---

## 1. 项目目标 / 完成度 / 验收标准

### 1.1 目标

以**酒店为固定起点**、在地图上标定并选择目的地，根据地理位置与交通便利程度，由 **AI 自动规划多日出行路线**的智能旅行规划工具。原始需求是上海单城，现已扩展为**六城**（上海 / 北京 / 杭州 / 成都 / 西安 / 广州，选城后整条链路跟着走，但只做**同一城市内**的多点规划）。

产品的核心主张（README 里也这么写）：
> **模型负责「听懂 + 选点 + 调参 + 解释」，排程交给确定性求解器** —— 这样时间窗、往返闭环、费用不会被模型编出来的时间骗到。

### 1.2 完成度

| 能力 | 状态 | 证据 / 位置 |
| --- | --- | --- |
| 地图 + 打点 + 酒店固定起点 | ✅ 完成 | `frontend/src/components/MapView.tsx`、`HotelPanel.tsx` |
| 距离矩阵 / 真实路网 / 地理编码 | ✅ 完成（需高德 Web 服务 Key） | `backend/app/services/amap_client.py` |
| 单日 TSP + 时间窗 + 午饭 + 权重 | ✅ 完成 | `planner.py`、`solver.py`、`modes.py` |
| 多日分天（KMeans + 每日 TSP） | ✅ 完成 | `planner.py`、`cluster.py`、`vrp.py` |
| 五种交通方式 + 逐段独立方式（混合） | ✅ 完成 | `modes.py` + 时间轴逐段选择 |
| **分段混合交通决策**（按真实距离自动分段） | ✅ **本次新增**，已真实验证 | `planner._decide_leg_modes()` |
| **拥堵自动寻优**（打车过慢自动改步行 + ⚡️） | ✅ **本次新增**，已真实验证 | `planner._auto_optimize_legs()` |
| AI：一句话解析 / 重规划 / 解释 | ✅ 完成（有 Key 走模型，无 Key 规则兜底） | `ai_service.py`、`nlp_rules.py` |
| AI：多轮对话提案（turn / apply） | ✅ 完成 | `agent.py`、`agent_loop.py`、`turn_graph.py` |
| 6 位口令分享 + 导入重算 | ✅ 完成 | `routers/share.py`、`pages/ShareLanding.tsx` |
| 长图导出 | ✅ 完成 | `lib/longImage.ts` |
| 本地账号 / 密钥 / 路线库 | ✅ 完成（**仅 localStorage，无服务端**） | `pages/Profile.tsx`、`lib/authKeys.ts` |
| 离线降级（无 Key 也能跑） | ✅ 完成 | `amap_client` 离线估算 + `nlp_rules` |
| 移动端适配 | ❌ 未做 | README「已知边界」明确写了 |

### 1.3 验收标准（可执行的 checklist）

接手后按顺序跑，全绿即可认为"没有退化"：

1. `cd backend && .venv\Scripts\python.exe scripts\verify_all.py` → **4/4 PASS**
2. `cd frontend && node node_modules\typescript\bin\tsc --noEmit` → **0 error**
3. `GET http://127.0.0.1:8000/api/health` → `status=ok`，且
   - `amapConfigured: true`（有 Web 服务 Key）
   - `llmConfigured: true`（有 LLM Key）
   - `solver: "ortools"`（OR-Tools 可用；缺失会是 `python-greedy-2opt`）
   - `poiCount: 276`
4. 浏览器打开 5173：地图能显示（不是"配置 Key"引导卡）、能搜到地点、能加目的地
5. 点「编译路书」→ 时间轴出现每一段的到达/停留/交通
6. **本次新增能力的验收**（详见 §5.3 与附录 A）：
   - 交通方式选「地铁」，排一条含 1~2 公里短段 + 5 公里长段的路线 →
     时间轴上**短段是 🚶 步行并带 ⚡️**，长段是 🚇 地铁（证明分段混合决策生效）
   - 交通方式选「步行」，排一条 3 公里以上的段 → 出现 **💡 建议打车** 提示

---

## 2. 已完成 / 未完成 / 已知问题 / 风险点

### 2.1 已完成

- v1.0 → v1.12 的全部能力（版本明细见 §6.1）：五页路由、竖排时间轴、逐段换方式/增删点、
  六城选择、混合出行方式、先提案后执行、LangGraph 状态机 + 事实校验、口令分享、长图导出。
- 本次两轮后端算法改动：
  1. **拥堵自动寻优**（真实耗时判断 + ⚡️ 标记与原因）
  2. **分段混合交通决策**（<1.2km 强制步行 / 1.2~3km 比真实耗时 / >3km 用偏好 + 进出站惩罚）

### 2.2 未完成（有意留的，不是 bug）

| 项 | 现状 | 说明 |
| --- | --- | --- |
| 移动端 | 未适配 | 桌面宽度设计（README 已声明） |
| 服务端账号 | 无 | 昵称/密钥/路线库只在 localStorage，无登录、无跨设备同步 |
| 其他城市的真实 POI 库 | 无 | 只有上海有 276 个真实快照；其它城市是内置地标（演示用），真实搜索依赖在线 API |
| 酒店星级/房价、天气、门票、实时人流 | 无 | 问到时会明确说"没有这项数据"，不编造 |
| 公交/地铁**矩阵**精度 | 近似 | 公交矩阵由驾车距离 × 系数推导（真实公交路径只在逐段 `leg_route` 时取） |
| 骑行（bike） | **不可用** | 见 §2.3 第 1 条 |

### 2.3 已知问题 / Bug（都是我实测到的，按影响排序）

1. **高德骑行接口不可用**：`GET /v3/direction/bicycling` 返回 `status=0, info=SERVICE_NOT_AVAILABLE`（当前 Key 无此权限）。
   → 所以 1.2~3 km 区间只能做「步行 vs 打车」比较，**没有骑行**。要骑行得换带权限的 Key 或改前端 `AMap.Riding`。
2. **高德等时圈接口不可用**：`/v3/direction/isochrone` 同样 `SERVICE_NOT_AVAILABLE`。
   → 我在旧副本里做的降级是「等速圆 polygon + POI 可达性仍用真实距离」。**接手时请确认这版的 `services/isochrone.py` 是否也这样降级**；若没有，等时圈面板可能报错。
3. **矩阵距离与逐段路由距离不完全一致**：同一对点实测矩阵 2.2 km / 路由 1.72 km（高德的"距离测量"与"路径规划"是两个接口）。
   → 决策用矩阵（便宜、一次 N²），展示用路由（真实）。因此**任何给用户看的文案里不要写"矩阵算出的公里数"**，本次已经改成不写具体公里数。
4. **极短段没有公交方案**：<1.2 km 时高德公交接口通常不返回方案 → 时间轴上那一段没有「直达/换乘」徽标，属于正常现象。
5. **交付环境会清理后台进程**：启动的服务随会话结束而停止（本次交付里我就是反复重启的）。接手的同学请用 `启动.bat` 或两个独立终端。
6. **Vite dev server 曾被 EBUSY 搞崩**：编辑工具在 `src/` 下产生临时目录（`.xxx.tmpdir`）会让文件监听抛 EBUSY 直接退出，表现为**页面假死、点什么都没反应**。
   → 旧副本里加了 `server.watch.ignored`；**这版请确认 `vite.config.ts` 是否有同样配置**，没有建议补上：
   `server.watch.ignored: ['**/.*.tmpdir/**', '**/*.tmp']`。
7. **改 `tailwind.config.js` 必须重启 dev server**，否则语义色不生效（HMR 不会重载 tailwind 配置）。
8. **localStorage 里有旧版本持久化状态**时，注意 Zustand persist 的 `version`/`migrate`；结构变了要正确迁移，否则首屏可能读到残缺状态。

### 2.4 风险点

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| API Key 泄露 | 配额被盗刷 | Key 只在 `backend/.env` / `frontend/.env.local` / 个人页 localStorage；**不要提交进仓库**；分发前轮换 |
| 高德配额 | 现场演示失败 | 距离矩阵与分段路径都落 SQLite 缓存（默认 168h）；建议**演示前先跑一遍**把缓存捂热 |
| LLM Key 失效/超时 | AI 对话不可用 | 已有规则兜底（`nlp_rules.py`），气泡会标注"规则兜底（模型未参与）" |
| OR-Tools 装不上 | 求解降级 | 自动降级到纯 Python 贪心 + 2-opt（`tsp_fallback.py`），接口契约一致，只是结果可能差一点 |
| **网络/TLS 环境**：本机 PowerShell 与 curl 访问外网 HTTPS 失败（Schannel 问题），**Python httpx 正常** | 用 PS 脚本调外部 API 会莫名失败 | 调外部 HTTP 一律用 `backend/.venv` 里的 Python，不要用 PowerShell `Invoke-WebRequest` 判断"网络不通" |
| dev server 仅绑 127.0.0.1 | 手机/别人电脑打不开 | 需要对外演示时用 `--host 0.0.0.0`，并注意 JS Key 的域名白名单 |

---

## 3. 项目文件结构 / 关键文件 / 命令

### 3.1 结构（只列关键的，共 143 个源码/文档文件，约 2.6 MB）

```
lushu-main/
├─ 启动.bat / _backend.bat / _frontend.bat    一键启动（Windows）
├─ 运行说明.md                                怎么跑（含本机实测记录，建议先读）
├─ README.md                                  产品说明 + 版本历史 + 已知边界（v1.11）
├─ THIRD_PARTY.md                             第三方依赖与许可
├─ .gitignore
├─ docs/                                      答辩提纲、产品规划、各版本改动说明、截图、POI 报告
├─ backend/
│  ├─ run.py                                  直接跑后端的入口
│  ├─ requirements.txt                        依赖（Python 3.11~3.14）
│  ├─ .env / .env.example                     环境变量（.env 含真实 Key，不入库）
│  ├─ data/shanghai_pois.json                 276 个上海 POI 快照（高德抓取）
│  ├─ data/tripcompiler.db                    距离矩阵/路径 SQLite 缓存（可删，会自动重建）
│  ├─ app/
│  │  ├─ main.py                              应用装配、CORS、路由挂载、启动日志
│  │  ├─ config.py                            环境变量（pydantic-settings）
│  │  ├─ models.py                            **全部请求/响应契约**（含 TransportLeg）
│  │  ├─ routers/                             health / poi / plan / isochrone / ai / share
│  │  └─ services/
│  │     ├─ planner.py        ★ 主流程：分天 → 求解 → 逐段真实路径 → 混合方式决策 → 拥堵寻优 → 时间轴
│  │     ├─ amap_client.py    ★ 高德封装：距离矩阵、路径规划、公交多方案、地理编码、矩阵进出站惩罚
│  │     ├─ solver.py         OR-Tools 求解（含降级）
│  │     ├─ tsp_core.py / tsp_fallback.py / vrp.py / cluster.py
│  │     ├─ modes.py          ★ 五种方式参数表（速度/票价/换乘/舒适度/进出站惩罚）
│  │     ├─ ai_service.py / ai_schemas.py / nlp_rules.py / llm.py
│  │     ├─ agent.py / agent_loop.py / turn_graph.py      对话提案（LangGraph）
│  │     ├─ share.py?（在 routers/share.py）                       口令分享
│  │     ├─ cache.py          SQLite KV 缓存
│  │     ├─ poi_store.py      预置 POI 读取
│  │     ├─ timeutil.py       时间窗解析/HH:mm
│  │     ├─ isochrone.py      等时圈（见 §2.3-2）
│  │     └─ keyring.py        请求级 Key（x-llm-key / x-amap-key）
│  └─ scripts/                verify_all.py（总自检）/ smoke_test / test_plan / test_module3 / test_module4 / e2e_smoke
└─ frontend/
   ├─ package.json / pnpm-lock.yaml / vite.config.ts / tailwind.config.js / tsconfig.json
   ├─ .env.local / .env.example
   └─ src/
      ├─ main.tsx / App.tsx / index.css
      ├─ pages/               Home（城市选择）/ PlanWorkspace（工作台）/ TripDetail / ShareLanding / Profile
      ├─ components/          MapView / Timeline / TimelineVertical / Sidebar / AiPanel / ChatDock /
      │                       ModeSwitch / TripParamsPanel / PoiQuickAdd / HotelPanel / DestinationList /
      │                       TransitOptions / ShareActions / ImportDialog / AddStopDialog / ToastHost …
      ├─ store/useTripStore.ts          ★ Zustand + persist（含 migrate）
      ├─ api/client.ts                  ★ 所有后端调用集中在这里
      ├─ types/index.ts                 ★ 前后端契约类型（TransportLeg 等）
      ├─ data/                cities.ts / demoRoutes.ts / shanghaiPois.ts（276 条）
      └─ lib/                 amap / amapSearch / amapParse / amapNav / mapInstance / routeStyle /
                              routeGeometry / routeFlow / routeOrder / labelLayout / longImage /
                              shareHistory / authKeys / geo / dom / id
```

### 3.2 关键文件说明（改东西前先看这几个）

| 文件 | 作用 | 改它之前要知道 |
| --- | --- | --- |
| `backend/app/services/planner.py` | **真正的"路书编译器"**：排序 → 逐段真实路径 → 混合方式决策 → 拥堵寻优 → 时间轴 → 统计 | 时间轴上的每个数字都来自这里；**回程时刻必须以逐段实算为准**（历史 bug 见 §5.2） |
| `backend/app/services/amap_client.py` | 高德所有 HTTP：矩阵、路径、公交 5 方案、地理编码；矩阵里加进出站惩罚 | 矩阵缓存键要包含**方式 + 城市 + 策略**，否则换偏好会复用旧结果 |
| `backend/app/models.py` | 请求/响应契约（`TransportLeg` 的 `transportMode` / `isAutoOptimized` 等都在这里） | 加字段要给默认值，否则老前端/老缓存反序列化会炸 |
| `backend/app/services/modes.py` | 五种方式的参数表 | `access_penalty_min`（地铁/公交 10 分钟）**只进矩阵**，不进展示 |
| `frontend/src/store/useTripStore.ts` | 全部前端状态 + 持久化 | 加字段记得 `version`/`migrate`；`partialize` 决定什么进 localStorage |
| `frontend/src/components/Timeline.tsx` | 时间轴渲染（每段图标/时长/⚡️/💡） | 图标读 `transportMode`（不是全局方式） |
| `frontend/src/lib/routeStyle.ts` | 方式 → 文案/颜色/图标 | 新增方式要在这里补 `icon` |
| `frontend/src/api/client.ts` | 所有后端请求 | 前端默认走**同源 `/api`**（Vite 代理），`VITE_API_BASE` 只在直连时才需要 |

### 3.3 命令

**启动（Windows，任选一种）**

```bat
:: A. 一键（推荐）
双击  启动.bat

:: B. 手动，两个终端
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

cd frontend
node node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173
```

**测试 / 自检**

```bat
:: 后端 4 套件（health/plan/多日/等时圈/AI 全链路）
cd backend
.venv\Scripts\python.exe scripts\verify_all.py

:: 单套件
.venv\Scripts\python.exe scripts\test_plan.py
.venv\Scripts\python.exe scripts\test_module3.py
.venv\Scripts\python.exe scripts\test_module4.py
.venv\Scripts\python.exe scripts\smoke_test.py
.venv\Scripts\python.exe scripts\e2e_smoke.py     :: 端到端（需前后端都在跑）

:: 前端类型检查（等价于"能不能编译"）
cd frontend
node node_modules\typescript\bin\tsc --noEmit
```

**构建**

```bat
cd frontend
node node_modules\vite\bin\vite.js build      :: 产物在 frontend/dist
```

> 构建前 `tsc --noEmit` 必须 0 错误。注意 `dist/` 里会**内联** `VITE_AMAP_JS_KEY`（这是 JS API 的正常设计），
> 所以不要把构建产物连同 Key 一起公开分发。

---

## 4. 环境依赖 / 环境变量 / 账号权限

### 4.1 本机实际环境（本次交接时实测）

| 组件 | 状态 |
| --- | --- |
| Python | 3.14.3（`backend/.venv`） |
| 虚拟环境 | `backend/.venv` — **是从旧副本整包复制过来的**，因此**已含 OR-Tools 9.x**（`运行说明.md` 里写的"未安装 OR-Tools"已过期，`/api/health` 现在返回 `solver: ortools`） |
| Node | v24 系；`frontend/node_modules` 已装（复制 + `pnpm install` 补装） |
| 前端新增依赖 | **`react-router-dom@7.18.4`** —— 这版的五页路由需要它；从旧副本复制 `node_modules` 后**必须**补装 |
| 高德 Web 服务 Key | ✅ 已配（`backend/.env`），`/api/health` 显示 `amapConfigured: true, distanceSource: amap` |
| 高德 JS API Key + 安全密钥 | ✅ 已配（`frontend/.env.local`），地图正常 |
| LLM | ✅ DeepSeek（`llmConfigured: true`，`source: llm` 实测可用） |
| git / GitHub CLI | **均未安装** |

### 4.2 环境变量

**`backend/.env`**（模板见 `backend/.env.example`）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `AMAP_WEB_KEY` | 建议填 | 高德**Web 服务** Key：距离矩阵、路径规划、地理编码。留空 → 全链路离线估算（`dataSource=offline`），仍能跑但数字粗 |
| `LLM_PROVIDER` | 可选 | `deepseek` / 通义 / 智谱 |
| `DEEPSEEK_API_KEY` | 可选 | 留空 → 规则解析兜底 |
| `APP_HOST` / `APP_PORT` | 可选 | 默认 `127.0.0.1` / `8000` |
| `CORS_ORIGINS` | 可选 | 同源代理时通常不需要；直连时要把前端地址加进来 |
| `DATA_DIR` | 可选 | 默认 `./data`（POI、SQLite 缓存都在这） |
| `AMAP_CACHE_TTL_HOURS` | 可选 | 默认 168 |
| `SOLVER_TIME_LIMIT_S` / `SOLVER_PROBE_TIME_LIMIT_S` | 可选 | 求解时间上限 / 午餐探测上限 |

**`frontend/.env.local`**（模板见 `frontend/.env.example`）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `VITE_AMAP_JS_KEY` | **必须** | 没有它地图区域只显示"配置 Key"引导卡 |
| `VITE_AMAP_SECURITY_CODE` | 视 Key 而定 | 开了安全密钥就要填（JS API 2.0） |
| `VITE_API_BASE` | 可选 | 默认同源 `/api`；直连后端时写 `http://127.0.0.1:8000` |

> ⚠️ Vite **只在启动时**读 `.env.*`，改完必须重启 dev server。

### 4.3 账号与权限

| 账号 | 需要什么 | 去哪配 |
| --- | --- | --- |
| 高德开放平台 | 一个「Web 端(JS API)」Key（+安全密钥）；一个「Web 服务」Key。建议 Key 的**域名白名单留空**（否则换端口/IP 就打不开地图） | https://console.amap.com/dev/key/app |
| DeepSeek（或通义/智谱） | API Key | https://platform.deepseek.com/api_keys |
| GitHub | 一个仓库即可（历史上用过 `https://github.com/nako-ait/lushu`） | — |

**Key 的三条注入路径**（这版新增了后两条，很重要）：
1. `backend/.env` / `frontend/.env.local`（启动级，最稳）
2. **「个人」页填写** → 前端把 Key 放进请求头 `x-llm-key` / `x-amap-key`，**只存在浏览器 localStorage、不落盘不入库**
3. 都不填 → 走降级（规则解析 + 离线估算），界面上如实标注数据来源

---

## 5. 关键设计决策 / 踩过的坑 / 试过但不可行的方案

### 5.1 关键设计决策

1. **模型只管"听懂/选点/调参/解释"，排程全部交给确定性求解器**（OR-Tools 或纯 Python 兜底）。
   理由：时间窗、往返闭环、费用这类硬约束不能让语言模型拍脑袋。
2. **先提案、后执行**（`/api/ai/turn` 出提案 → `/api/ai/apply` 才改），并回一行变更回执。
   理由：AI 直接改路书不可控、不可解释。
3. **全链路可降级**：无 LLM → 规则；无高德 Key → 离线估算；无 OR-Tools → 贪心+2-opt。
   并且**界面上必须如实标注数据来源**（`dataSource` / `source` 字段）。
4. **矩阵用于排序，逐段真实路由用于展示**；时间轴/回程时刻**以逐段实算为准**
   （否则会出现"16:54 离开 + 回程 218 分钟 = 14:24 到酒店"这种自相矛盾）。
5. **重结果落 SQLite 缓存**（168h）：省配额、抗网络抖动；缓存键必须含方式/城市/策略。
6. **坐标全链路统一 GCJ-02**，不做任何转换（高德原生坐标系；避免 300~600 m 偏移）。
7. **【本次】分段混合交通决策**：用**真实路网距离**而非直线距离判断
   （上海过江：直线 1.5 km，真实驾车 5.2 km —— 直线距离会严重误判）。
8. **【本次】进出站惩罚只进矩阵、不进展示**：地铁/公交 10 分钟固定开销用于排序，
   展示用真实路由耗时（那段已含接驳步行），否则重复计算。

### 5.2 踩过的坑（每条都真踩过，改之前请先看）

| 坑 | 现象 | 结论 |
| --- | --- | --- |
| **"全天关闭"被当成"全天营业"** | 徐家汇天主教堂返回 `00:00-23:59` | 解析营业时间要**先找时间区间**再判断 24 小时；`全天` 后面跟"关闭/闭馆"时语义相反 |
| **同名异地匹配** | 搜「中共一大会址纪念馆」只返回「…**保管部**」，偏 3.5 km | 抓 POI 要过滤行政/设施类后缀（保管部/管理处/售票处…）+ 名称相似度打分 |
| **消费式正则吃掉第二个星期** | 「周一,周日 全天关闭」只析出周一 | 要逐个"周X"往后看，不能用会消费整段的正则（前后端两份实现都中过） |
| **撇号搞崩 TS 生成** | `Peet's皮爷咖啡` → 生成的 `.ts` 语法错误，前端编译不过 | 生成代码时所有字符串都要转义 + 生成后自检引号成对 |
| **数据刷新脚本不幂等** | 每跑一次 POI 库就膨胀一批（165 → 276） | 扩容要按"每类总量上限"补，而不是"每次再加一批" |
| **用高德名字覆盖人工名字** | `上海博物馆` → `上海博物馆(人民广场馆)`，演示线路（按名字查库）**全部失配** | 刷新快照时**保留人工整理的名字**，高德名字只做参考 |
| **Vite watcher EBUSY 崩掉** | 编辑工具在 `src/` 下产生临时目录 → dev server 直接退出 → **页面假死、点什么都没反应** | `vite.config.ts` 加 `server.watch.ignored`（见 §2.3-6） |
| **改 tailwind 配置不生效** | 语义色还是旧的 | 必须重启 dev server |
| **PowerShell/curl 访问外网 HTTPS 失败、Python 正常** | 误判成"网络断了" | 本机 Schannel 有问题；测外网一律用 Python |
| **here-string 吞掉引号** | PowerShell 里嵌 Python 代码报 `f-string` 语法错 | 复杂脚本先落盘成 `.py` 再执行，别内联 |
| **沙箱里 esbuild/pip 起不来** | `spawn EPERM` | 前端 dev server、pip/pnpm 安装需要更高权限（本机历史做法：提权执行） |

### 5.3 试过但**不可行**的方案（别再花时间）

| 方案 | 为什么不行 |
| --- | --- |
| 用高德**骑行**路径规划（1.2~3 km 分给骑行） | `/v3/direction/bicycling` 返回 `SERVICE_NOT_AVAILABLE`（当前 Key 无权限） |
| 用高德**等时圈**接口画可达范围 | `/v3/direction/isochrone` 同样不可用 → 只能自绘等速圆 + 用真实距离算 POI 可达性 |
| 把「一整天 6~8 个点」丢给高德 URI 当年途经点 | 高德 URI 的途经点是 `via` 参数，**最多 1 个且仅驾车模式**；只能**逐段**导航 |
| 用 `URLSearchParams` 拼高德 URI | 会与地名里的 `encodeURIComponent` **双重编码**，导航里地名变乱码；要手工拼 query |
| 在网页里做"真导航"（转向提示/跟随/偏航重算） | Web 没有这个能力（后台定位被节流、无语音播报）；正确做法是**唤起高德 App** |
| 用直线距离判断"这段该不该坐地铁" | 过江/高架会让直线距离与真实距离差 3 倍以上（实测 1.5 km vs 5.2 km） |
| 公交换乘矩阵逐格调真实接口 | 一次 N² 次调用，配额扛不住；只能用"驾车距离 × 系数"近似矩阵，真实公交只在逐段取 |

---

## 6. 版本 / 提交记录 / 回滚

### 6.1 版本历史（摘自 README）

| 版本 | 关键变化 |
| --- | --- |
| v1.0 | 基线：地图 + 时间轴 + AI 助手 + 口令分享 |
| v1.1 | 五页路由、竖排时间轴、意图卡、长图导出、本地账号与路线库 |
| v1.2 | 全局导航、首页悬浮气泡 + 底部输入、时间轴逐段换方式/增删点 |
| v1.3 | 修逐段高亮、删意图卡、**六城选择** |
| v1.4 | 逐段选中与地图联动、个人页 Key 真正生效（请求级密钥） |
| v1.5 | 工作台改版（酒店移右、左栏给 AI、搜索浮到地图左上） |
| v1.6 | 回复说人话 + 权重中文化 |
| v1.7 | 路线偏好卡片回到底栏 |
| v1.8 | **「混合」出行方式** + 逐段按各自方式算时间与费用 |
| v1.9 | 先确认再动手（turn/apply）+ 变更回执 + 能力边界话术 |
| v1.9.1 | 修复「连不上后端」：前端改同源 `/api` + 导航后端状态灯 |
| v1.10 | 对话接入大模型 + 最近 6 轮历史；修 `NO_PROXY` 含 `[::1]` 导致 LLM 客户端初始化即崩 |
| v1.11 | LangGraph 状态机、事实校验防编造、约束自动调档 |
| **v1.12** | **不再用正则否决模型**：改为「模型主导 + 有界工具循环（search_pois / preview_plan / propose_changes）」，`verify` 从"覆盖"改成"核对"（见 `docs/1.12_改动说明.md`） |
| **本次（未入库）** | 后端加「分段混合交通决策」+「拥堵自动寻优」；前端时间轴按 `transportMode` 换图标、加 ⚡️/💡 |

### 6.2 提交状态：**未提交（本机没有 git）**

事实：
- `C:\Users\35258\Desktop\lushu-main` **不是 git 仓库**（没有 `.git`）
- 本机 `git`、`gh` **均未安装**（`Get-Command git` 找不到）

**已做的替代措施**：生成了一份源码快照
`C:\Users\35258\Desktop\lushu-main-snapshot-20261027-2217.zip`
（143 个文件、1.81 MB，**只含源码与文档**，已排除 `node_modules/.venv/*.db/dist`）

**要变成真正的提交**，装好 Git 后执行（3 分钟）：

```powershell
cd C:\Users\35258\Desktop\lushu-main
git init -b main
git add -A
git status --short | Select-String "\.env|node_modules|\.venv|\.db"   # 必须无输出
git commit -m "feat: 分段混合交通决策 + 拥堵自动寻优（v1.12+）"
# 推到已有仓库（二选一）
git remote add origin https://github.com/nako-ait/lushu.git
git push -u origin main
```

> ⚠️ `backend/.env` 与 `frontend/.env.local` 含真实 Key，**已确认被 `.gitignore` 排除**，但仍建议提交前再跑一次上面那条 `Select-String` 检查。

### 6.3 回滚

| 场景 | 做法 |
| --- | --- |
| 只回滚本次两轮算法改动 | 用暂存目录 `C:\Users\35258\dsh-workspace\lushu\.patch\` 里的**改前版本**覆盖回去（该目录里是我改动前的原文件副本）——**这是最精确的回滚** |
| 回滚整个项目 | 解压 `lushu-main-snapshot-20261027-2217.zip` 覆盖 |
| 回滚到队友的上一版 | 从 GitHub `nako-ait/lushu` 重新拉取（若该仓库仍是你队友的最新版） |
| 只回滚某一段的行为（不改代码） | `backend/app/services/planner.py` 顶部两个常量：把 `MIX_FORCE_WALK_KM` 设为 0 就关闭"强制步行"，把 `MIX_SHORT_KM` 设为 0 就关闭"中短距离改步行"；`AUTO_CONGESTION_*` 同理可关掉拥堵寻优 |

---

## 7. 下一步建议与优先级

| 优先级 | 任务 | 为什么 | 大致工作量 |
| --- | --- | --- | --- |
| **P0** | **把代码提交进 git 并推远程** | 现在只有 zip 快照，没有历史，多人协作/回退都危险 | 10 分钟 |
| **P0** | 确认 `services/isochrone.py` 在接口不可用时**有降级**（等速圆） | 否则等时圈面板在白名单外的 Key 上会报错 | 0.5 天（若无降级） |
| **P0** | 给 `vite.config.ts` 补 `server.watch.ignored` | 防止 dev server 被临时目录搞崩（表现为"页面假死"） | 10 分钟 |
| **P1** | 演示前跑一遍 `verify_all.py` 把缓存捂热 + 准备录屏兜底 | 高德配额/网络是演示最大变量 | 30 分钟 |
| **P1** | 其他五城补一份**真实 POI 快照**（复用 `scripts/refresh_poi_snapshot.py`，把城市参数化） | 目前只有上海有 276 个真实点，其它城市靠在线搜索，断网就空 | 1 天 |
| **P1** | 移动端适配（至少时间轴与地图在 375px 宽度可用） | 现在的设计是桌面宽度 | 2~3 天 |
| **P2** | 骑行方式（换带权限的 Key 或前端 `AMap.Riding`） | 1.2~3 km 区间体验更完整 | 1 天 |
| **P2** | 公交矩阵换成真实公交换乘（按天批量 + 缓存） | 目前是驾车距离 × 系数近似 | 2 天 |
| **P2** | 服务端账号与分享持久化（现在分享数据库/账号都在本地） | 跨设备才能真分享 | 3 天+ |
| **P3** | 天气/门票/人流等外部数据 | 目前明确"没有这项数据" | 视数据源 |

**接手建议的第一步**：先按 §1.3 的验收清单跑一遍（5 分钟），确认状态与本文档一致，再动手改任何东西。

---

## 附录 A：本次会话对这份代码做了什么（逐文件）

> 前一份「旧工作副本」`C:\Users\35258\dsh-workspace\lushu` 里我做过很多改动（276 个 POI 快照、多城市、导航唤起、公交方案对比、等时圈等），
> **但那份已被本份取代**（这版 v1.12 里大多能力已有自己的实现）。下面只列**本次对 `Desktop\lushu-main` 的实际改动**。

| # | 文件 | 改动 |
| --- | --- | --- |
| 1 | `backend/app/services/amap_client.py` | ① `LegRoute` 增加 `is_auto_optimized / optimization_reason / optimization_hint`；② `build_matrix` 里对 `access_penalty_min > 0` 的方式（地铁/公交）给**矩阵耗时 +10 分钟**（只进矩阵，不进展示） |
| 2 | `backend/app/services/modes.py` | `ModeSpec` 增加 `access_penalty_min` 字段；transit / subway 设为 **10.0**，其余 0 |
| 3 | `backend/app/models.py` | `TransportLeg` 增加 `isAutoOptimized` / `optimizationReason` / `optimizationHint` / **`transportMode`**（后者是分段混合决策的结果，`mode` 保留兼容） |
| 4 | `backend/app/services/planner.py` | ① 新增 `_auto_optimize_legs()`：打车 <3km 且 >15 分 → 查步行，步行更快则**强制改步行**并标注原因；步行 >30 分 → 查打车，明显更快只给**提示**；② 新增 `_decide_leg_modes()`：**<1.2km 强制步行 / 1.2~3km（打车偏好时真实比耗时）/ >3km 用偏好**；③ 逐段路径获取改为"先定方式再查、一次 gather、两种候选取优"；④ 两处 `TransportLeg` 组装补 `transportMode` 与三个优化字段；⑤ 提示文案改用**真实路由里程/耗时**现算（不再做字符串替换） |
| 5 | `frontend/src/types/index.ts` | `TransportLeg` 增加四个字段（同上） |
| 6 | `frontend/src/lib/routeStyle.ts` | `ModeStyle` 增加 `icon`，五种方式分别 🚶🚌🚇🚕🚗 |
| 7 | `frontend/src/components/Timeline.tsx` | 每段图标改读 `transportMode`（回程同理）；新增 **⚡️ 已优化**（`title` = 原因）与 **💡 建议打车**（`title` = 省多少分钟/多少钱）徽标 |

**环境层面**（不是代码改动，但接手必须知道）：
将 `backend/.env`、`frontend/.env.local`、`backend/.venv`（**含 OR-Tools**）、`frontend/node_modules` 从旧副本复制进来；
并额外 `pnpm install` 补装了 **`react-router-dom@7.18.4`**（这版五页路由需要）。

**已验证**（本次）：
- `tsc --noEmit` **0 error**
- 后端 4 套件 `verify_all.py` **4/4 PASS**（改动前基线）
- 真实 `/api/plan` 四个场景：极短段强制步行 ✅、混合接力（地铁+步行）✅、打车 2.44km 真实比耗时并保持打车 ✅、步行 3.21km 给出 💡 提示 ✅
- 规则单元测试 **18/18 通过**（含"不该触发的段额外请求数 = 0"的断言）

---

## 附录 B：给接手者的 10 分钟自检

```text
1) 双击 启动.bat（或按 §3.3 手动起两个终端）
2) 打开 http://127.0.0.1:8000/api/health   → solver=ortools, amapConfigured=true, llmConfigured=true, poiCount=276
3) 打开 http://127.0.0.1:5173             → 地图正常（不是配置 Key 卡片）
4) cd backend && .venv\Scripts\python.exe scripts\verify_all.py   → 4/4 PASS
5) cd frontend && node node_modules\typescript\bin\tsc --noEmit    → 0 error
6) 页面上：选城市 → 搜一个地点加入 → 编译 → 时间轴有每段图标与时长
7) 交通方式切「地铁」，加一个很近的点（<1.2km）→ 那段应该是 🚶 且带 ⚡️（悬浮有原因）
8) 交通方式切「步行」，加一个 3km 外的点 → 应出现 💡 建议打车
```

以上全部通过 = 交接成功，可以放心开始改。
