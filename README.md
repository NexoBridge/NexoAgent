# Nexo Agent

[English](./README.en.md)

Nexo Agent 是一个本地优先的 AI Agent 桌面与 Web 控制台。它把对话、工具调用、长期记忆、本地知识库、技能系统和定时任务放在同一个工作台中，适合构建个人或团队内网环境中的 Agent 助手。

项目基于 Electron、React、TypeScript、Ant Design、Express 和 LangChain 构建。应用既可以作为 Electron 桌面端运行，也可以通过本地 Web 控制台访问同一套会话、设置和运行能力。

## 功能概览

- 多会话聊天：支持会话创建、切换、重命名、删除、持久化和流式回复。
- OpenAI 兼容模型：可配置 API Base URL、API Key、模型、温度、规划模式、上下文轮次和最大工具步数。
- 工具调用：基于 LangChain tool calling 执行搜索、HTTP 请求、模型子调用、计算、文件读写、记忆召回、技能搜索与安装、终端命令等工具。
- 本地记忆：使用 SQLite 保存 `daily`、`dream`、`long_term`、`script` 四类记忆，并在有 embedding 能力时启用语义召回。
- 梦境记忆：把每日记忆整合成可长期召回的 dream 记录，帮助跨会话保留上下文。
- 本地知识库：支持创建、编辑、删除、浏览 Markdown 文档，并在聊天时检索相关知识内容。
- 技能系统：加载内置技能、工作区技能和市场安装技能，将启用的技能说明注入 Agent 提示词。
- 定时任务：支持 5 字段 Cron 任务，可定时或手动触发提示词任务，并生成任务会话。
- 附件与日志：支持上传文本附件作为上下文，并通过日志面板查看运行日志。
- 桌面与 Web 双端：Electron 桌面端会同时启动本地 Web 控制台，Web 端也可以独立构建后运行。

## 快速开始

### 环境要求

- Node.js 22 或兼容版本
- npm
- 一个 OpenAI-compatible 模型服务 API Key

### 安装依赖

```bash
npm install
```

### 启动 Electron 桌面端

```bash
npm run dev:electron
```

该命令会同时启动：

- Vite 前端开发服务，默认地址为 `http://localhost:8106`
- Electron 主进程 TypeScript watch
- Electron 桌面窗口
- 本地 Express Web 控制台，默认地址为 `http://localhost:9898`

### 仅启动 Web 前端开发服务

```bash
npm run dev:web
```

Vite 会监听 `http://localhost:8106`，并把 `/api` 与 `/uploads` 代理到本地后端 `http://localhost:9898`。如果只运行 `dev:web`，需要同时有后端服务可用。

### 构建后运行 Web 控制台

```bash
npm run build
npm run serve:web-console
```

默认访问地址：

```text
http://localhost:9898
```

## 基础配置

首次启动后，进入 Settings 页面配置模型与运行参数：

| 配置项 | 说明 |
| --- | --- |
| API Base URL | OpenAI 兼容接口地址，例如 `https://api.openai.com/v1` |
| API Key | 模型服务密钥；桌面端会通过 Electron 能力保存 |
| Model | 模型名称，例如 `gpt-4o-mini`、`deepseek-chat`、`qwen-*` |
| Provider | OpenAI Compatible、DeepSeek、Qwen、Doubao 或 Custom |
| Workspace Path | 文件工具默认访问的工作区根目录 |
| Extra File Access Roots | 允许 `file_read`、`file_write` 访问的其他绝对路径 |
| Temperature | 模型输出随机性 |
| Max Context Turns | 请求模型时携带的最近会话轮次 |
| Max Tool Steps | 单次回复允许的最大工具调用步数 |
| Shell Command Timeout | `shell_command` 默认超时时间 |
| Planning Mode | Fast、Balanced、Deep |
| Enable Memory | 是否在聊天中召回和写入记忆 |
| Enable Knowledge | 是否在聊天中检索本地知识库 |

如果未配置 API Key，聊天会返回本地演示响应；配置模型后才能使用完整 Agent 能力。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev:web` | 启动 Vite Web 开发服务 |
| `npm run dev:electron` | 启动 Electron 桌面开发环境 |
| `npm run build:web` | 类型检查并构建 Web 前端 |
| `npm run build:electron` | 编译 Electron 主进程 |
| `npm run build` | 构建完整应用 |
| `npm run serve:web-console` | 运行构建后的本地 Web 控制台 |
| `npm run preview` | 预览 Vite 构建产物 |
| `npm run typecheck` | 执行前后端 TypeScript 类型检查 |
| `npm run package` | 使用 electron-builder 打包桌面应用 |

打包产物默认输出到：

```text
release/
```

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面容器 | Electron 33 |
| 前端 | React 18、TypeScript、Ant Design 5 |
| 状态管理 | Zustand |
| 构建工具 | Vite 6 |
| Agent 编排 | LangChain、OpenAI-compatible Chat API |
| 后端服务 | Express、Server-Sent Events |
| 本地存储 | JSON 文件、SQLite/sql.js |
| 记忆检索 | OpenAI Embeddings、Chroma、SQLite 关键词降级检索 |
| 打包 | electron-builder |

## 项目结构

```text
nexoAgent/
├── electron/
│   ├── bootstrap.ts              # Electron 启动入口
│   ├── main.ts                   # 桌面窗口、IPC、设置保存、本地 Web 服务
│   ├── memory.ts                 # SQLite 记忆、梦境整合、向量召回
│   ├── preload.ts                # Electron preload bridge
│   └── server/
│       ├── agent.ts              # LangChain Agent 循环、工具调用、上下文拼装
│       ├── routes/               # settings/chat/session/memory/knowledge/tools 等 API
│       ├── tools/                # 工具执行器与工具注册表
│       ├── skills.ts             # 技能加载、开关、市场安装
│       ├── knowledge.ts          # 本地知识库读取与检索
│       └── tasks.ts              # 定时任务运行逻辑
├── src/
│   ├── components/               # Chat、Memory、Knowledge、Tools、Skills、Tasks 等 UI
│   ├── services/api.ts           # Electron IPC 与 Web fetch 的双通道 API 适配
│   ├── store/chat.ts             # 会话、消息流、工具调用状态
│   ├── shared/                   # 前后端共享类型、设置和端口常量
│   └── theme/                    # 主题配置
├── nexo/
│   ├── tools.json                # 内置工具元数据
│   └── skills/                   # 内置技能
├── docs/                         # 项目文档
├── openspec/                     # OpenSpec 变更与能力规格
└── .nexo-data/                   # 本地运行数据，开发运行后生成
```

## Agent 工具

内置工具定义在 `nexo/tools.json`，执行器位于 `electron/server/tools/`。

| 工具 | 用途 |
| --- | --- |
| `web_search` | 搜索近期信息并返回链接与摘要 |
| `http_request` | 发送 HTTP 请求并返回响应预览 |
| `invoke_model` | 调用默认模型或已配置的模型配置执行子任务 |
| `calculator` | 计算数学表达式 |
| `file_read` | 在允许目录内读取文件或目录 |
| `file_write` | 在允许目录内写入或追加文件 |
| `recall_memory` | 搜索每日、梦境、长期或脚本记忆 |
| `search_skills` | 搜索技能市场或本地技能 |
| `create_skill` | 从对话中创建本地托管技能 |
| `install_skill` | 从支持的技能市场安装技能 |
| `create_scheduled_task` | 创建会出现在 Tasks 面板并由 Nexo 调度器执行的定时任务 |
| `shell_command` | 在工作区内执行终端命令 |

文件读写工具受工作区路径和额外访问目录限制。访问外部路径前，需要在 Settings 中授权对应目录，或通过终端命令处理。

## 记忆系统

记忆系统位于 `electron/memory.ts`，数据默认保存在 `.nexo-data/` 下。

| 类型 | 说明 |
| --- | --- |
| `daily` | 按自然日保存从对话中抽取的事实 |
| `dream` | 将某一天的 daily、long_term、script 记忆汇总成可召回摘要 |
| `long_term` | 保存跨会话仍然有效的长期事实 |
| `script` | 保存流程运行状态和关键数据，帮助脚本或工作流保持一致 |

主数据存储在 `.nexo-data/memory.sqlite`。当 API Key 与 embedding 能力可用时，系统会尝试使用 Chroma 做语义检索；当向量能力不可用时，会降级到 SQLite 关键词匹配。

## 知识库

知识库提供本地 Markdown 文件管理能力：

- 浏览知识目录树
- 新建 Markdown 文件
- 编辑和删除知识文件
- Markdown 预览
- 聊天时按查询检索相关知识内容

知识库适合存放项目说明、团队规则、常用流程、业务背景和模型需要长期参考的资料。

## 技能系统

技能是可注入 Agent 提示词的能力说明。Nexo Agent 支持：

- 内置技能：随项目放在 `nexo/skills/`
- 工作区技能：从工作区发现的技能
- 托管技能：通过 UI 或工具创建的本地技能
- 市场技能：从支持的技能市场搜索和安装

在 Skills 面板中可以启用、禁用和删除非内置技能。启用后的技能会在对话时被注入系统提示词，影响 Agent 的行为方式。

## 定时任务

Tasks 面板支持创建 5 字段 Cron 任务：

```text
0 9 * * *    # 每天 9 点运行
```

每个任务包含名称、Cron 表达式、提示词和启用状态。任务可以定时触发，也可以手动运行。运行完成后会生成一条任务会话，方便回看结果。

## 本地数据

开发运行时，本地数据主要保存在：

```text
.nexo-data/
```

常见内容包括：

- 会话记录
- 设置
- 记忆 SQLite 数据库
- Chroma 向量数据
- 知识库文件
- 技能与市场配置
- 任务和日志
- 上传附件

该目录通常不应提交到版本库。

## 当前边界

- 飞书、钉钉、微信、企业微信等通道页面目前以配置保存为主，还不是完整消息收发运行时。
- MCP 服务目前主要是配置管理，尚未完整接入运行时工具发现、进程管理和调用链路。
- 知识库检索偏轻量，适合本地 Markdown 召回；复杂企业级 RAG 仍需要进一步扩展。
- 图片附件目前主要展示和保存元数据；图像理解需要后续接入视觉模型路径。
- Web 密码认证接口已存在，但前端尚未完整实现登录拦截。

## 开发建议

- 修改 Agent 行为优先查看 `electron/server/agent.ts`。
- 新增工具时同时更新 `nexo/tools.json` 和 `electron/server/tools/executors.ts`。
- 修改共享类型时查看 `src/shared/types.ts`。
- 涉及记忆结构时注意 SQLite schema、迁移逻辑和 Chroma 降级路径。
- 涉及 OpenSpec 流程时查看 `openspec/` 下的变更和能力文档。

## License

本项目使用 Apache License 2.0。详见 [LICENSE](./LICENSE)。
