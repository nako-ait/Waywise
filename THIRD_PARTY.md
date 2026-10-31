# 第三方依赖与许可（THIRD_PARTY）

> 本项目是校内比赛 / 校招作品，不对外商用。下表是主要依赖及其许可证，具体以各包内 LICENSE 为准。

## 后端（Python）

| 依赖 | 许可证 | 用途 |
| --- | --- | --- |
| fastapi | MIT | Web 框架 |
| uvicorn | BSD-3-Clause | ASGI 服务器 |
| pydantic / pydantic-settings | MIT | 数据模型与配置 |
| httpx | BSD-3-Clause | HTTP 客户端（高德 / LLM） |
| langgraph | MIT | 对话状态机（understand → propose → guard） |
| langchain-core | MIT | LangGraph 运行时依赖 |
| or-tools（可选） | Apache-2.0 | TSP/VRP 求解；未安装时用内置纯 Python 求解器 |
| python-dotenv | BSD-3-Clause | .env 读取 |

## 前端（Node）

| 依赖 | 许可证 | 用途 |
| --- | --- | --- |
| react / react-dom | MIT | UI |
| react-router-dom | MIT | 路由 |
| zustand | MIT | 状态管理 |
| vite | MIT | 构建与开发服务器 |
| tailwindcss | MIT | 样式 |
| typescript | Apache-2.0 | 类型检查 |
| @amap/amap-jsapi-loader | MIT | 高德 JS API 加载器 |

## 数据与服务条款

| 来源 | 条款 | 说明 |
| --- | --- | --- |
| 高德开放平台（JS API / Web 服务） | 商业服务条款 | 仅用于演示；POI 快照不对外分发原始数据 |
| DeepSeek / 通义 / 智谱 API | 各家服务条款 | 用户自备 Key，仅存在本地浏览器，随请求转发 |
| 上海 POI 快照（backend/data） | 由高德数据整理 | 演示用途，不做二次分发 |
| 首页旅行摄影（frontend/public/inspiration） | [Unsplash License](https://unsplash.com/license) | 32 张本地压缩实景照片；摄影师与原页见同目录 credits.json，页面内也提供署名链接 |

Waywise 首页的照片圆环交互参考了 inkwell.tech 的视觉节奏，界面与动效代码在本项目内实现，没有复制该站代码、Logo 或图片。

## 参考过思路的开源项目（未复制代码）

| 项目 | 许可证 | 参考点 |
| --- | --- | --- |
| OSU-NLP-Group/TravelPlanner | MIT | 工具循环、约束评测的思路 |
| langchain-ai/langgraph | MIT | 有状态编排、human-in-the-loop 语义 |

> 说明：以上项目仅参考架构思路，没有复制其源码；本项目的对话状态机、提案/执行两段式接口均为自行实现。
