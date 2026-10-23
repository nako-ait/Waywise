"""生成《路书编译师》答辩 PPT。

用法（在仓库根目录下，用工作区自带的 Python）：
    <python> docs/build_ppt.py

产物：docs/路书编译师_答辩.pptx（16:9，13 页，全部为可编辑文本）
内容与 docs/答辩提纲.md 对齐：问题 → 架构 → 算法 → 约束 → 多日 → AI → 工程化 → 验证 → 踩坑 → 局限。
"""
from __future__ import annotations

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt
from pptx.oxml import parse_xml

OUT = Path(__file__).resolve().parent / "路书编译师_答辩.pptx"

# 与前端同一套语义色
INK = RGBColor(0x0F, 0x17, 0x2A)
MUTED = RGBColor(0x64, 0x74, 0x8B)
HOTEL = RGBColor(0x25, 0x63, 0xEB)
PICKED = RGBColor(0xF9, 0x73, 0x16)
GREEN = RGBColor(0x16, 0xA3, 0x4A)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
LIGHT = RGBColor(0xF1, 0xF5, 0xF9)
FONT = "Microsoft YaHei"


def _set_font(run, size: int, bold: bool = False, color: RGBColor = INK, font: str = FONT) -> None:
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = font
    rpr = run._r.get_or_add_rPr()
    for tag in ("a:ea", "a:cs"):
        el = rpr.find(qn(tag))
        if el is None:
            el = parse_xml(f'<{tag} xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>')
            rpr.append(el)
        el.set("typeface", font)


def add_text(slide, left, top, width, height, lines, *, size=16, bold=False, color=INK,
             align=PP_ALIGN.LEFT, spacing=1.15):
    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    frame = box.text_frame
    frame.word_wrap = True
    for index, line in enumerate(lines):
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        paragraph.alignment = align
        paragraph.line_spacing = spacing
        if isinstance(line, tuple):
            text, line_size, line_bold, line_color = line
        else:
            text, line_size, line_bold, line_color = line, size, bold, color
        run = paragraph.add_run()
        run.text = text
        _set_font(run, line_size, line_bold, line_color)
    return box


def add_slide(prs, title, kicker=None):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bar = slide.shapes.add_shape(1, Inches(0), Inches(0), prs.slide_width, Inches(0.12))
    bar.fill.solid()
    bar.fill.fore_color.rgb = PICKED
    bar.line.fill.background()
    bar.shadow.inherit = False

    if kicker:
        add_text(slide, 0.7, 0.35, 12, 0.35, [kicker], size=12, bold=True, color=PICKED)
    add_text(slide, 0.7, 0.65, 12, 0.8, [title], size=28, bold=True, color=INK)
    line = slide.shapes.add_shape(1, Inches(0.7), Inches(1.45), Inches(12), Emu(9525))
    line.fill.solid()
    line.fill.fore_color.rgb = RGBColor(0xE2, 0xE8, 0xF0)
    line.line.fill.background()
    line.shadow.inherit = False
    return slide


def add_table(slide, left, top, width, height, rows, *, col_widths=None, font_size=12):
    shape = slide.shapes.add_table(len(rows), len(rows[0]), Inches(left), Inches(top),
                                   Inches(width), Inches(height))
    table = shape.table
    if col_widths:
        for index, ratio in enumerate(col_widths):
            table.columns[index].width = Inches(width * ratio)
    for r, row in enumerate(rows):
        for c, value in enumerate(row):
            cell = table.cell(r, c)
            cell.text = ""
            frame = cell.text_frame
            frame.word_wrap = True
            run = frame.paragraphs[0].add_run()
            run.text = str(value)
            _set_font(run, font_size, bold=(r == 0), color=WHITE if r == 0 else INK)
            cell.fill.solid()
            cell.fill.fore_color.rgb = INK if r == 0 else (LIGHT if r % 2 else WHITE)
            cell.margin_left = Inches(0.08)
            cell.margin_top = Inches(0.04)
            cell.margin_bottom = Inches(0.04)
    return table


def build() -> Path:
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    # ---------------- P1 封面 ----------------
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    band = slide.shapes.add_shape(1, Inches(0), Inches(0), prs.slide_width, Inches(2.6))
    band.fill.solid()
    band.fill.fore_color.rgb = INK
    band.line.fill.background()
    band.shadow.inherit = False
    add_text(slide, 0.9, 0.7, 11.5, 0.6, ["路书编译师  TripCompiler"], size=40, bold=True, color=WHITE)
    add_text(slide, 0.9, 1.55, 11.5, 0.5,
             ["以酒店为固定起点的 AI 多日路书编译器 ｜ 目标城市：上海（GCJ-02）"],
             size=16, color=RGBColor(0xCB, 0xD5, 0xE1))
    add_text(slide, 0.9, 3.2, 11.5, 2.4, [
        ("把「排序」交给运筹优化，把「表达」交给大模型。", 20, True, INK),
        ("", 10, False, INK),
        ("· 酒店固定起点：地图标定目的地 → OR-Tools 求解 → 时间轴路书", 15, False, MUTED),
        ("· 多目标 + 硬约束：营业时间窗、午餐、必去/可选、迟到与漏点惩罚", 15, False, MUTED),
        ("· 一句话重规划：自然语言 → 结构化约束 → 立刻重算", 15, False, MUTED),
        ("· 全链路可离线：没有高德 Key、没有 LLM Key 也能完整演示", 15, False, MUTED),
    ])
    add_text(slide, 0.9, 6.4, 11.5, 0.4,
             ["React + Vite + 高德 JS API + Zustand   ｜   FastAPI + OR-Tools + 高德 Web 服务 + SQLite"],
             size=12, color=MUTED)

    # ---------------- P2 问题 ----------------
    slide = add_slide(prs, "规划一次旅行，难在哪？", "01 问题")
    add_text(slide, 0.7, 1.8, 6.0, 4.6, [
        ("搜得到景点，串不成路线", 18, True, INK),
        ("顺序才是最耗心力的部分：8 个点有 40320 种排法。", 14, False, MUTED),
        ("", 8, False, MUTED),
        ("顺序同时被多重约束绑住", 18, True, INK),
        ("营业时间、换乘次数、花费、体力、午餐、回酒店时间。", 14, False, MUTED),
        ("", 8, False, MUTED),
        ("通用大模型能「说」路线，但不会真的求解", 18, True, INK),
        ("它给的顺序看着合理，却可能让闭馆的景点排在最后，也保不住数字。", 14, False, MUTED),
    ])
    card = slide.shapes.add_shape(1, Inches(7.1), Inches(1.9), Inches(5.5), Inches(3.6))
    card.fill.solid()
    card.fill.fore_color.rgb = LIGHT
    card.line.fill.background()
    card.shadow.inherit = False
    add_text(slide, 7.4, 2.2, 4.9, 3.0, [
        ("我们的答案", 16, True, PICKED),
        ("", 6, False, INK),
        ("① 排序 = 运筹优化问题", 15, True, INK),
        ("   带时间窗与多目标的 TSP / 分天 TSP", 13, False, MUTED),
        ("② 表达 = 大模型的活", 15, True, INK),
        ("   自然语言 ↔ 结构化参数，互不越权", 13, False, MUTED),
        ("③ 坐标只来自高德", 15, True, INK),
        ("   全链路 GCJ-02，模型不许输出坐标", 13, False, MUTED),
    ])

    # ---------------- P3 产品形态 ----------------
    slide = add_slide(prs, "产品形态：一屏之内完成一次编译", "02 产品")
    rows = [
        ["区域", "内容", "解决什么"],
        ["左侧操作区", "AI 助手 / 出发酒店 / 主题线路 / 搜索加点 / 目的地列表 / 行程参数 / 酒店便利度",
         "从「想玩什么」到「怎么排」的全过程，不用跳页"],
        ["地图", "蓝色酒店标记 · 灰色候选点 · 橙色序号 · 彩色路线折线与方向箭头 · 等时圈",
         "空间关系一眼可见，选点即所见"],
        ["底部时间轴", "每站到达–离开、停留、含午餐、分段交通与费用、返回酒店时刻",
         "把「路线」翻译成「一天的日程」"],
        ["底部工具栏", "五种交通方式切换（切换即重算）+ 全程统计 + 一键编译 + 缓存预热",
         "参数改动立刻看到代价变化"],
    ]
    add_table(slide, 0.7, 1.8, 12, 4.6, rows, col_widths=[0.16, 0.56, 0.28], font_size=12)

    # ---------------- P4 架构 ----------------
    slide = add_slide(prs, "系统架构：求解归求解，表达归表达", "03 架构")
    add_text(slide, 0.7, 1.7, 12, 5.0, [
        ("前端  React + Vite + TS + 高德 JS API + Zustand + localStorage", 16, True, HOTEL),
        ("        地图标记与路线 · 时间轴 · 权重滑杆 · AI 面板 · 路书与视野持久化", 13, False, MUTED),
        ("", 8, False, MUTED),
        ("                          ↓  HTTP（/api/*）", 15, True, MUTED),
        ("", 8, False, MUTED),
        ("后端  FastAPI", 16, True, HOTEL),
        ("  ├─ planner.py      编排：距离矩阵 → 分天 → 求解 → 逐段精修 → 时间轴 → 统计", 13, False, INK),
        ("  ├─ solver.py       OR-Tools 路由求解（时间窗 + 加权目标 + 迟到/漏点惩罚）", 13, False, INK),
        ("  ├─ vrp.py/cluster.py  多日：KMeans 地理聚类 + 时间均衡 + 每天 TSP", 13, False, INK),
        ("  ├─ amap_client.py  高德 Web 服务：距离矩阵 / 路径规划 / 地理编码 + 离线降级", 13, False, INK),
        ("  ├─ llm.py + ai_schemas.py  Function Calling（DeepSeek / 通义 / 智谱）", 13, False, INK),
        ("  ├─ nlp_rules.py    无 Key 降级：规则解析（地点别名 + 偏好关键词）", 13, False, INK),
        ("  └─ cache.py        SQLite 缓存：距离矩阵与分段路径（TTL 7 天 + 预热接口）", 13, False, INK),
    ])

    # ---------------- P5 目标函数 ----------------
    slide = add_slide(prs, "核心算法：目标函数（全部折算成「分钟当量」）", "04 算法")
    code = slide.shapes.add_shape(1, Inches(0.7), Inches(1.8), Inches(12), Inches(2.5))
    code.fill.solid()
    code.fill.fore_color.rgb = INK
    code.line.fill.background()
    code.shadow.inherit = False
    add_text(slide, 1.0, 2.0, 11.4, 2.1, [
        ("弧成本(i→j) = w1 × 交通时间(分钟)", 15, True, WHITE),
        ("            + w2 × [换乘次数 × 单次惩罚 + 方式不适感]", 15, True, WHITE),
        ("            + w3 × 费用(元) × 3          ← 1 元 ≈ 3 分钟心理成本", 15, True, WHITE),
        ("            + w4 × 步行(km) × 13.3       ← 4.5 km/h", 15, True, WHITE),
        ("总成本 = Σ 弧成本 + 漏点惩罚(600 分钟/点) + 迟到惩罚(20 当量/分钟)", 15, True, RGBColor(0xFD, 0xBA, 0x74)),
    ])
    add_text(slide, 0.7, 4.6, 12, 2.2, [
        ("为什么要统一量纲？", 16, True, INK),
        ("权重滑杆如果作用在「时间 / 换乘 / 花费 / 步行」四种不同量纲上，用户根本不知道 0.6 意味着什么。", 14, False, MUTED),
        ("折算成分钟当量之后，每个权重都有可解释的物理含义，答辩时也能直接算给评委看。", 14, False, MUTED),
        ("", 6, False, MUTED),
        ("实测：把「步行」权重从 0.5 拉到 1.0，路线从 外滩→五角场→陆家嘴→七宝 变为 外滩→陆家嘴→五角场→七宝，目标值 488 → 485。", 13, False, PICKED),
    ])

    # ---------------- P6 约束落地 ----------------
    slide = add_slide(prs, "硬约束怎么落地（这一页是技术分）", "05 约束")
    rows = [
        ["约束", "实现方式", "效果"],
        ["营业时间", "CumulVar(i) ∈ [max(开门, 出发时间), 关门 − 停留]", "15:31 离开 16:45 关门的豫园"],
        ["出发 / 收工", "时间维度容量 + 终点 SetCumulVarSoftUpperBound", "迟到按分钟罚分而非直接无解"],
        ["必去 / 可选", "AddDisjunction(penalty)：必去 1e7，可选 600 当量", "时间不够时丢点，并如实报告"],
        ["午餐休息", "两遍求解：先探落点，再把时长并进那一站的服务时间", "求解口径与时间轴完全一致"],
        ["酒店闭环", "RoutingIndexManager(size, 1, [0], [0])", "每天从酒店出发并回到酒店"],
        ["多日不串天", "solve() 做矩阵/节点契约检查，自动取子矩阵 + 下标重映射", "第 1 天不会绕去第 2 天的点"],
    ]
    add_table(slide, 0.7, 1.8, 12, 4.6, rows, col_widths=[0.17, 0.53, 0.30], font_size=12)

    # ---------------- P7 多日 ----------------
    slide = add_slide(prs, "多日：为什么不是「一次性 VRP」", "06 多日")
    add_text(slide, 0.7, 1.8, 7.2, 5.0, [
        ("酒店是每天共同的起点与终点 → 问题天然可分解", 16, True, INK),
        ("① 地理聚类：KMeans（等距圆柱投影 + k-means++，纯 Python，无 numpy）", 14, False, INK),
        ("② 时间均衡：最近邻估算每日时长，把最重那天的边缘点挪给最轻那天", 14, False, INK),
        ("③ 每天各自 TSP：复用单日模型，营业时间窗与午餐互不干扰", 14, False, INK),
        ("", 8, False, INK),
        ("三个好处", 16, True, PICKED),
        ("· 规模小：6~12 个点秒级收敛，现场不卡", 14, False, MUTED),
        ("· 可解释：能对用户说「第 1 天在黄浦-静安，第 2 天在浦东」", 14, False, MUTED),
        ("· 约束清晰：每套营业时间窗只在自己那天生效", 14, False, MUTED),
    ])
    card = slide.shapes.add_shape(1, Inches(8.2), Inches(1.9), Inches(4.4), Inches(3.4))
    card.fill.solid()
    card.fill.fore_color.rgb = LIGHT
    card.line.fill.background()
    card.shadow.inherit = False
    add_text(slide, 8.5, 2.15, 3.8, 3.0, [
        ("实测：12 个点分 3 天", 15, True, INK),
        ("", 6, False, INK),
        ("第 1 天 · 地标    4 点 / 380 分钟", 13, False, INK),
        ("第 2 天 · 街区    5 点 / 425 分钟", 13, False, INK),
        ("第 3 天 · 江景    3 点 / 408 分钟", 13, False, INK),
        ("", 8, False, INK),
        ("均衡前最大差 > 400 分钟", 12, False, MUTED),
        ("均衡后最大差 ≈ 45 分钟", 12, False, GREEN),
    ])

    # ---------------- P8 AI ----------------
    slide = add_slide(prs, "AI：两条路径，同一份契约", "07 AI")
    add_text(slide, 0.7, 1.8, 6.0, 4.8, [
        ("有 Key → Function Calling", 16, True, INK),
        ("三个工具：add_destinations / replan_constraints / （解释用纯文本生成）", 13, False, MUTED),
        ("Prompt 里明确「绝对不要输出经纬度」。", 13, False, MUTED),
        ("", 8, False, MUTED),
        ("无 Key → 规则解析", 16, True, INK),
        ("37 个 POI 的名称 + 别名最长匹配（「豫园」→「豫园·城隍庙」）", 13, False, MUTED),
        ("偏好关键词映射（少走路 / 省钱 / 6 点前 / 多拍照 / 两天）", 13, False, MUTED),
        ("", 8, False, MUTED),
        ("两条路径产出同构参数", 16, True, PICKED),
        ("下游只有一份代码、端到端测试也只有一套。", 13, False, MUTED),
    ])
    card = slide.shapes.add_shape(1, Inches(7.0), Inches(1.9), Inches(5.6), Inches(4.2))
    card.fill.solid()
    card.fill.fore_color.rgb = LIGHT
    card.line.fill.background()
    card.shadow.inherit = False
    add_text(slide, 7.3, 2.15, 5.0, 3.8, [
        ("实测对话（无 Key，source=rules）", 14, True, INK),
        ("", 6, False, INK),
        ("「我想去外滩、豫园、武康路」", 13, False, MUTED),
        ("→ 命中 3 个点，全部 preset 匹配", 13, True, GREEN),
        ("", 6, False, INK),
        ("「少走路，多拍照，6 点前回酒店」", 13, False, MUTED),
        ("→ walking=0.95、收工 18:00，重算后 15:14 回酒店", 13, True, GREEN),
        ("   （注意：没有因为「多拍照」塞 3 个新景点）", 12, False, PICKED),
        ("", 6, False, INK),
        ("「今天天气不错」", 13, False, MUTED),
        ("→ 明确报「没有匹配到可规划的地点」", 13, True, GREEN),
    ])

    # ---------------- P9 工程化 ----------------
    slide = add_slide(prs, "工程化：让演示不崩", "08 稳健性")
    rows = [
        ["风险", "我们的处理", "用户看到什么"],
        ["高德 Web Key 未配置", "距离矩阵退化为离线估算（直线 × 绕行系数）", "时间轴标注「离线估算」徽标"],
        ["LLM Key 未配置 / 超时", "自动降级规则解析", "AI 面板标注「⚙️ 规则解析」"],
        ["OR-Tools 装不上", "降级纯 Python 贪心 + 2-opt，并把原因写进响应", "求解器名显示 python-greedy-2opt"],
        ["高德接口限流", "N×N 矩阵用批量接口 + SQLite 缓存 + 预热接口", "演示前跑一次预热即全部命中缓存"],
        ["地图 JS API 加载失败", "渲染 Key 配置引导卡片而不是白屏", "页面上直接给出配置三步走"],
        ["后端没启动", "页头常驻状态胶囊 + 底栏给出启动命令", "红色「● 后端未启动」"],
    ]
    add_table(slide, 0.7, 1.8, 12, 4.6, rows, col_widths=[0.22, 0.46, 0.32], font_size=12)

    # ---------------- P10 验证 ----------------
    slide = add_slide(prs, "验证：一条命令跑完全链路自检", "09 证据")
    code = slide.shapes.add_shape(1, Inches(0.7), Inches(1.8), Inches(12), Inches(2.2))
    code.fill.solid()
    code.fill.fore_color.rgb = INK
    code.line.fill.background()
    code.shadow.inherit = False
    add_text(slide, 1.0, 1.98, 11.4, 1.9, [
        ("$ python scripts/verify_all.py", 14, True, WHITE),
        ("  ✅ 模块 1  POI 数据与接口冒烟        (1.3s)", 14, True, RGBColor(0x86, 0xEF, 0xAC)),
        ("  ✅ 模块 2  单日路线规划（5 种方式）   (24.5s)", 14, True, RGBColor(0x86, 0xEF, 0xAC)),
        ("  ✅ 模块 3  多日分天 + 等时圈         (32.2s)", 14, True, RGBColor(0x86, 0xEF, 0xAC)),
        ("  ✅ 模块 4  AI 解析 / 重规划 / 解释    (14.4s)", 14, True, RGBColor(0x86, 0xEF, 0xAC)),
        ("  合计 4 个套件，通过 4 个，总耗时 72.3s", 14, True, RGBColor(0xFD, 0xBA, 0x74)),
    ])
    add_text(slide, 0.7, 4.3, 12, 2.6, [
        ("除自检脚本外的独立证据", 16, True, INK),
        ("· 前端 tsc --noEmit → 0 error；vite build → 67 modules，gzip 后 69 kB", 14, False, INK),
        ("· 真实 uvicorn 启动后 HTTP 验证：3 天路书的 polylines 段数 = 站点数 + 1", 14, False, INK),
        ("· 等时圈 15/30/45 分钟分别可达 3 / 9 / 14 个热门 POI（另：打车 15 分钟 23 个）", 14, False, INK),
        ("· 冒烟测试里断言「所有 POI 落在上海经纬度包围盒内」——守住坐标系底线", 14, False, INK),
    ])

    # ---------------- P11 踩坑 ----------------
    slide = add_slide(prs, "踩过的坑（体现工程深度）", "10 复盘")
    add_text(slide, 0.7, 1.8, 12, 5.0, [
        ("① OR-Tools 的软约束 API 在不同版本里不一样", 17, True, PICKED),
        ("   用了 IntVar.SetSoftUpperBound，在 9.15 上直接抛 AttributeError —— 求解器静默降级成贪心，", 13, False, MUTED),
        ("   路线质量悄悄变差而没人知道。正确写法是 RoutingDimension.SetCumulVarSoftUpperBound。", 13, False, MUTED),
        ("   教训：降级必须报出来。现在求解器名字会显示在时间轴上。", 13, True, INK),
        ("", 8, False, MUTED),
        ("② 午餐只在时间轴上加 60 分钟 → 求解器算时间窗时是「乐观」的", 17, True, PICKED),
        ("   结果出现「16:45 关门的豫园被排到 17:06 离开」。改成两遍求解，并保留独立的", 13, False, MUTED),
        ("   schedule() 做交叉校验，一旦不自洽立刻报警。", 13, False, MUTED),
        ("", 8, False, MUTED),
        ("③ OR-Tools 默认要求访问模型里的每一个节点", 17, True, PICKED),
        ("   多日模式下第 1 天会绕去第 2 天的目的地（时间轴直接 KeyError）。给它加 0 惩罚的", 13, False, MUTED),
        ("   disjunction 也拦不住；正确做法是在 solve() 里做契约检查，自动取子矩阵 + 下标重映射。", 13, False, MUTED),
    ])

    # ---------------- P12 局限 ----------------
    slide = add_slide(prs, "局限与下一步", "11 边界")
    add_text(slide, 0.7, 1.8, 6.0, 4.8, [
        ("已知局限（诚实说明）", 17, True, INK),
        ("· 公交/地铁耗时是「驾车时长 × 系数 + 换乘惩罚」的近似，", 14, False, MUTED),
        ("   最终路线的每一段会用真实路径规划接口精修，但矩阵阶段是估算", 14, False, MUTED),
        ("· 预算上限、多人偏好合并、天气重排尚未做", 14, False, MUTED),
        ("· 演示 POI 库固定 37 条（保证零网络），生产应接高德 POI 搜索", 14, False, MUTED),
    ])
    add_text(slide, 7.0, 1.8, 5.6, 4.8, [
        ("下一步", 17, True, PICKED),
        ("· P2 攻略导入：小红书链接 → 地点抽取", 14, False, INK),
        ("· P2 截图 OCR：识别店名并标点", 14, False, INK),
        ("· 天气动态重排：雨天把户外点换到晴天", 14, False, INK),
        ("· 多城市参数化（城市数据 + citycode 目前写死上海）", 14, False, INK),
    ])

    # ---------------- P13 备用页 ----------------
    slide = add_slide(prs, "备用页：接口清单与一键启动", "12 附录")
    add_text(slide, 0.7, 1.8, 6.0, 4.8, [
        ("接口", 17, True, INK),
        ("GET  /api/health              服务与配置自检", 13, False, INK),
        ("GET  /api/poi/presets         37 个上海 POI", 13, False, INK),
        ("POST /api/plan                单日/多日路线编译", 13, False, INK),
        ("POST /api/plan/prewarm        演示前预热缓存", 13, False, INK),
        ("POST /api/isochrone           等时圈与便利度", 13, False, INK),
        ("GET  /api/ai/health           LLM 探活", 13, False, INK),
        ("POST /api/ai/parse            自然语言 → 目的地", 13, False, INK),
        ("POST /api/ai/replan           一句话重规划", 13, False, INK),
        ("POST /api/ai/explain          路线解释", 13, False, INK),
    ])
    add_text(slide, 7.0, 1.8, 5.6, 4.8, [
        ("一键启动", 17, True, PICKED),
        ("# 后端", 13, True, INK),
        ("cd backend", 13, False, MUTED),
        (".venv\\Scripts\\python.exe run.py", 13, False, MUTED),
        ("", 6, False, MUTED),
        ("# 前端", 13, True, INK),
        ("cd frontend", 13, False, MUTED),
        ("pnpm dev", 13, False, MUTED),
        ("", 6, False, MUTED),
        ("# 自检（4 个套件）", 13, True, INK),
        (".venv\\Scripts\\python.exe scripts\\verify_all.py", 13, False, MUTED),
        ("", 6, False, MUTED),
        ("Key 配置：frontend/.env.local（JS API）", 12, False, MUTED),
        ("backend/.env（Web 服务 + LLM）", 12, False, MUTED),
    ])

    prs.save(str(OUT))
    return OUT


if __name__ == "__main__":
    path = build()
    print(f"[ok] 已生成 {path}")
