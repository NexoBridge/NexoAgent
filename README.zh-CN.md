# Nexo Agent

[English](./README.md)

Nexo Agent 是一个本地优先的 AI Agent 桌面应用和 Web 控制台。它把对话、多模型编排、内置工具、持久记忆、本地知识库、定时任务和 AI 浏览器放在同一个工作台里。

项目基于 Electron、React、TypeScript、Ant Design、Express、LangChain、SQLite/sql.js 和 Vite 构建。Electron 桌面端会启动同一套本地后端，Web 控制台也使用这套后端，因此桌面端和 Web 端共享会话、设置、记忆、工具、上传文件和运行时状态。

## 当前状态

这是一个正在持续演进的产品和 Agent Runtime 工作区。部分界面已经具备产品形态，但能力边界仍在迭代中。README 描述当前运行时方向和 `nexo/tools.json` 中的内置工具集；进行中的能力契约以 `openspec/` 下的 OpenSpec 变更为准。

## 核心能力

- 多会话聊天：支持流式回复、会话持久化、中断、工具调用轨迹和历史管理。
- 多模型编排：通过 LangChain 对接 OpenAI-compatible、Anthropic-compatible 和自定义模型配置。
- 精简内置工具：支持命令行、模型子调用、定时任务、记忆检索、脚本记忆写入和浏览器操作。
- AI 浏览器：内置共享 Electron 浏览器会话，支持网页查看、网页应用操作、截图、DOM-first 目标解析、CDP 输入事件和高权限运行时脚本。
- 浏览器脚本短期缓存：`scriptCache` 用于临时抓包、请求重放和调试样本，和长期 `script` 记忆分离。
- 持久记忆：使用 SQLite 保存 `daily`、`dream`、`script` 三类记忆，并在可用时使用 embedding 检索。
- 本地知识库：管理 Markdown 文档，并在配置 embedding 后支持语义检索。
- 上下文管理：支持 token-aware 上下文预算、长对话滚动压缩和大工具输出保护。
- 桌面打包：通过 electron-builder 生成 Windows、macOS 和 Linux 安装包。

## 快速开始

### 环境要求

- Node.js 22 或兼容版本
- npm
- 可用的模型服务 endpoint 和 API Key

### 安装依赖

```bash
npm install
```

### 启动 Electron 桌面端

```bash
npm run dev:electron
```

该命令会启动：

- Vite Web 开发服务：`http://localhost:8106`
- Electron 主进程 TypeScript watch
- Electron 桌面窗口
- 本地 Express 后端和 Web 控制台：`http://localhost:9898`

### 只启动 Web 开发服务

```bash
npm run dev:web
```

Vite 会监听 `http://localhost:8106`，并把 `/api` 和 `/uploads` 代理到 `http://localhost:9898`。如果只运行 `dev:web`，需要确保后端已经启动。

### 运行构建后的 Web 控制台

```bash
npm run build
npm run serve:web-console
```

默认地址：

```text
http://localhost:9898
```

## 配置

首次启动后，在 Settings 中配置模型 Profile。

常见配置项：

| 配置 | 用途 |
| --- | --- |
| Provider | OpenAI-compatible、Anthropic-compatible 或自定义 provider |
| API Base URL | 模型服务地址，例如 `https://api.openai.com/v1` |
| API Key | 模型服务密钥 |
| Model | 聊天模型名称 |
| Temperature | 默认输出随机性 |
| Workspace Path | 命令和工作区任务的默认根目录 |
| Context Window | 可选的模型上下文窗口覆盖值 |
| Reserved Output Tokens | 为模型输出预留的 token 数 |
| Context Compaction Threshold | 触发滚动会话摘要的消息数量阈值 |
| Max Tool Steps | 单次 assistant 回合允许的最大工具调用步数 |
| Shell Command Timeout | `shell_command` 默认超时时间 |
| Memory / Knowledge Toggles | 是否启用记忆检索和本地知识注入 |

没有配置模型 API Key 时，应用仍可打开，但完整 Agent 能力需要可用的 provider profile。

## 内置工具

内置工具元数据位于 `nexo/tools.json`，执行器位于 `electron/server/tools/`。

默认启用工具：

| 工具 | 用途 |
| --- | --- |
| `shell_command` | 在配置的工作区内运行命令，用于开发、检查和脚本化本地工作流。 |
| `invoke_model` | 调用默认模型或指定模型 Profile，支持视觉、图像生成、图像编辑、语音转文字、文字转语音和 embedding 等能力，取决于配置。 |
| `create_scheduled_task` | 创建显示在 Tasks 面板中的未来任务或周期任务。 |
| `recall_memory` | 检索 SQLite 中持久化的 `daily`、`dream` 或 `script` 记忆。 |
| `store_script_memory` | 保存长期可复用的脚本记忆、runbook、重放模板或工作流说明。 |
| `browser_action` | 操作共享 AI 浏览器，支持单步浏览器动作、截图、DOM/AX 解析、CDP 输入和高权限脚本。 |

工具集刻意保持精简。短期抓包数据应使用 `scriptCache`；只有稳定、跨会话复用的流程才应提升为 `store_script_memory`。

## AI 浏览器

AI 浏览器是一个和当前对话绑定的共享 Electron 浏览器。Agent 可以用它查看网页、操作 Web 应用、截图取证和执行浏览器自动化，同时用户仍然停留在同一个对话上下文里。

支持的 `browser_action` 动作：

```text
snapshot, resolve, navigate, click, type, scroll, wheel, hover, drag,
key, script, screenshot, refresh, back, forward
```

### 单次调用只做一个动作

非脚本类浏览器动作每次只执行一个浏览器操作，并返回更新后的页面状态。多步网页流程应该拆成多次工具调用：

1. `snapshot` 或 `resolve`
2. `click`
3. 检查返回状态
4. 继续 `type`、`scroll`、`screenshot` 或下一个动作

这样可以保持元素 ref 新鲜，避免长链路宏操作变得不透明。

### DOM-first 目标解析

普通网页控件优先使用 DOM 和可访问性信息，而不是视觉截图定位。解析器会使用：

- AX tree 快照
- 稳定元素 ref
- stale ref 重新解析
- DOM 元数据
- 显式 selector / XPath
- 必要时的坐标兜底
- CDP 输入事件

示例：

```json
{
  "action": "click",
  "target": { "query": "Submit", "role": "button" },
  "strategy": "auto"
}
```

### 高权限浏览器脚本

`browser_action` 的 `action="script"` 会运行 Electron 侧服务脚本，而不是普通页面 JavaScript。脚本可以直接访问：

- `browserView`
- `webContents`
- `cdp`、`rawDebugger`、`sendCommand(...)`、`cdpSend(...)`
- `scriptCache`
- `browserManager`
- `require`、`Buffer`、`process`、`console`、定时器等 Node/Electron 运行时对象

该能力用于明确需要 BrowserView 编程、原始 CDP、请求捕获、运行时调试或可复用页面注入的场景。普通点击和输入仍应优先使用标准浏览器动作。

脚本工具输出会刻意保持窄范围：返回给模型的工具结果只包含 `ok` 和脚本执行结果。它不会返回浏览器历史、元素快照、页面文本、URL/title 元数据或 resolver 状态，除非脚本自己显式返回这些值。如果脚本执行后需要完整页面状态，应再调用一次 `browser_action` 的 `action="snapshot"`。

### scriptCache

`scriptCache` 是 `action="script"` 中可用的短期缓存，用于临时抓包、请求重放和调试样本，例如请求 URL、headers、body、状态码和响应片段。

可用操作包括：

```text
set, get, getEntry, list, delete, clear,
capture, consume, consumeEntry, replay
```

缓存条目带 TTL 自动过期。一次性样本用完后，脚本应主动调用 `consume`、`delete`、`clear`，或使用 `replay(..., { deleteAfter: true })` / `replay(..., { deleteOnSuccess: true })` 清理。

## 记忆

Nexo 将持久记忆保存在本地数据目录下的 SQLite 数据库中。

| 类型 | 说明 |
| --- | --- |
| `daily` | 按日期记录的对话事实 |
| `dream` | 对 daily/script 记忆的日级整合摘要 |
| `script` | 长期可复用的工作流、脚本、runbook、抓包重放模板和流程状态 |

当 embedding profile 可用时，记忆检索可以使用向量召回；不可用时会回退到 SQLite 关键词匹配。

线程压缩和持久记忆是两套机制。长对话会用滚动摘要维持当前上下文连续性；`daily`、`dream`、`script` 则用于跨会话召回。

## 知识库

本地知识库用于管理 Markdown 文档，并在聊天时注入相关资料。

支持：

- 浏览、创建、编辑和删除 Markdown 文档
- Markdown 预览
- 配置 embedding 后的语义检索
- embedding 不可用时的关键词兜底

适合保存项目规则、操作手册、团队上下文、业务说明和其他可复用参考资料。

## 定时任务

定时任务会在未来通过 Nexo 内置调度器运行指定 prompt。任务支持：

- `cron`：5 字段周期任务
- `runAt`：一次性指定时间运行
- `delayMinutes`：延迟若干分钟后运行一次

任务完成后会保存为任务会话，方便回看。

## 本地数据

运行时数据默认保存在仓库外：

```text
%USERPROFILE%/.NexoAgent
```

常见内容：

- 设置和模型 profiles
- 会话
- 记忆 SQLite 数据库
- Chroma 或 embedding 相关本地数据
- 知识库文件
- 托管技能
- 定时任务
- 上传文件和生成产物
- 运行日志

这些本地运行时数据通常不应提交到仓库。

## 项目结构

```text
nexoAgent/
|-- electron/
|   |-- bootstrap.ts              # Electron 启动入口
|   |-- main.ts                   # 桌面窗口、IPC、本地后端启动
|   |-- preload.ts                # 安全的 renderer bridge
|   |-- memory.ts                 # SQLite 记忆和检索辅助逻辑
|   `-- server/
|       |-- agent.ts              # Agent 循环、提示词、工具、上下文组装
|       |-- browser-manager.ts    # AI 浏览器运行时和 browser_action 后端
|       |-- conversation-context.ts
|       |-- tool-output.ts        # 大工具输出保护
|       |-- routes/               # HTTP API 路由
|       `-- tools/                # 内置工具执行器和注册表
|-- src/
|   |-- components/               # React UI 面板和布局
|   |-- services/                 # API 客户端层
|   |-- shared/                   # 共享类型、端口、设置
|   |-- store/                    # 客户端状态
|   |-- theme/                    # 主题配置
|   `-- i18n/                     # UI 文案
|-- nexo/
|   |-- tools.json                # 内置工具元数据
|   |-- skills/                   # 内置技能
|   `-- models/                   # 本地浏览器解析模型资源
|-- docs/                         # 项目文档
|-- openspec/                     # 能力规格和变更提案
|-- scripts/                      # 验证和维护脚本
|-- assets/                       # 图标和静态资源
|-- release/                      # 打包输出
|-- README.md                     # 英文优先文档
`-- README.zh-CN.md               # 简体中文文档
```

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev:web` | 启动 Vite Web 开发服务 |
| `npm run dev:electron` | 启动完整 Electron 开发环境 |
| `npm run build:web` | 类型检查并构建 React 前端 |
| `npm run build:electron` | 编译 Electron main/preload/server 代码 |
| `npm run build` | 构建前端和 Electron 代码 |
| `npm run serve:web-console` | 运行构建后的本地 Web 控制台 |
| `npm run preview` | 预览 Vite 构建产物 |
| `npm run typecheck` | 执行前端和 Electron TypeScript 检查 |
| `npm run verify:context-management` | 验证滚动上下文压缩 |
| `npm run verify:tool-output-bounds` | 验证大工具输出摘要和 raw-output 引用 |
| `npm run verify:browser-action-run` | 验证浏览器动作运行时 |
| `npm run verify:provider-embeddings` | 验证 provider embedding 配置 |
| `npm run verify:memory-recall` | 验证记忆检索 |
| `npm run verify:multimodal-models` | 验证多模态模型路由 |
| `npm run package` | 构建图标、构建应用并通过 electron-builder 打包 |
| `npm run package:win` | 打包 Windows 产物 |
| `npm run package:mac` | 打包 macOS 产物 |
| `npm run package:linux` | 打包 Linux 产物 |

打包产物输出到：

```text
release/
```

## 端口

定义位置：`src/shared/ports.ts`。

| 服务 | 端口 | 地址 |
| --- | --- | --- |
| Vite 开发服务 | `8106` | `http://localhost:8106` |
| Express API / Web 控制台 | `9898` | `http://localhost:9898` |
| Vite preview | `4173` | `http://localhost:4173` |

## 开发入口

- Agent 行为通常从 `electron/server/agent.ts` 开始看。
- AI 浏览器运行时主要在 `electron/server/browser-manager.ts`。
- 新增内置工具需要同时更新 `nexo/tools.json` 和 `electron/server/tools/executors.ts`。
- 共享类型在 `src/shared/types.ts`。
- 大工具输出保护在 `electron/server/tool-output.ts`。
- 上下文压缩在 `electron/server/conversation-context.ts`。
- 聊天 UI 主要在 `src/store/chat.ts` 和 `src/components/ChatPanel/`。
- 能力变更和需求应写入 `openspec/`。

## 当前边界

- 渠道配置页面不是完整生产级消息网关。
- MCP 支持目前偏配置管理，运行时发现和调用不是当前默认内置路径。
- 知识库检索是本地 Markdown 检索，不等同于带权限、引用和高级排序的企业级 RAG。
- 视觉、图像生成、音频和 embedding 能力取决于模型 profile 和 provider 支持。
- 浏览器自动化对 DOM 可访问的 Web 应用最强。Canvas-only UI、跨域 iframe 内部、插件内容和强反自动化页面可能需要截图、用户确认或站点专用脚本。
- `action="script"` 是高权限能力，应只用于明确需要浏览器运行时、CDP、抓包、重放或调试的场景。

## License

本项目使用 Apache License 2.0，详见 [LICENSE](./LICENSE)。
