"""核心数据模型（Pydantic v2）。

字段命名刻意保持 camelCase，与前端 TypeScript 类型一一对应，
前后端 JSON 直接互通、无需 alias 转换。

坐标约定：全部为 GCJ-02（高德坐标系），后端不做任何坐标系转换。
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

DestinationSource = Literal["map-click", "search", "ai", "import"]
TravelMode = Literal["walk", "transit", "subway", "taxi", "drive"]


class Destination(BaseModel):
    """候选/选中目的地"""

    id: str
    name: str
    lng: float
    lat: float
    selected: bool = False
    source: DestinationSource = "map-click"
    stayMin: int | None = 60
    openTime: str | None = None
    closeTime: str | None = None
    tags: list[str] | None = None
    address: str | None = None


class Hotel(BaseModel):
    """酒店：固定起点"""

    lng: float
    lat: float
    name: str
    address: str | None = None


class Weights(BaseModel):
    """可调权重（0~1），后端归一化后进入目标函数"""

    time: float = 0.6
    convenience: float = 0.5
    cost: float = 0.4
    walking: float = 0.5


class TransitRide(BaseModel):
    """公交/地铁方案里的一段乘车：坐哪条线、从哪站到哪站"""

    kind: str = "公交"          # 地铁 / 公交 / 快速公交 / 轮渡…
    line: str = ""              # 地铁8号线（已去掉"(--终点)"后缀）
    fullLine: str = ""          # 高德原始线路名
    fromStop: str = ""
    toStop: str = ""
    stops: int = 0              # 途经站数
    distanceKm: float = 0.0
    durationMin: float = 0.0


class TransitOption(BaseModel):
    """一个完整的公交/地铁出行方案（高德 transits[] 里的一条）"""

    durationMin: float
    cost: float
    walkKm: float
    distanceKm: float
    transfers: int = 0
    # 是否直达（只坐一条线，不换乘）
    direct: bool = False
    # 可读线路链："步行 602m → 地铁8号线 → 地铁9号线 → 步行 357m"
    label: str = ""
    rides: list[TransitRide] = Field(default_factory=list)


class TransportLeg(BaseModel):
    """一段交通。前四个字段是前端契约的必需字段，后面几个是求解/展示用的扩展信息。"""

    mode: TravelMode | str
    durationMin: float
    cost: float
    distanceKm: float
    walkKm: float = 0.0
    transfers: int = 0
    # 折线是否为直线近似（离线估算时为 True，前端会标注「估算」）
    approx: bool = False
    # amap = 高德路线，offline = 离线估算；路线来自接口不代表费用是实时报价。
    dataSource: str = "offline"
    costSource: str = "local_estimate"
    costApprox: bool = True
    queriedAt: str | None = None
    cacheHit: bool = False
    drivingMin: float | None = None
    accessWalkMin: float | None = None
    # 公交/地铁的全部候选方案（最优在前）与当前采用的方案摘要。
    # 用户点「最优线路」时可以对比：直达 / 换乘几次 / 公交+地铁组合
    transitOptions: list[TransitOption] | None = None
    transitLabel: str | None = None
    # —— 单段交通自动寻优 ——
    # 系统把这一段换成了别的交通方式（例如「打车 1.8km 却要 22 分钟 → 改成步行 18 分钟」）
    isAutoOptimized: bool = False
    # 为什么换：直接展示给用户看的一句话
    optimizationReason: str | None = None
    # 只是建议、没有强制改（例如步行 35 分钟，打车只要 12 分钟）—— 前端做成提示而不是替换
    optimizationHint: str | None = None
    # 这一段的实际交通方式（分段混合交通决策的结果）。
    # 与全局偏好可能不同：全局选「地铁」时，800 米的那段会是 walk。
    # 保留 mode 字段是为了兼容老前端，新前端请优先读 transportMode。
    transportMode: str | None = None


class PlanStop(BaseModel):
    id: str
    name: str
    lng: float
    lat: float
    arriveTime: str  # HH:mm
    leaveTime: str  # HH:mm
    stayMin: int
    transportFromPrev: TransportLeg | None = None
    # 这一站里包含的午餐时间（分钟），0 表示不含
    lunchMin: int = 0


class PlanDayStats(BaseModel):
    totalWalkKm: float = 0.0
    totalTransitMin: float = 0.0
    totalCost: float = 0.0


class PlanDay(BaseModel):
    date: str
    stops: list[PlanStop] = Field(default_factory=list)
    stats: PlanDayStats = Field(default_factory=PlanDayStats)
    # 回到酒店的时刻（HH:mm）与超时分钟数（迟到惩罚对应的可解释结果）
    returnTime: str | None = None
    overtimeMin: float = 0.0
    # 「最后一站 → 酒店」这一段。必须显式返回：
    # 否则前端画得出回程折线却拿不到它的时长/里程，
    # 时间轴上的「预计 X 点回到酒店」就会显得像凭空出现的数字。
    returnLeg: TransportLeg | None = None
    # 多日模式：可读标题（「第 2 天 · 江景」）与本日折线
    title: str | None = None
    polylines: list[list[tuple[float, float]]] | None = None


class PlanOptions(BaseModel):
    """规划高级约束（模块 3/4 使用）"""

    dayStartTime: str = "09:00"
    dayEndTime: str = "21:00"
    lunchBreakMin: int = 60
    lunchWindow: tuple[str, str] = ("11:30", "13:30")
    budgetYuan: float | None = None
    mustVisitIds: list[str] = Field(default_factory=list)


class TripLimits(BaseModel):
    """硬性上限：预算（元）与路上时间（分钟）。planner 会校验并在 solver.limits 里回报。"""

    budgetCap: float | None = None
    transitCapMin: float | None = None


class PlanRequest(BaseModel):
    hotel: Hotel
    destinations: list[Destination]
    days: int = 1
    mode: TravelMode = "transit"
    # 逐段覆盖：目的地 id → 该段交通方式；"__return__" 表示回酒店那一段
    legModes: dict[str, str] | None = None
    limits: TripLimits | None = None
    weights: Weights = Field(default_factory=Weights)
    naturalLanguage: str | None = None
    options: PlanOptions = Field(default_factory=PlanOptions)


class PlanResponse(BaseModel):
    days: list[PlanDay]
    explanation: str = ""
    polylines: list[list[tuple[float, float]]] | None = None
    # 求解元信息，便于前端展示与答辩讲解
    solver: dict | None = None


class PoiPreset(BaseModel):
    """上海预置 POI 演示数据。

    坐标/地址/营业时间/评分来自高德快照（backend/scripts/refresh_poi_snapshot.py 生成），
    tags 是人工维护的**规划语义标签**（夜景/拍照/citywalk…），高德给不了。
    """

    name: str
    lng: float
    lat: float
    openTime: str = ""
    closeTime: str = ""
    stayMin: int = 60
    tags: list[str] = Field(default_factory=list)
    district: str | None = None
    address: str | None = None
    amapId: str | None = None
    rating: str | None = None
    category: str | None = None
    # 高德营业时间原始文案（界面展示用；含"周一闭馆"这类说明）
    hoursRaw: str | None = None
    # 每周固定全天关闭的日子，1=周一…7=周日。**只用于界面提示，不进求解器**
    closedWeekdays: list[int] = Field(default_factory=list)
    # 快照抓取日期：数据会过期，界面上要能说清"这是哪天的数据"
    fetchedAt: str | None = None


class IsochroneRequest(BaseModel):
    """等时圈请求：以酒店为中心，看 15/30/45 分钟能覆盖到哪些地方。"""

    hotel: Hotel
    minutes: list[int] = Field(default_factory=lambda: [15, 30, 45])
    mode: TravelMode = "walk"


class IsochronePoi(BaseModel):
    name: str
    lng: float
    lat: float
    minutes: float   # 从酒店过去要多久
    km: float
    tags: list[str] = Field(default_factory=list)


class IsochroneBand(BaseModel):
    minutes: int
    # 等时圈多边形（经纬度闭环）
    polygon: list[tuple[float, float]] = Field(default_factory=list)
    # 这条带内可达的热门 POI 数量与明细
    poiCount: int = 0
    pois: list[IsochronePoi] = Field(default_factory=list)
    # amap-isochrone = 高德真实路网等时圈；offline-circle = 等速圆近似
    source: str = "offline-circle"


class IsochroneResponse(BaseModel):
    mode: str
    modeLabel: str
    dataSource: str
    bands: list[IsochroneBand] = Field(default_factory=list)
    poiTotal: int = 0
    warnings: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# 模块 4：AI 能力
# --------------------------------------------------------------------------- #
class AiParseRequest(BaseModel):
    """自然语言解析请求。"""

    text: str
    hotel: Hotel | None = None  # 可选：带上酒店便于将来做"酒店附近"这类解析


class ResolvedPlace(BaseModel):
    """解析并补齐坐标后的地点。"""

    name: str
    lng: float
    lat: float
    stayMin: int = 60
    tags: list[str] = Field(default_factory=list)
    openTime: str = ""
    closeTime: str = ""
    # preset = 预置 POI 命中；geocode = 高德地理编码；name-only = 只有名字没坐标
    matchedBy: str = "preset"
    address: str | None = None
    reason: str | None = None


class AiParseResponse(BaseModel):
    # llm = 大模型 Function Calling；rules = 内置规则解析（无 Key / 调用失败时降级）
    source: str
    places: list[ResolvedPlace] = Field(default_factory=list)
    exclude: list[str] = Field(default_factory=list)
    # 没能解析出坐标的地名，原样返回给用户，绝不猜
    unresolved: list[str] = Field(default_factory=list)
    summary: str = ""
    notes: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    debug: dict | None = None


class AiReplanRequest(PlanRequest):
    """一句话重规划：在完整规划请求的基础上加一句自然语言。"""

    text: str


class AiReplanResponse(BaseModel):
    source: str
    # 给用户看的自然语言回复（人话解释：改了什么、为什么这么选）
    reply: str = ''
    # 模型（或规则）解析出的调整参数，原样回显，方便用户核对
    constraints: dict = Field(default_factory=dict)
    # 人话描述的变更清单
    applied: list[str] = Field(default_factory=list)
    removed: list[str] = Field(default_factory=list)
    plan: PlanResponse
    warnings: list[str] = Field(default_factory=list)
    debug: dict | None = None


class AiExplainRequest(BaseModel):
    plan: PlanResponse
    question: str | None = None


class AiExplainResponse(BaseModel):
    source: str
    text: str
    debug: dict | None = None



class AiTurnRequest(PlanRequest):
    """对话一轮：先出提案，不动路书。cityPois 让后端知道这座城有哪些点。"""

    text: str
    cityPois: list[dict] = Field(default_factory=list)
    cityName: str = "上海"
    history: list[dict] = Field(default_factory=list)


class AiTurnResponse(BaseModel):
    kind: str = "act"  # act=要执行的动作 / clarify=需要追问 / answer=只能回答
    source: str = "rules"  # llm / rules
    reply: str = ""
    preview: list[str] = Field(default_factory=list)
    question: str | None = None
    options: list[str] = Field(default_factory=list)
    ops: dict = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class AiApplyRequest(PlanRequest):
    """用户确认后执行提案。"""

    ops: dict = Field(default_factory=dict)


class AiApplyResponse(BaseModel):
    plan: PlanResponse
    changes: list[str] = Field(default_factory=list)
    caption: str = ""


