# 路书编译师 TripCompiler

> 以**酒店为固定起点**、在地图上标定目的地、按地理位置与交通便利度，由 AI 自动编译多日出行路线的智能旅行规划工具。
> 目标城市：**上海**（坐标系统一 **GCJ-02**）

当前进度：**模块 1~5 全部完成并验证**（地图基础 · 路线规划 · 多日/权重/等时圈 · AI 能力 · 打磨与答辩材料）。
答辩材料见 [`docs/答辩提纲.md`](docs/答辩提纲.md) 与 [`docs/路书编译师_答辩.pptx`](docs/路书编译师_答辩.pptx)（13 页可编辑 PPT）。

---

## 一、目录结构

```
lushu/
├── README.md                        # 本文件：运行说明 / 模块进度 / 测试方法
├── .gitignore
├── docs/                            # ★ 模块 5：答辩材料
│   ├── 答辩提纲.md                   # 5 分钟 Demo 脚本 + PPT 逐页结构 + 12 个预判问答 + 兜底方案
│   ├── 路书编译师_答辩.pptx          # 13 页可编辑 PPT（由 build_ppt.py 生成）
│   └── build_ppt.py                 # PPT 生成脚本（改内容后重跑即可）
│
├── frontend/                        # React + Vite + TS + 高德 JS API + Tailwind + Zustand
│   ├── package.json
│   ├── pnpm-workspace.yaml          # pnpm 构建脚本白名单（放行 esbuild）
│   ├── vite.config.ts               # 别名 @ -> src，/api 代理到 127.0.0.1:8000
│   ├── tsconfig.json
│   ├── tailwind.config.js           # 语义色：hotel 蓝 / picked 橙 / candidate 灰
│   ├── postcss.config.js
│   ├── index.html
│   ├── .env.example                 # 环境变量模板
│   ├── .env.local                   # 本机配置（已 gitignore，填入你的高德 Key）
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                  # 整体布局：Header + 侧边栏 + 地图 + 底部总览条
│       ├── index.css                # Tailwind + 地图标记样式（.tc-pin 系列）
│       ├── vite-env.d.ts
│       ├── types/index.ts           # ★ 核心数据结构（与后端 models.py 一一对应）
│       ├── data/shanghaiPois.ts     # ★ 上海 37 个 POI 演示数据（GCJ-02）
│       ├── data/demoRoutes.ts       # ★ 三条主题演示线路（经典一日 / 浦江夜景 / 水乡两日）
│       ├── api/client.ts            # ★ 后端调用封装（超时/错误文案/预热）
│       ├── hooks/usePlanController.ts # ★ 编译路书的统一入口（按钮组共用）
│       ├── lib/
│       │   ├── amap.ts              # 高德 JS API 单例加载 + 逆地理编码 + POI 搜索
│       │   ├── mapInstance.ts       # 地图实例模块级单例（panTo / fitToPoints）
│       │   ├── routeStyle.ts        # 五种交通方式的标签/配色（对应后端 MODE_SPECS）
│       │   ├── routeOrder.ts        # ★ 序号与「计划是否过期」的单一真相
│       │   ├── geo.ts               # Haversine / 时间与金额格式化
│       │   ├── dom.ts               # escapeHtml + blockPropagation（防冒泡关键）
│       │   ├── labelLayout.ts       # ★ 地名标签碰撞避让（贪心占位 + 上下翻转）
│       │   ├── routeGeometry.ts     # ★ 真实路网折线（JS API 路径规划，后端无 Key 时兜底）
│       │   ├── routeFlow.ts         # ★ 路线上的流动箭头（rAF 沿弧长推进 + 自动转向）
│       │   └── id.ts
│       ├── store/useTripStore.ts    # ★ Zustand + persist(localStorage) 全局状态
│       └── components/
│           ├── MapView.tsx          # ★ 地图：三类标记 + 路线折线 + 交通徽标 + 等时圈
│           ├── Timeline.tsx         # ★ 底部时间轴：到达/停留/交通/统计/解释
│           ├── ModeSwitch.tsx       # ★ 五种交通方式切换（切换即重算）
│           ├── DayTabs.tsx          # ★ 多日切换（地图与时间轴联动）
│           ├── TripParamsPanel.tsx  # ★ 天数 / 权重滑杆 / 出发收工时间 / 午餐
│           ├── IsochronePanel.tsx   # ★ 酒店便利度：等时圈开关与可达 POI 列表
│           ├── AiPanel.tsx          # ★ AI 助手：解析标点 / 一句话重规划 / 路线讲解
│           ├── DemoRoutesPanel.tsx  # ★ 三条主题线路，一键铺好酒店+方式+天数+目的地
│           ├── BackendStatus.tsx    # ★ 页头后端状态胶囊（就绪 / 未启动 + 启动命令）
│           ├── MapLegend.tsx  MissingKeyCard.tsx
│           ├── Sidebar.tsx  HotelPanel.tsx  PoiQuickAdd.tsx
│           └── DestinationList.tsx  DestinationRow.tsx  BottomBar.tsx
│
└── backend/                         # FastAPI + OR-Tools + 高德 Web 服务 + SQLite
    ├── requirements.txt  .env.example  run.py
    ├── scripts/export_pois_from_ts.py # 由前端 TS 生成后端 POI JSON（单一数据源）
    ├── scripts/smoke_test.py          # 模块 1 接口冒烟测试（已 PASS）
    ├── scripts/test_plan.py           # 模块 2 端到端测试 + 演示脚本（已 PASS）
    ├── scripts/test_module3.py        # ★ 模块 3 多日 + 等时圈测试（已 PASS）
    ├── scripts/test_module4.py        # ★ 模块 4 AI 能力测试（已 PASS，默认测无 Key 降级路径）
    ├── scripts/verify_all.py          # ★ 一键全链路自检（进程内跑完上面四个套件）
    ├── data/shanghai_pois.json        # ★ 37 个 POI
    └── app/
        ├── main.py  config.py  models.py
        ├── routers/health.py  routers/poi.py  routers/plan.py
        │            routers/isochrone.py  routers/ai.py
        └── services/
            ├── poi_store.py         # POI 本地加载与检索（避开高德限流）
            ├── modes.py             # ★ 五种交通方式参数表（速度/费率/换乘/颜色）
            ├── cache.py             # ★ SQLite 键值缓存（距离矩阵/分段路径，TTL 7 天）
            ├── amap_client.py       # ★ 高德 Web 服务：距离矩阵 + 路径 + 地理编码 + 离线降级
            ├── cluster.py           # ★ 纯 Python KMeans 地理聚类（无 numpy/sklearn）
            ├── vrp.py               # ★ 多日分天 + 时间均衡
            ├── isochrone.py         # ★ 等时圈多边形 + 酒店交通便利度
            ├── ai_schemas.py        # ★ Function Calling 的 JSON Schema + Prompt 模板
            ├── llm.py               # ★ DeepSeek / 通义 / 智谱 统一客户端（OpenAI 兼容）
            ├── nlp_rules.py         # ★ 无 Key 时的规则解析（地点别名 + 偏好关键词）
            ├── ai_service.py        # ★ AI 编排：解析 / 重规划 / 解释，两条路径同构
            ├── tsp_core.py          # ★ 目标函数 / 时间窗 / 时间轴推演（两条求解路径共用）
            ├── solver.py            # ★ OR-Tools TSP（时间窗 + 迟到惩罚 + 漏点惩罚 + 子矩阵契约）
            ├── tsp_fallback.py      # ★ 纯 Python 兜底：贪心 + 2-opt
            ├── timeutil.py          # HH:mm 与营业时间解析
            └── planner.py           # ★ 编排：矩阵 → 分天 → 求解 → 精修 → 时间轴 → 统计 → 解释
```

模块 4~5 将在既有目录内**新增**文件（不推翻现有结构）：

```
backend/app/services/llm.py          # LLM Function Calling 封装 + Prompt 模板（模块 4）
backend/app/routers/ai.py            # POST /api/ai/parse | /replan | /explain（模块 4）
backend/app/services/geo.py          # WGS-84 <-> GCJ-02 转换（导入外部攻略时用）（模块 5）
frontend/src/components/AiPanel.tsx  # AI 自然语言输入与解释（模块 4）
frontend/src/components/WeightSliders.tsx  # 已在 TripParamsPanel 内实现（模块 3）
docs/答辩提纲.md                      # 答辩 PPT 结构与口播脚本（模块 5）
```

---

## 二、环境准备

### 1. 前端

```bash
cd frontend
pnpm install          # 或 npm install
```

> 若看到 `ERR_PNPM_IGNORED_BUILDS: esbuild`，说明 pnpm 拦了构建脚本。
> 本项目已在 `frontend/pnpm-workspace.yaml` 里写好 `allowBuilds: esbuild: true`，正常不会再出现。

### 2. 后端

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows；macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

> **Python 版本**：推荐 **3.11 / 3.12**。OR-Tools 对版本敏感，太新的 Python 可能没有 wheel。
> 装不上 OR-Tools 也不影响演示：模块 2 会提供纯 Python 的贪心 + 2-opt 兜底求解器。

---

## 三、Key 配置（两把钥匙，别搞混）

高德控制台 <https://console.amap.com/dev/key/app> 里要建**两个** Key：

| 用途 | 服务平台 | 放哪里 | 说明 |
| --- | --- | --- | --- |
| 地图显示 / 前端交互 | **Web端 (JS API)** | `frontend/.env.local` 的 `VITE_AMAP_JS_KEY` | 会暴露在浏览器，务必配 Referer/域名白名单 |
| 距离矩阵 / 路径规划 / 地理编码 | **Web服务** | `backend/.env` 的 `AMAP_WEB_KEY` | 绝不能放前端 |

`frontend/.env.local`（已生成，直接把值贴进去即可）：

```ini
VITE_AMAP_JS_KEY=你的JS API Key
VITE_AMAP_SECURITY_CODE=你的安全密钥     # 控制台开启「安全密钥」时必填
VITE_API_BASE=http://127.0.0.1:8000
```

> ⚠️ **JS API 2.0 的安全密钥必须在加载脚本前注入**，本项目已在 `src/lib/amap.ts` 里处理：
> `window._AMapSecurityConfig = { securityJsCode }`。
> ⚠️ Vite 只在**启动时**读 `.env.*`，改完必须**重启** `pnpm dev`。

LLM Key（模块 4 用，现在可以先不填）在 `backend/.env`：

```ini
LLM_PROVIDER=deepseek                # deepseek | qwen | zhipu
DEEPSEEK_API_KEY=sk-xxx
# DASHSCOPE_API_KEY=sk-xxx           # 通义千问
# ZHIPU_API_KEY=xxx                  # 智谱
```

---

## 四、启动

```bash
# 终端 1 —— 后端
cd backend
.venv\Scripts\activate
python run.py                        # http://127.0.0.1:8000/docs

# 终端 2 —— 前端
cd frontend
pnpm dev                             # http://127.0.0.1:5173
```

打开 <http://127.0.0.1:5173> 即可。未配置 Key 时页面会显示「配置高德 Key」引导卡片，而不是白屏。

---

## 五、模块 1 测试方法（逐条对应 P0 需求）

| # | 需求 | 操作 | 预期 |
| --- | --- | --- | --- |
| 1 | 酒店标记固定 | 打开页面 | 人民广场处出现蓝色方块标记（全图唯一的有彩色标记）；侧边栏无任何删除/取消酒店的入口 |
| 2 | 酒店搜索替换 | 侧边栏「出发酒店」输入`和平饭店`→回车，点结果 | 蓝标移动到该处并平滑定位；酒店名更新 |
| 3 | 地图空白处加候选点 | 点击地图任意空白处 | 立刻出现灰色小圆点，名称先显示「选址中…」，随后被逆地理编码改成最近 POI/地址名 |
| 4 | 缩放平移不消失 | 滚轮缩放、拖动地图 | 灰点始终挂在正确坐标上，大小不变（CircleMarker 用像素半径） |
| 5 | 刷新后仍在 | F5 刷新 | 所有候选点仍在（localStorage `tripcompiler:v1`），地图回到上次的视野 |
| 6 | 点标记切换选中 | 点灰点 | 变墨色带序号「1」；再点一次变回灰点 |
| 7 | **点标记不新增点** | 连续快速点标记 | 不会在旁边多出候选点（三重防冒泡：DOM stopPropagation + `bubble:false` + 400ms 时间戳兜底） |
| 8 | 侧边栏 ↔ 地图双向联动 | 点列表某行 / 点地图标记 | 行点选后地图定位到该点；地图上选中后列表同步高亮并显示相同序号 |
| 9 | 删除 / 清空 / 全选 | 行内 🗑、「删除选中」「清空」「全选」「取消全选」 | 列表与地图同步增删；「清空」有二次确认，且**不影响酒店** |
| 10 | 快速加点 | 「快速添加」输入`咖啡`/`外滩` | 本地模糊匹配出 POI，点击即加点并定位（零网络、零限流） |
| 11 | 一键演示 | 点「⚡ 一键载入演示线路」 | 6 个经典点被加入并直接选中，底栏统计随之更新 |
| 12 | 底部总览 | 选中若干点 | 显示 候选/选中 数量、直线里程（酒店往返）、停留合计、分段数 |

**后端接口自测**

```bash
curl http://127.0.0.1:8000/api/health
# {"status":"ok","version":"0.1.0","amapConfigured":false,"llmProvider":"deepseek","llmConfigured":false,"poiCount":37}

curl "http://127.0.0.1:8000/api/poi/search?q=外滩"
curl http://127.0.0.1:8000/api/poi/presets      # 37 条
```

**已做的自动化验证**

```bash
cd frontend
pnpm typecheck        # tsc --noEmit  —— 0 error
pnpm build            # tsc --noEmit && vite build —— 构建通过

cd ../backend
.venv\Scripts\python.exe scripts\verify_all.py     # ★ 一条命令跑完下面四个套件
# 或单独跑：
.venv\Scripts\python.exe scripts\smoke_test.py     # 模块 1：接口冒烟测试
.venv\Scripts\python.exe scripts\test_plan.py      # 模块 2：单日端到端
.venv\Scripts\python.exe scripts\test_module3.py   # 模块 3：多日 + 等时圈
.venv\Scripts\python.exe scripts\test_module4.py   # 模块 4：AI（默认测无 Key 降级路径）
```

实测结果（本仓库已跑过）：

- **前端**：`tsc --noEmit` **0 error**；`vite build` **67 modules transformed**，
  `dist/index.html 0.41 kB`、`dist/assets/index-*.css 21.69 kB (gzip 4.92 kB)`、
  `dist/assets/index-*.js 214.64 kB (gzip 69.37 kB)`。
- **答辩 PPT**：`check_office.py` 结构校验通过（13 页、5 条内容断言全 pass）；
  LibreOffice 渲染 8 页预览，无缺字、无文本溢出。
- **后端**（Python 3.14.3 + fastapi 0.143.1 / pydantic 2.14.1 / uvicorn 0.54.0 / httpx 0.28.1
  / **ortools 9.15**）：
  - `scripts/smoke_test.py` → **PASS**

    ```
    GET /                       -> 200 TripCompiler API
    GET /api/health             -> 200 {"status":"ok", ..., "poiCount":37, "solver":"ortools"}
    GET /api/poi/presets        -> 200 37 个 POI
    GET /api/poi/search?q=外滩  -> 200 ['外滩', '北外滩·白玉兰广场']
    GET /api/poi/search?q=咖啡  -> 200 ['思南公馆']
    坐标越界的 POI              -> 无
    ```
  - `scripts/test_plan.py` → **PASS**（5 种交通方式 + 4 组权重对照 + 多日 + 预热）
  - `scripts/test_module3.py` → **PASS**（单日对照 / 2 天 / 3 天分天 + 3 组权重 + 等时圈）
  - `scripts/test_module4.py` → **PASS**（4 组自然语言解析 + 3 组一句话重规划 + 解释 + 全链路）
  - 真实 `uvicorn` 启动后 HTTP 验证：`POST /api/plan`（3 天，polylines = 站点数 + 1）
    与 `POST /api/isochrone`（15/30/45 分钟 → 3/9/14 个 POI）均返回 200

> 安装依赖时如果某些包开始源码编译（很慢），加 `--only-binary=:all:` 强制使用 wheel：
> `pip install --only-binary=:all: -r requirements.txt`


---

## 六、模块 2 测试方法（路线规划核心）

### 6.1 后端：端到端测试脚本

```bash
cd backend
.venv\Scripts\python.exe scripts\test_plan.py
```

它会依次跑：5 种交通方式 × 同一组 6 个目的地 → 4 组权重敏感性对照 → 多日请求（days=3，已由模块 3 支持）
→ 缓存预热，并对每一步做一致性自检（时间轴不倒退、折线段数 = 站点数 + 1）。

实测输出（离线估算模式，节选）：

```
--- 交通方式 = 公交（transit） ---
  求解器 ortools-gls | 数据源 offline | 目标值 109.94 | 耗时 3073ms | 折线近似段 7
   1 09:02-11:02  上海博物馆     transit 1.6分 / 0.33km / 2.0元
   2 11:08-12:38  南京路步行街    transit 6.6分 / 1.39km / 2.0元      ← 含 60 分钟午餐
   3 12:50-13:50  外滩          transit 12.0分 / 2.52km / 2.0元
   4 14:01-15:31  豫园·城隍庙    transit 11.3分 / 2.37km / 2.0元      ← 16:45 关门，15:31 离开 ✅
   5 15:55-18:10  田子坊        transit 23.8分 / 5.01km / 2.0元
   6 18:21-19:51  新天地        transit 10.4分 / 2.18km / 2.0元
  返回酒店：20:01
  统计：步行 5.58 km | 交通 75.8 分钟 | 花费 14.0 元 | 站点 6 个

--- 交通方式 = 步行（walk） ---
  ⚠ 1 个点因时间窗/时长冲突未排入本日行程
  · 未排入：['田子坊']                      ← 走不完全天，自动丢点并说明原因

【权重敏感性】同一组点、同一交通方式，只改权重滑杆：
  默认         目标值 488.46 | 步行 28.54 km | 花费 14.61 元 | 外滩 → 五角场 → 陆家嘴滨江大道 → 七宝老街
  极度厌恶步行  目标值 484.70 | 步行 28.31 km | 花费 15.35 元 | 外滩 → 陆家嘴滨江大道 → 五角场 → 七宝老街
  极度在意换乘  目标值 258.43 | ...
  极度在意花费  目标值 216.69 | ...
[module2] PASS
```

手动用 curl 试一把：

```bash
curl -X POST http://127.0.0.1:8000/api/plan -H "Content-Type: application/json" -d '{
  "hotel": {"name":"人民广场","lng":121.4737,"lat":31.2304},
  "destinations": [
    {"id":"a","name":"外滩","lng":121.4903,"lat":31.2397,"selected":true,"source":"ai","stayMin":60},
    {"id":"b","name":"豫园","lng":121.4920,"lat":31.2270,"selected":true,"source":"ai","stayMin":90,"openTime":"08:45","closeTime":"16:45"}
  ],
  "days": 1, "mode": "transit",
  "weights": {"time":0.6,"convenience":0.5,"cost":0.4,"walking":0.5},
  "options": {"dayStartTime":"09:00","dayEndTime":"21:00","lunchBreakMin":60}
}'
```

### 6.2 前端：逐条对照 P0

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 载入演示线路 → 点「一键编译路书」 | 底部出现时间轴；地图上画出**白描边+彩色**折线，带方向箭头 |
| 2 | 观察折线颜色与徽标 | 颜色随交通方式变化；每段中点有「🚇 12 分」徽标 |
| 3 | 点某一段折线 | 弹出该段信息窗：时长 / 里程 / 费用 / 是否近似 |
| 4 | 看时间轴 | 每站显示 到达–离开、停留分钟、午餐标记、上一段交通耗时 |
| 5 | 看底栏统计 | 总步行 km / 总交通时间 / 总费用 三项与时间轴一致 |
| 6 | 点「为什么这样排？」 | 展开规则化解释 + 求解器名 + 数据来源 + 未排入的点及原因 |
| 7 | 切换交通方式（🚶🚌🚇🚕🚗） | **自动重新编译**，折线颜色、时间轴、统计全部刷新 |
| 8 | 改选点 / 改停留时间 | 时间轴出现「参数已变更，请重新编译」提示（不自动打断用户操作） |
| 9 | 点「预热缓存」 | 提示已预热 N 段路径（离线模式会说明无需预热） |
| 10 | 刷新页面 | 路书与折线仍在（PlanResponse 也持久化在 localStorage） |
| 11 | 关掉后端再点编译 | 底栏显示「连不上后端 + 启动命令」，不是白屏或静默失败 |

### 6.3 算法口径（答辩可直接讲）

**目标函数**（单位统一折算成「分钟当量」，数值可解释）：

```
弧成本(i→j) = w1 × 交通时间(分钟)
            + w2 × [换乘次数 × 每次换乘惩罚 + 方式不适感]
            + w3 × 费用(元) × 3        ← 1 元 ≈ 3 分钟心理成本
            + w4 × 步行里程(km) × 13.3 ← 4.5 km/h
总成本 = Σ 弧成本 + 漏点惩罚(600 分钟/点) + 迟到惩罚(20 分钟当量/分钟)
```

**约束**：

| 约束 | 实现方式 |
| --- | --- |
| 营业时间 | `CumulVar(i) ∈ [max(开门, 出发时间), 关门 - 停留]`（硬约束，不会排进已关门的景点） |
| 出发/结束时间 | 时间维度容量 = 收工 - 出发；回酒店时刻加软上界做迟到惩罚 |
| 必去/可选 | `AddDisjunction(penalty)`：必去点惩罚 = 1e7（等价硬约束），可选点 600 分钟当量 |
| 午餐休息 | 两遍求解：第一遍探出午餐落点，第二遍把 60 分钟并进那一站的服务时间 |
| 酒店闭环 | `RoutingIndexManager(size, 1, [0], [0])` 起点=终点 |
| 预算 | 已进目标函数（w3），硬预算上限在模块 3 追加 |

**为什么午餐要两遍求解**：一开始我只在时间轴上事后加 60 分钟，结果求解器算时间窗时是「乐观」的，
出现了「16:45 关门的豫园被排到 17:06」这种自相矛盾的结果。改成两遍求解后，求解器与时间轴
用的是同一套停留时间，时间窗与显示完全自洽 —— 这是本项目最值得讲的一个建模细节。


## 七、模块 3 测试方法（多日 + 权重 + 等时圈）

### 7.1 后端：多日与等时圈测试脚本

```bash
cd backend
.venv\Scripts\python.exe scripts\test_module3.py
```

实测输出（12 个点横跨浦西/浦东，离线估算模式，节选）：

```
--- 3 天 ---
  分天方式 kmeans+balance | 请求 3 天 / 实际 3 天 | 耗时 6016ms
  ⚠ 地理聚类分天：第1天 4 点（约 380 分钟，跨度 3.29 km） / 第2天 5 点（约 425 分钟，跨度 3.77 km） / 第3天 3 点（约 408 分钟，跨度 4.46 km）

  【第1天 · 地标】09:05–16:06  步行 4.89 km / 交通 66.4 分 / 花费 10.0 元
    1. 09:05-10:35 南京路步行街
    2. 10:56-11:56 1933 老场坊
    3. 12:11-14:11 外滩
    4. 14:22-15:52 豫园·城隍庙
  【第2天 · 街区】10:00–17:41  步行 5.96 km / 交通 81.0 分 / 花费 12.0 元
  【第3天 · 江景】09:28–16:49  步行 9.12 km / 交通 123.9 分 / 花费 8.05 元

【权重对分天的影响】3 天、只改权重滑杆：
  默认         目标值 358.86
  极度厌恶步行  目标值 349.18
  极度在意花费  目标值 208.42

【等时圈】酒店 = 人民广场，步行 15/30/45 分钟：
   15 分钟：可达  3 个热门 POI | 多边形 49 点 | 来源 offline-circle
   30 分钟：可达  9 个热门 POI | 多边形 49 点
   45 分钟：可达 14 个热门 POI | 多边形 49 点
  对照（打车）：15分钟 23 个 / 30分钟 33 个
[module3] PASS
```

### 7.2 前端：逐条对照 P1

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 「行程参数」把天数改成 3 → 重新编译 | 出现多日切换条；每天一个 Tab（标题 + 站数 + 步行 km） |
| 2 | 点第 2 天的 Tab | 地图只画第 2 天的折线；**属于别的天的点退回灰色候选态**；侧边栏用 D1/D3 标签区分 |
| 3 | 看 Tab 右侧 | 「全程合计：步行 X km · 交通 Y 分钟 · Z 元」（跨天汇总） |
| 4 | 拖动权重滑杆 | 底栏出现「参数已变更，请重新编译」；重新编译后目标值与顺序变化 |
| 5 | 改「出发 / 收工 / 午餐」时间 | 同样触发过期提示；编译后时间轴整体平移 |
| 6 | 「酒店便利度」勾选等时圈 | 地图出现 15/30/45 分钟三层半透明圈（绿/黄/橙），图例显示各带可达 POI 数 |
| 7 | 换酒店后再看等时圈 | 数据自动失效，点「重新计算」得到新酒店的便利度 |
| 8 | 切换交通方式 | 等时圈与路线都按新方式重算（打车 15 分钟可达 23 个 POI vs 步行 3 个） |

### 7.3 多日算法口径（答辩可直接讲）

```
第一步：地理聚类 —— 对所有选中点做 KMeans（等距圆柱投影 + k-means++），
        得到「按地理位置自然成团」的初始分天
第二步：时间均衡 —— 用最近邻顺序估算每天的时长，把最重那天的「边缘点」
        （离最轻那天质心最近的点）挪过去，只接受方差下降且不顶爆预算的移动
        （例：4 点/5 点/3 点，约 380/425/408 分钟）
第三步：每天各自 TSP —— 复用模块 2 的 OR-Tools 模型（营业时间窗 + 午餐 + 漏点惩罚）
        OR-Tools 的模型里只放本日的点，所以不可能出现「第 1 天绕去第 2 天的目的地」

为什么不做「一次性 7 天 VRP」：酒店是每天共同的起点与终点，问题天然可分解为
「先分天、再每天 TSP」；规模小（秒级收敛）、结果可解释（第 1 天在黄浦-静安、
第 2 天在浦东）、每天的营业时间窗与午餐约束互不干扰。
```

**等时圈的两条路径**：有高德 Web 服务 Key 时优先调用高德等时圈接口拿真实路网边界；
无 Key 或调用失败时退化为「等速圆」（平均速度 × 时间 ÷ 绕行系数，48 个方位角采样）。
但**可达 POI 统计永远走真实距离矩阵**（一次 `v3/distance` 批量请求），
所以「15 分钟可达 3 个热门 POI」这个结论不是画出来的，是算出来的。



## 八、模块 4 测试方法（AI 能力）

### 8.1 后端：AI 端到端测试（默认验证「没有 Key」的降级路径）

```bash
cd backend
.venv\Scripts\python.exe scripts\test_module4.py
```

实测输出（未配置任何 LLM Key，`source=rules`）：

```
[ai/health] {"configured": false, "provider": "deepseek", "ok": false}
未配置 LLM Key：下面的解析走内置规则（source=rules），这正是现场兜底路径

【1. 自然语言 -> 目的地】
  「我想去外滩、豫园、武康路」
    命中=['武康路·武康大楼', '外滩', '豫园·城隍庙'] 未识别=[]
  「带爸妈玩两天，想去朱家角、七宝老街，别安排太累」
    命中=['七宝老街', '朱家角古镇']   · 天数 → 2
  「想去看看公园和博物馆，少走路」
    按标签「博物馆/公园」补位：4 个地点  · 少走 → walking=0.95
  「今天天气不错」
    没有匹配到可规划的地点：今天天气不错        ← 不瞎猜

【2. 一句话重规划】
  「少走路，多拍照，6 点前回酒店」
    生效变更：['权重「walking」→ 0.95', '收工时间 → 18:00', '交通方式 → 步行']
    重算结果：4 站，09:03–17:33，步行 6.98 km、花费 0.0 元
  「改成 3 天，用地铁，省点钱」
    生效变更：['权重「cost」→ 0.9', '天数 → 3', '交通方式 → 地铁']
  「我不想去田子坊了」
    生效变更：['移除：田子坊']   重算结果：5 站

【3. 路线解释】 source=rules（无 Key 时直接回求解器的规则化解释）
【4. 解析 + 规划全链路】解析出 3 个点 → 规划成功：新天地 → 豫园·城隍庙 → 外滩
[module4] PASS
```

> **配了 LLM Key 时同一个脚本会自动走大模型路径**，输出 `source=llm` 与 token 用量，
> 断言完全一样 —— 这就是「两条路径同构」的好处。

**营业时间约束注入**：AI 解析出的地点会自动带上预置 POI 的营业时间（`openTime/closeTime`），
随目的地一起进入 OR-Tools 的时间窗约束 —— 也就是说「用一句话说想去豫园」之后，
求解器仍然知道豫园 16:45 关门，不会把它排到 17:00。这条链路是：
`ai/parse` → `ResolvedPlace.openTime` → 前端 `addDestinations` → `PlanRequest.destinations`
→ `_build_nodes()` 的 `parse_business_hours()` → `CumulVar.SetRange(开门, 关门 - 停留)`。

### 8.2 Function Calling 的 JSON Schema（完整版见 `services/ai_schemas.py`）

```jsonc
// 工具 1：自然语言 -> 目的地（关键：不要经纬度，坐标由后端地理编码补齐）
{
  "name": "add_destinations",
  "parameters": {
    "type": "object",
    "properties": {
      "places": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name":    { "type": "string",  "description": "上海本地常用全称，如「豫园·城隍庙」" },
            "stayMin": { "type": "integer", "description": "建议停留分钟数；用户没提就不要填" },
            "tags":    { "type": "array", "items": { "type": "string" } },
            "reason":  { "type": "string" }
          },
          "required": ["name"], "additionalProperties": false
        }
      },
      "exclude": { "type": "array", "items": { "type": "string" } },
      "summary": { "type": "string" }
    },
    "required": ["places"], "additionalProperties": false
  }
}

// 工具 2：一句话重规划 -> 结构化调整参数（只填需要改变的字段）
{
  "name": "replan_constraints",
  "parameters": {
    "type": "object",
    "properties": {
      "weights": {
        "type": "object",
        "properties": {
          "time":        { "type": "number", "description": "在意总耗时" },
          "convenience": { "type": "number", "description": "在意少换乘" },
          "cost":        { "type": "number", "description": "在意花费" },
          "walking":     { "type": "number", "description": "在意步行距离" }
        },
        "additionalProperties": false
      },
      "dayStartTime":  { "type": "string", "description": "HH:mm" },
      "dayEndTime":    { "type": "string", "description": "「6 点前回酒店」→ 18:00" },
      "lunchBreakMin": { "type": "integer" },
      "days":          { "type": "integer" },
      "mode":          { "type": "string", "enum": ["walk","transit","subway","taxi","drive"] },
      "mustVisitNames": { "type": "array", "items": { "type": "string" } },
      "removeNames":    { "type": "array", "items": { "type": "string" } },
      "intentSummary":  { "type": "string" }
    },
    "required": [], "additionalProperties": false
  }
}
```

**Prompt 模板**（同样在 `ai_schemas.py`，这里给核心片段）：

```text
[地点解析 System Prompt]
你是「路书编译师」的地点解析助手，只服务上海地区的旅行规划。
1. 只输出用户真实提到或强烈暗示的地点。宁可少，也不要为了凑数编造地点。
2. 绝对不要输出经纬度 —— 坐标由后端地理编码补齐，你编的坐标会造成几百米甚至几公里的偏移。
3. 地名用上海本地常用全称：「豫园」→「豫园·城隍庙」，「武康路」→「武康路·武康大楼」。
4. 用户提到时长就填 stayMin（一小时=60，随便看看=30，深度逛=120）。
5. 用户说「不要/去掉/除了 X」的，放进 exclude。
6. 只是在聊天、没提地点时：places 返回空数组，并在 summary 里说明原因。
（附 3 个 few-shot 示例）

[重规划 System Prompt]
用户这句话是对已经排好的路书提出的修改意见。
1. 只填需要改变的字段，没提到的不要填，不要"顺手"改。
2. 「6 点前回酒店」→ dayEndTime="18:00"；「早点出发」→ dayStartTime="08:30"。
3. 「别安排太满」→ 增加 days 或用 removeNames 去掉最边缘的点。
4. intentSummary 用一句话复述你的理解，方便用户核对。

[解释 System Prompt]
1. 先说整体思路（按地理位置分天 / 先近后远 / 避免来回绕路），再点出 1~2 个具体理由。
2. 数字必须用 JSON 里的真实数字，一个都不要编。
3. 有地点因营业时间或全天时长被排掉，要诚实说明。
4. 不要 markdown 标题/列表，说人话，150 字以内。
```

### 8.3 前端：逐条对照 P1

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 输入「我想去外滩、豫园、武康路」→「解析并标点」 | 三个点直接出现在地图上并已选中；提示「已标点 3 个地点」 |
| 2 | 看面板右上角徽标 | `⚙️ 规则解析`（无 Key）或 `🧠 大模型`（有 Key）—— 来源永远诚实标注 |
| 3 | 输入「今天天气不错」→「解析并标点」 | 明确提示没解析出地点，**不瞎猜、不乱标** |
| 4 | 输入「少走路，多拍照，6 点前回酒店」→「一句话重规划」 | 提示「已重算：权重 walking→0.95；收工时间 → 18:00」；时间轴整体提前，**且不会因为"多拍照"新增地点** |
| 5 | 输入「改成 3 天，用地铁，省点钱」→ 重规划 | 出现多日 Tab；交通方式按钮跳到地铁；权重滑杆同步变化 |
| 6 | 输入「我不想去田子坊了」→ 重规划 | 该点被取消选中（列表变灰），路线里不再有它 |
| 7 | 点「讲讲为什么这样排」 | 出现讲解卡片，右下角标注来源；无 Key 时就是求解器的规则化解释 |
| 8 | 关掉后端再点任意 AI 按钮 | 底栏报「连不上后端 + 启动命令」，不白屏 |



## 九、模块 5 测试方法（打磨与演示准备）

### 9.1 一键全链路自检

```bash
cd backend
.venv\Scripts\python.exe scripts\verify_all.py
```

实测输出：

```
====================================================================================
路书编译师 TripCompiler —— 全链路自检
====================================================================================
  ✅ 模块 1  POI 数据与接口冒烟  (1.3s)
  ✅ 模块 2  单日路线规划（5 种交通方式 + 权重）  (24.5s)
  ✅ 模块 3  多日分天 + 等时圈  (32.2s)
  ✅ 模块 4  AI 解析 / 一句话重规划 / 解释  (14.4s)
------------------------------------------------------------------------------------
  合计 4 个套件，通过 4 个，总耗时 72.3s
====================================================================================
[verify_all] PASS
```

> 实现细节：在**同一个进程内** import 并调用各脚本的 `main()`，不用 subprocess 管道 ——
> 这样在任何受限环境里都能跑，也更快。失败时只回显该套件输出的末尾 18 行。

### 9.2 三条主题演示线路

左侧「主题演示线路」一键铺好完整场景（酒店 + 交通方式 + 天数 + 一组目的地），
勾选「载入后自动编译」后点一下就直接进入有路线的状态，**答辩现场不用现场点地图**：

| 线路 | 演示什么 | 内容 |
| --- | --- | --- |
| 🏛 经典一日 | 单日 TSP + 营业时间窗 | 人民广场出发，6 点，公交（豫园 16:45 关门会被正确安排） |
| 🌃 浦江夜景 | 打车 + 晚场时间窗 + 沿江顺路 | 外滩出发，6 点，含上海之巅观光厅 |
| 🛶 水乡两日 | 多日地理聚类 | 徐家汇出发，7 点，朱家角/七宝在西、市区在东 |

> 三条线路引用的 19 个地点**全部命中预置 POI 库**（有自动化脚本核验过）。
> 演示起点用的是同名地标坐标，可用「出发酒店」搜索真实酒店替换。

### 9.3 演示前的 5 分钟检查清单

1. `python scripts/verify_all.py` —— 四套件全绿再上台（顺便把 SQLite 缓存捂热）
2. 两个终端：后端 `python run.py`、前端 `pnpm dev`，浏览器开 http://127.0.0.1:5173
3. 看页头胶囊：显示「● 后端就绪 · ortools」才开讲；红色就按悬停提示重启后端
4. 兜底：完整 Demo 录屏一遍；任何一环崩了直接切录屏
5. 底牌：`frontend/.env.local` 里 Key 注释掉就是**全离线路径**（离线估算 + 规则解析），

   评委问「没 Key 怎么办」时可以直接演给他看

### 9.4 答辩材料

- [`docs/答辩提纲.md`](docs/答辩提纲.md)：5 分钟 Demo 逐秒脚本、14 页 PPT 结构、口播词、
  **12 个预判问答**（为什么不用一次性 VRP / 权重改不动顺序 / 没 Key 怎么演 / AI 会不会编坐标 …）、
  兜底方案与一键复现命令
- [`docs/路书编译师_答辩.pptx`](docs/路书编译师_答辩.pptx)：13 页可编辑 PPT，
  由 [`docs/build_ppt.py`](docs/build_ppt.py) 生成（改内容后重跑脚本即可）



## 十、踩坑备忘录（已在本项目代码里规避）

1. **GCJ-02 不要混 WGS-84**：全项目坐标只来自高德（地图点击、PlaceSearch、Geocoder），
   `types/index.ts` 与 `models.py` 都标注了这一点。若要接入 GPS/第三方数据，必须转换。
2. **标记点击必须阻止冒泡**：自定义 DOM 标记在 `lib/dom.ts#blockPropagation` 里对
   click/dblclick/pointerdown/mousedown/touchstart 全部 `stopPropagation`；
   CircleMarker 额外设 `bubble:false`；地图 click 再用 400ms 时间戳兜底。
   三重保险，因为不同版本的 JS API 冒泡行为不一致。
3. **标记常显不要每次清空重建**：`MapView` 用 `Map<id, overlay>` 注册表做**增量 diff**，
   只增删差异项，已存在的仅 `setPosition`，避免闪烁与「平移后标记消失」。
   点位超过 200 个时应换成 `AMap.MassMarks` 或 GeoJSON 图层（选中点仍单独用 Marker 渲染）。
4. **API 限流**：距离矩阵与路径规划一律走后端 + 磁盘缓存（`AMAP_CACHE_TTL_HOURS`，模块 2 实现）；
   演示前先预跑一遍把缓存捂热；POI 数据本地化（37 条）避免现场打搜索接口。
5. **网络不稳**：`data/shanghai_pois.json` 与前端 `shanghaiPois.ts` 是离线兜底数据；
   答辩前录屏。
6. **Vite 只在启动时读 .env**：改完 Key 必须重启 dev server。
7. **pnpm 11 的构建脚本白名单**：不写 `pnpm-workspace.yaml` 的 `allowBuilds` 会导致
   `pnpm run build` 直接失败（esbuild 二进制没落地）。
8. **OR-Tools 的软约束 API 在不同版本里不一样**：我先用了 `IntVar.SetSoftUpperBound`，
   在 OR-Tools 9.15 上直接抛 `AttributeError`（结果是静默降级到兜底求解器，路线质量悄悄变差）。
   正确写法是路由维度上的 `RoutingDimension.SetCumulVarSoftUpperBound(index, upper, coefficient)`。
   **教训：求解器降级必须报出来** —— 现在 `solver.notes` 会把降级原因写进接口响应，
   时间轴上能看到「求解器 ortools-gls / python-greedy-2opt」，不会假装自己是最优解。
9. **求解模型与展示口径必须一致**：午餐时间如果只在时间轴上事后加 60 分钟，求解器算时间窗时
   就是「乐观」的，会出现 16:45 关门的景点被排到 17:06。现在改成两遍求解把午餐并进服务时间，
   并保留 `schedule()` 这个独立推演器做**交叉校验**，一旦不自洽立刻报警。
10. **验证「时间是自洽的」不能只靠肉眼**：`scripts/test_plan.py` 会断言「后一站到达时间 ≥ 前一站
    离开时间」与「折线段数 = 站点数 + 1」，把这类低级错误挡在演示之前。
11. **OR-Tools 默认要求访问模型里的每一个节点**（模块 3 踩到的坑）：多日模式下把「所有天的点」
    的矩阵丢进求解器，再对某一天求解时，求解器会把**别的天的目的地也排进去**
    （`order` 里出现不属于本日的下标，时间轴直接 KeyError）。
    给它加 0 惩罚的 disjunction 也拦不住。正确做法是在 `solver.solve()` 里做**契约检查**：
    矩阵必须与 nodes 一一对应，不一致就自动取子矩阵 + 下标重映射，返回的顺序仍是原下标空间。
    这样任何调用方都不可能踩到，多日分天与单日求解共用一套代码。
12. **纯 Python KMeans 够用就别引重依赖**：几十个点、几十公里的城市尺度下，
    等距圆柱投影 + 欧氏距离与球面距离误差在 0.1% 量级，省掉 numpy/scikit-learn 两个重依赖，
    装环境更快、答辩也好讲。地理位置分天本身对聚类精度并不敏感。
13. **AI 一定要有降级路径，而且降级路径要真的被测**：模块 4 的规则解析器是在
    "没有 Key" 的情况下写的，也只在没有 Key 的情况下跑测试 —— 结果第一版就暴露了三个真问题：
    「6 点前回酒店」被解析成 06:00、「多拍照」被当成"新增 3 个拍照地点"、
    「省点钱」没命中省钱规则。**大模型能兜住的模糊表达，规则路径必须显式处理**；
    反过来，规则路径能过的用例，大模型路径通常也没问题。两条路径产出同构参数是这里的关键设计。
14. **别让模型输出坐标**：地点 -> 坐标全部由后端做（预置 POI 命中 → 高德地理编码），
    解析不到就原样报「未识别」，绝不猜。模型编的坐标会造成几百米的偏移，
    而且会把「坐标系一致性」这个底线毁掉。
15. **地名标签会叠成一团**：点选 9 个点后，人民广场附近的名称标签直接糊成一片，
    还会盖住酒店方块和路线上的时长徽标。解法是 `lib/labelLayout.ts` 的屏幕空间贪心占位：
    优先级 = 酒店 → 已选点（按路线序号）→ 候选点；上方放不下就翻到针头下方，两处都放不下才隐藏标签
    （标记本身不动，点一下仍有 InfoWindow）。障碍物里**排除自己的针头** —— 否则每个标签都会判定为
    "压住了自己"。触发时机是 `moveend / zoomend / resize` 与每次标记增删改，都在 rAF 里量尺寸，
    所以不会出现跟随地图抖动闪烁。
16. **没配「Web 服务」Key 时，路线就是直升机**：后端只能算「直线 × 绕行系数」，
    地图上两点一线，和交通方式完全无关。补法是 `lib/routeGeometry.ts`：
    用 JS API 已有的 Walking / Driving / Transfer 插件在前端取真实路网折线
    （后端 `dataSource=amap` 时自动跳过）。踩到两个坑：
    ① 高德对**过近**的公交查询返回 `status=complete` 但 `info=NO_DATA`、没有 `plans` ——
       必须按 `plans[0]` 是否存在判失败，不能只看 status；没有公交就退成步行（近）或驾车（远）真实路网。
    ② 并发十几个请求会触发 QPS 限制、大面积失败 —— 改成**逐段串行 + 160ms 间隔**后一次通过。
17. **Polyline 的虚线动不了**：JS API 2.0 有 `strokeDasharray` 但没有 `strokeDashoffset`，
    想靠改虚线偏移做「流动线条」是行不通的。最终用 `lib/routeFlow.ts`：
    沿路径摆一串小箭头 Marker，rAF 按弧长推进 + `setAngle` 自动转向；
    箭头用「白色主体 + 路线同色描边」，否则纯白箭头压在墨线上会像一块白色窟窿。
    只对点数 > 2 的真实折线启用 —— 两点直线不流动，不把估算伪装成真实路径。

---

## 十一、POI 数据快照：从高德刷新（含按类别扩容）

预置 POI 库最初是**手工整理**的，其中坐标和营业时间都是"凭印象填"的。实测发现问题很严重：

| 问题 | 实测结果 |
| --- | --- |
| 手写坐标偏差 | 14 个点偏差 > 500m，最大 **3539m**（中共一大会址那次的匹配也错了，见下） |
| 手写营业时间与高德不符 | 22 个点不一致（豫园 08:45-16:45 vs 高德 08:30-16:30 等） |

所以引入了离线刷新脚本 [`backend/scripts/refresh_poi_snapshot.py`](backend/scripts/refresh_poi_snapshot.py)：

```
.venv\Scripts\python.exe scripts/refresh_poi_snapshot.py              # 刷新 + 扩容（幂等）
.venv\Scripts\python.exe scripts/refresh_poi_snapshot.py --no-expand  # 只刷新原有 POI
.venv\Scripts\python.exe scripts/refresh_poi_snapshot.py --dry-run    # 只出报告，不写文件
```

**为什么是离线脚本而不是运行时查询**：现场演示必须零网络依赖。这和距离矩阵落 SQLite
缓存是同一个思路 —— 把不可靠的实时依赖转成可靠的本地快照。

- 数据来源：高德 Web 服务 `v3/place/text`（GCJ-02，`extensions=all` 才带 `biz_ext`）
- 产物：`backend/data/shanghai_pois.json` + `frontend/src/data/shanghaiPois.ts`（单一数据源同时产出）
- 质量报告：[`docs/poi-refresh-report.md`](docs/poi-refresh-report.md)（坐标修正/时间冲突/同名异地/闭馆日）
- 规模：**276** 个（37 个人工整理 + 14 个类别批量抓取）
- 请求结果全部落 SQLite 缓存，**重跑不再消耗配额**；按类别按"总量上限"补点，**幂等**

### 五条关键设计决策

1. **只替换客观字段**：坐标/地址/营业时间/评分/amapId 用高德的；
   `tags`（夜景/拍照/citywalk 这类**规划语义标签**）和 `stayMin` 人工保留 —— 高德给不了。
2. **名字保留人工版本**：3 条主题演示线路是**按名字**查预置库的，
   用高德名字覆盖（`上海博物馆` → `上海博物馆(人民广场馆)`）会让线路直接失配。
3. **「24小时营业」冲突时保留人工时段**：高德的"24小时"很多时候等于"没有数据"。
   世纪公园若采信高德就会被排到晚上 8 点 —— 那是**数据质量倒退**。
   现在保留人工时段并在报告里逐条列出供确认。
4. **解析不出营业时间 → 不加时间窗约束**（不是当成 24 小时）。
5. **「周一闭馆」只在界面提示，不进求解器** —— 我们的时间窗模型没有星期维度。
   界面上会显示「今天闭馆」红色徽标（`closedWeekdays` + `isClosedToday()`）。

### 这一轮抓到的 6 个坑（都有教学价值）

| 坑 | 现象 | 修法 |
| --- | --- | --- |
| `全天关闭` 被当成全天营业 | 徐家汇天主教堂返回 `00:00-23:59` | **先找时间区间**，再判 24 小时；含"关闭"就不算全天营业 |
| 匹配到同名异地 | 「中共一大会址纪念馆」→ 高德只返回「…**保管部**」（偏 3539m） | 行政/设施后缀黑名单 + 名称相似度打分 + 备用关键词 |
| 消费式正则吃掉第二个星期 | 「周一,周日 全天关闭」只析出周一 | 改成**逐个星期往后看**（前后端各一份实现都要改） |
| 撇号搞崩 TS 生成 | `Peet's皮爷咖啡` → 生成文件语法错误，前端编译不过 | 所有字符串字段统一转义 + **生成后自检引号是否成对** |
| 脚本不幂等 | 每跑一次就多一批（165 → 276） | 按"每类别总量上限"补点，而不是"每次再加一批" |
| 闭馆日误报 | 「周一至周日 09:00-17:00（周一闭馆）」析出"整周闭馆" | 全周范围不算闭馆；含时间区间的分句只走"紧邻匹配" |

> 还有一条差点埋雷的：扩容时若直接采用高德的 POI 名字，
> `上海博物馆` 会变成 `上海博物馆(人民广场馆)`，而演示线路按原名查库 → **直接失配**。
> 是"保留人工名字"这条规则救回来的（改完专门跑了一次 19 个引用的命中校验）。

---

## 十二、导航：交回给高德 App

网页版 JS API **没有真正的导航能力**（无 turn-by-turn 播报、无后台持续定位、切后台就被节流），
所以本项目的做法是：**把「从 A 到 B」交给高德 App 自己导航**，我们只负责把坐标和出行方式递过去。

实现见 [`frontend/src/lib/amapNav.ts`](frontend/src/lib/amapNav.ts)，UI 入口在时间轴的每个站点卡片上：

| 按钮 | 作用 |
| --- | --- |
| 🧭 | 从**上一站**（首站从酒店）导航到这一站 —— 与路书的逐段语义完全一致 |
| 📍 | 从**我的当前位置**导航到这一站（`from` 留空，高德在移动端自动取当前位置） |

### 核对官方文档后得到的三个事实（与直觉不一样，值得记下来）

来源：[高德 URI API — 路径规划](https://developer.amap.com/api/uri-api/guide/travel/route)（2025-03 更新）

1. **途经点用 `via` 参数，最多只支持 1 个，而且只在驾车模式有效。**
   → 所以「把一整天 6 个点一次性丢给高德当途经点」**做不了**，只能逐段导航。
   （我最初的设计假设是错的，核对文档时才发现并改掉。）
2. **没有 `coordinate` 参数** —— 高德 URI 本来吃的就是 GCJ-02，
   而本项目全链路统一 GCJ-02，所以直接传即可，**零坐标转换**。
   这是当初坚持「坐标只来自高德」换来的红利。
3. `callnative=1` 与「`from` 留空自动用当前位置」**都只在移动端生效**；
   PC 浏览器上会打开高德网页版。

### 权重滑杆 → 高德路线策略（policy）

用户在小程序里调的偏好会一路带到导航里，而不是到导航就丢了：

| 我们的权重 | 出行方式 | 传给的 policy |
| --- | --- | --- |
| 步行 ≥ 0.7 | 公交 / 地铁 | `2` 步行少 |
| 换乘 ≥ 0.7 | 公交 / 地铁 | `1` 换乘少 |
| 时间 ≥ 0.7 | 打车 / 驾车 | `1` 避免拥堵 |
| 花费 ≥ 0.7 | 打车 / 驾车 | `2` 避免收费 |

出行方式映射：`walk→walk`、`transit/subway→bus`、`taxi/drive→car`。

### 两个实现细节

- 用 `<a href target="_blank">` 而不是 `window.open` —— 移动端浏览器会拦截脚本打开的窗口，
  而用户主动点击的 `<a>` 能可靠唤起 App，还能长按复制链接。
- **URL 手工拼接，不用 `URLSearchParams`**：它会与地名里的 `encodeURIComponent`
  叠加成双重编码（`外滩` → `%25E5%25A4%2596`），导航里显示的起终点名会变成乱码。
  这个 bug 是把生成的 URL 真打出来看一眼才发现的。

---

## 十三、后续可做（P2）

模块 1~5 的 P0/P1 需求已全部交付。如果还有时间，优先级从高到低：

1. **攻略导入**：小红书链接 → 正文抽取 → 地点识别（复用 `nlp_rules` 的别名表）
2. **截图 OCR**：识别店名后走高德地理编码标点（后端已有 `geocode_name()` 通路）
3. **天气动态重排**：接入天气 API，雨天把户外点换到晴天（只需给 `planner` 加一个偏好项）
4. **多人偏好合并**：每人一套权重 → 求 Pareto 折中（现有权重结构可直接扩展成多组）
5. **公交/地铁矩阵精修**：目前是「驾车时长 × 系数 + 换乘惩罚」的近似，
   可改为按天批量调用 `v3/direction/transit/integrated` 落到缓存里
6. **多城市**：把 `SHANGHAI_POIS`、别名表、高德 `citycode`（现写死 `021`）三处参数化
