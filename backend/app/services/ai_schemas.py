"""模块 4 的 AI 契约层：Function Calling 的 JSON Schema 与 Prompt 模板。

单独成文件是为了让「AI 到底怎么被约束的」一眼可见 —— 答辩时直接展示这个文件即可。
三个能力各自对应一个工具/模板：
  1. parse    自然语言 -> 目的地列表（工具：add_destinations）
  2. replan   一句话修改意见 -> 结构化调整参数（工具：replan_constraints）
  3. explain  路书 JSON -> 自然语言讲解（纯文本生成，不需要工具）

坐标系注意：这里**永远不要求模型输出经纬度** —— 地名 -> 坐标一律由后端做地理编码，
既避免模型幻觉出坐标，也保证全链路只有一个坐标来源（高德 GCJ-02）。
"""
from __future__ import annotations

# --------------------------------------------------------------------------- #
# 一、工具 Schema（OpenAI / DeepSeek / 通义 / 智谱 的 function calling 通用格式）
# --------------------------------------------------------------------------- #
ADD_DESTINATIONS_TOOL: dict = {
    "name": "add_destinations",
    "description": (
        "把用户自然语言里提到的上海地点解析成结构化目的地列表。"
        "只输出用户真实提到或强烈暗示的地点，不要编造；不要输出经纬度，坐标由后端地理编码补齐。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "places": {
                "type": "array",
                "description": "用户想去的地点，按提到的顺序排列",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "上海本地的常用全称，例如「豫园·城隍庙」「武康路·武康大楼」",
                        },
                        "stayMin": {
                            "type": "integer",
                            "description": "建议停留分钟数；用户没提就不要填",
                        },
                        "tags": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "地点特征标签，如 夜景/拍照/小吃/博物馆",
                        },
                        "reason": {
                            "type": "string",
                            "description": "为什么把它放进路线（一句话）",
                        },
                    },
                    "required": ["name"],
                    "additionalProperties": False,
                },
            },
            "exclude": {
                "type": "array",
                "items": {"type": "string"},
                "description": "用户明确表示不要去的地点",
            },
            "summary": {
                "type": "string",
                "description": "一句话复述用户的意图；没有提到任何地点时说明这一点",
            },
        },
        "required": ["places"],
        "additionalProperties": False,
    },
}


REPLAN_TOOL: dict = {
    "name": "replan_constraints",
    "description": (
        "把用户对**已排好路书**的一句修改意见，翻译成结构化的调整参数。"
        "只填需要改变的字段，没提到的不要填。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "weights": {
                "type": "object",
                "description": "偏好权重，取值 0~1，越大越在意；只填需要变化的项",
                "properties": {
                    "time": {"type": "number", "description": "在意总耗时（少在路上）"},
                    "convenience": {"type": "number", "description": "在意味换乘少、直达"},
                    "cost": {"type": "number", "description": "在意花费（省钱）"},
                    "walking": {"type": "number", "description": "在意步行距离（少走路）"},
                },
                "additionalProperties": False,
            },
            "dayStartTime": {"type": "string", "description": "出发时间 HH:mm"},
            "dayEndTime": {"type": "string", "description": "收工时间 HH:mm，例如「6 点前回酒店」→ 18:00"},
            "lunchBreakMin": {"type": "integer", "description": "午餐分钟数"},
            "days": {"type": "integer", "description": "行程天数 1~7"},
            "mode": {
                "type": "string",
                "enum": ["walk", "transit", "subway", "taxi", "drive"],
                "description": "主要交通方式",
            },
            "mustVisitNames": {
                "type": "array",
                "items": {"type": "string"},
                "description": "必须安排进去的地点",
            },
            "removeNames": {
                "type": "array",
                "items": {"type": "string"},
                "description": "要从行程里去掉的地点",
            },
            "intentSummary": {"type": "string", "description": "一句话复述用户的修改意图"},
        },
        "required": [],
        "additionalProperties": False,
    },
}

TOOL_REGISTRY: dict[str, dict] = {
    ADD_DESTINATIONS_TOOL["name"]: ADD_DESTINATIONS_TOOL,
    REPLAN_TOOL["name"]: REPLAN_TOOL,
}


# --------------------------------------------------------------------------- #
# 二、Prompt 模板
# --------------------------------------------------------------------------- #
PLACE_PARSE_SYSTEM_PROMPT = """你是「路书编译师」的地点解析助手，只服务上海地区的旅行规划。

你的任务：把用户的一句话解析成结构化目的地列表，并**调用 add_destinations 工具返回**。

必须遵守的规则：
1. 只输出用户真实提到或强烈暗示的地点。宁可少，也不要为了凑数编造地点。
2. 绝对不要输出经纬度 —— 坐标由后端地理编码补齐，你编的坐标会造成几百米甚至几公里的偏移。
3. 地名用上海本地常用全称：「豫园」→「豫园·城隍庙」，「武康路」→「武康路·武康大楼」，
   「东方明珠」→「东方明珠广播电视塔」，「陆家嘴」→「陆家嘴滨江大道」。
4. 用户提到时长（「待一小时」「随便看看」）就填 stayMin：一小时=60，随便看看=30，深度逛=120。
5. 用户明确说「不要/去掉/除了 X」的地点，放进 exclude，不要放进 places。
6. 用户只是在聊天、没提任何地点时：places 返回空数组，并在 summary 里说明原因。
7. 用户一次说很多地点（10 个以上）也照实全部输出，不要替用户做减法。

示例 1
用户：我想去外滩、豫园、武康路，武康路多待一会儿
输出：places=[{name:"外滩"},{name:"豫园·城隍庙"},{name:"武康路·武康大楼",stayMin:120}]

示例 2
用户：带爸妈玩两天，想去朱家角、七宝老街，别安排太累，每个点待久一点
输出：places=[{name:"朱家角古镇",stayMin:180,tags:["古镇","水乡"]},
             {name:"七宝老街",stayMin:120,tags:["古镇","小吃"]}], summary="两天轻松游，含两个古镇"

示例 3
用户：今天天气不错
输出：places=[], summary="用户在聊天，没有提到具体地点"
"""

REPLAN_SYSTEM_PROMPT = """你是「路书编译师」的行程重规划助手。

用户这句话是对**已经排好的路书**提出的修改意见。请把它翻译成结构化调整参数，
并**调用 replan_constraints 工具返回**。

权重含义（0~1，越大越在意）：
  time 时间（少在路上）/ convenience 换乘（少换乘、直达）/ cost 花费（省钱）/ walking 步行（少走路）

规则：
1. 只填需要改变的字段。用户没提到的字段一律不要填，不要"顺手"改。
2. 「6 点前回酒店」「别太晚」→ dayEndTime="18:00"；「早点出发」→ dayStartTime="08:30"。
3. 「多拍照」「慢慢逛」「别太赶」→ 提高 time 与 walking 的在意度并不合适，
   应体现为 intentSummary 说明「放慢节奏」，同时可把 walking 权重调高（拍照常伴步行）。
4. 「别安排太满」「少去几个」→ days 增加，或 removeNames 去掉最边缘的地点。
5. intentSummary 用一句话复述你的理解，方便用户核对。

示例
用户：少走路，多拍照，6 点前回酒店
输出：weights={walking:1.0, time:0.8}, dayEndTime="18:00",
      intentSummary="少走路、放慢节奏多拍照、18:00 前回到酒店"
"""

EXPLAIN_SYSTEM_PROMPT = """你是「路书编译师」的路线讲解员。

用户会给你一份已经算好的 JSON 路书。请用 3~5 句口语化的中文解释「为什么这样排」。

规则：
1. 先说整体思路（按地理位置分天 / 先近后远 / 避免来回绕路），再点出 1~2 个具体安排的理由。
2. 数字必须用 JSON 里的真实数字（步行公里、交通分钟、花费、到达时间），一个都不要编。
3. 如果有地点因为营业时间或全天时长被排掉，要诚实说明，不要粉饰。
4. 如果有地点到达时间紧贴关门时间，可以提醒一句。
5. 不要用 markdown 标题、列表、加粗，直接说人话，控制在 150 字以内。
"""


def build_place_parse_user_prompt(text: str) -> str:
    return f"用户的原话：{text.strip()}\n请调用 add_destinations 工具返回解析结果。"


def build_replan_user_prompt(text: str, plan_digest: str) -> str:
    return (
        f"当前已排好的路书摘要：\n{plan_digest}\n\n"
        f"用户的修改意见：{text.strip()}\n"
        f"请调用 replan_constraints 工具返回需要改变的参数。"
    )


def build_explain_user_prompt(plan_json: str, question: str | None = None) -> str:
    extra = f"\n用户额外的问题：{question.strip()}" if question else ""
    return f"路书 JSON：\n{plan_json}\n{extra}\n请用中文口语解释这份安排。"


# --------------------------------------------------------------------------- #
# 1.9：对话提案工具 —— 让模型真正参与"这一句话要改什么"
# --------------------------------------------------------------------------- #
TURN_TOOL: dict = {
    "name": "propose_changes",
    "description": (
        "把用户这一句话翻译成对当前路书的修改提案。"
        "只填需要改变的字段；做不到的事用 boundary 说明；缺关键信息用 clarify 反问。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "reply": {
                "type": "string",
                "description": "给用户看的一句话，最多 2 句、50 字以内，先说改什么，再说为什么",
            },
            "addPlaces": {
                "type": "array",
                "description": "要加入的地点（只写名字，坐标后端查）",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "stayMin": {"type": "integer"},
                    },
                    "required": ["name"],
                    "additionalProperties": False,
                },
            },
            "removeNames": {
                "type": "array",
                "description": "要删掉的地点名字",
                "items": {"type": "string"},
            },
            "stayChanges": {
                "type": "array",
                "description": (
                    "把已有地点的停留时长改成指定分钟数（「在豫园停两小时」→ [{name:'豫园·城隍庙', stayMin:120}]）。"
                    "只调时长、不是加新点；加新点请用 addPlaces 并带上 stayMin。"
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "stayMin": {"type": "integer", "description": "停留分钟数，5~600"},
                    },
                    "required": ["name", "stayMin"],
                    "additionalProperties": False,
                },
            },
            "days": {"type": "integer", "description": "行程天数 1~7"},
            "mode": {
                "type": "string",
                "enum": ["walk", "transit", "subway", "taxi", "drive"],
                "description": "用户明确指定时才填交通偏好；合理安排、少走路不代表公交。允许逐段混合交通。",
            },
            "weights": {
                "type": "object",
                "description": "偏好权重 0~1，只填要变的；越大越在意",
                "properties": {
                    "time": {"type": "number"},
                    "convenience": {"type": "number"},
                    "cost": {"type": "number"},
                    "walking": {"type": "number"},
                },
                "additionalProperties": False,
            },
            "dayStartTime": {"type": "string", "description": "出发时间 HH:mm"},
            "dayEndTime": {"type": "string", "description": "收工时间 HH:mm"},
            "budgetCap": {
                "type": "number",
                "description": "总费用上限（元）。用户说“预算 150”“150 以内”就填 150",
            },
            "transitCapMin": {
                "type": "number",
                "description": "路上总时间上限（分钟）。用户说“交通时间 5 小时以内”就填 300",
            },
            "clarify": {
                "type": "string",
                "description": "缺关键信息时的一句话反问，例如“想玩几天？”",
            },
            "boundary": {
                "type": "string",
                "description": (
                    "用户要的是我们没有的数据（酒店星级/实时房价、天气、实时人流、门票人均）时，"
                    "说明没有这项数据并给出替代动作"
                ),
            },
        },
        "required": ["reply"],
        "additionalProperties": False,
    },
}

TOOL_REGISTRY["propose_changes"] = TURN_TOOL

TURN_SYSTEM_PROMPT = """你是「路书编译师」的行程助手，负责把用户的一句话变成对当前路书的修改提案。

硬规则：
1. 你只能输出 propose_changes 工具调用，不要输出解释性文字。
2. reply 最多 2 句、50 字以内：先说改什么，再说为什么（或下一步）。不要罗列参数名。
3. **你没有的数据**：酒店星级/房价、天气、实时人流、门票与人均消费。用户问这些时，
   填 boundary（说明没有并给替代），不要编造。
4. 用户没有明确指定方式时不要填 mode；合理安排、少走路不代表全程公交。多个方式可逐段比较，不要擅自写成全程单一方式。
5. 用户给的数字要落成约束：预算 → budgetCap，路上时间 → transitCapMin（小时×60）。
6. 不要输出经纬度、不要输出不存在的地点名；不确定的地点名就别加，用 clarify 问。
7. 如果这句话不需要改路书（只是提问/闲聊），只填 reply，其它留空。
"""


def build_turn_user_prompt(
    text: str,
    *,
    city: str,
    digest: str,
    candidates: list[str],
    history: list[dict] | None = None,
) -> str:
    lines: list[str] = [f"城市：{city}", f"当前路书：{digest}"]
    if candidates:
        lines.append("可用的地点（只能从这里选）：" + "、".join(candidates[:40]))
    if history:
        lines.append("最近对话：")
        for item in history[-6:]:
            role = "用户" if item.get("role") == "user" else "助手"
            lines.append(f"  {role}：{item.get('text', '')}")
    lines.append(f"用户这句话：{text.strip()}")
    lines.append("请调用 propose_changes 返回提案。")
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# 1.12：Agent 工具集 —— 模型可以先查、先算，再给提案
# --------------------------------------------------------------------------- #
SEARCH_TOOL: dict = {
    "name": "search_pois",
    "description": "在当前城市的地点库里按关键词搜索，返回可用的地点名（含停留时长）。想加地点前先查一下，不要凭空写地名。",
    "parameters": {
        "type": "object",
        "properties": {
            "keyword": {"type": "string", "description": "关键词，如 博物馆 / 咖啡 / 外滩"},
            "limit": {"type": "integer", "description": "最多返回几条，默认 6"},
        },
        "required": ["keyword"],
        "additionalProperties": False,
    },
}

PREVIEW_TOOL: dict = {
    "name": "preview_plan",
    "description": (
        "用当前起点和给定地点试算完整往返路书，返回含每天返程的交通时间、接驳步行、费用、换乘和实际方式。"
        "默认同时比较自动混合交通与公共交通；必须传入将要提议的权重和时间设置，不能混用旧偏好。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "destinations": {
                "type": "array",
                "items": {"type": "string"},
                "description": "地点名列表（必须来自 search_pois 或已有列表）",
            },
            "days": {"type": "integer"},
            "mode": {"type": "string", "enum": ["walk", "transit", "subway", "taxi", "drive"]},
            "weights": TURN_TOOL["parameters"]["properties"]["weights"],
            "dayStartTime": {"type": "string"},
            "dayEndTime": {"type": "string"},
            "compareTransport": {"type": "boolean", "description": "比较公共交通与自动混合交通，默认 true"},
            "budgetCap": {"type": "number"},
            "transitCapMin": {"type": "number"},
        },
        "required": ["destinations"],
        "additionalProperties": False,
    },
}

TOOL_REGISTRY["search_pois"] = SEARCH_TOOL
TOOL_REGISTRY["preview_plan"] = PREVIEW_TOOL

AGENT_SYSTEM_PROMPT = """你是「路书编译师」的行程 agent。你的任务是理解用户这一句话，并用工具把它变成可执行的路书改动。

工作方式：
1. 需要地点时先调 search_pois，不要凭记忆写地名（也不要写经纬度）。
2. 用户提到预算、路上时间、够不够、要不要打车时，先调 preview_plan 算一遍，用真实数字说话。
3. 信息够了下结论：调 propose_changes 给出 ops（加/删地点、停留时长、天数、方式、权重、时间、预算/时长上限）。
   用户要调整**已有地点**的停留时长（「停两小时」「待久一点」「多玩一会儿」）时用 stayChanges 指明地点和新时长，
   不要当成加新点；新地点才用 addPlaces（带上 stayMin）。
4. 缺关键信息（几天？哪个城市？）用 clarify 反问一句，一次只问一个。
5. 我们没有的数据：酒店星级/实时房价、天气、实时人流、门票与人均消费。遇到这些用 boundary 说明，并给一个能做的替代，不要编数字。
6. 用户同时给多个交通方式但没定取舍时，用 preview_plan 各算一遍，再推荐更合适的一个（说明理由）。
7. 没有明确指定交通方式时，不要填 mode。合理安排、不要长距离步行不代表全程公交，应逐段比较公共交通、打车和短途步行。
8. preview_plan 必须带上准备提议的新权重与时间。所有交通数字包含每天返回起点，说明是接驳步行、不含景点内游览。
9. 当前只是待确认提案，使用“准备/试算”，不能说“已排好”；没有工具结果不能编费用、公里、分钟或宣称最优。

回复规范：reply 最多 2 句、50 字以内；不要罗列参数名；不要 markdown。
"""
