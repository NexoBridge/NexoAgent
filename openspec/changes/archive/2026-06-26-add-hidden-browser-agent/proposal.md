## Why

Nexo Agent 可以推理并运行本地命令，但还不能在同一段对话里代表用户浏览和操作真实 Web 应用。很多网站任务需要保留 Cookie、读取当前页面状态、点击控件、输入文本，甚至把当前页面截图发回对话供用户确认。

这个变更添加一个共享 Electron 浏览器运行时。它默认服务于对话：Agent 通过 `browser_action` 操作隐藏或可见的同一浏览器会话；用户需要看页面时，可以打开对话旁浏览器视图，右侧仍然是现有会话组件，而不是一个新的独立“浏览器功能工作台”。

## What Changes

- 在 Electron 主进程/服务进程中添加基于 `BrowserView` 的共享浏览器运行时，默认可隐藏运行。
- 将浏览器自动化收敛为单一 `browser_action` 工具，通过 `action` 参数支持导航、快照、点击、输入、滚动、截图、刷新、前进和后退。
- 返回紧凑的结构化页面状态给 Agent，包括 URL、标题、可见文本、导航状态和交互元素引用。
- 使用持久化 Electron partition 保持 Cookie 和登录状态，让隐藏工具调用和可见对话旁浏览器视图共享同一会话。
- 添加对话旁浏览器视图：浏览器左侧显示浏览历史，中间是真实 Web 页面，右侧显示会话历史和现有聊天组件；只保留最小地址栏、刷新、前进、后退控件。
- 在浏览器和会话之间添加竖排占位控制条，支持网页缩放、重置缩放，语义类似 `Ctrl + 鼠标滚轮`。
- 移除独立 Agent prompt 表单、手动 action 调试控件、隐藏工作台按钮和功能说明卡片，避免把浏览器能力包装成单独功能。
- 让 `browser_action.screenshot` 产生的 artifact 自动作为 assistant 消息附件进入对话，并持久化到会话历史。
- 添加运行时指导，使编排器仅在 Web 浏览和 Web 应用操作任务中使用 `browser_action`，而非把它当成通用 HTTP/Web 搜索工具。

## Capabilities

### New Capabilities

- `hidden-browser-agent`：定义 Electron 浏览器运行时、隐藏/可见会话共享方式、`browser_action` 工具契约，以及截图作为对话附件返回的行为。
- `browser-workbench`：定义对话旁浏览器视图，包括最小导航条、真实页面视图、复用现有会话组件、分栏和安全隔离。

### Modified Capabilities

- `minimal-agent-toolset`：允许在内置工具目录中添加范围收窄的 `browser_action`，同时保持不相关工具的精简意图。
- `model-orchestration`：扩展编排行为，使浏览器任务可以使用 `browser_action`，截图结果可以进入对话附件，而文件系统和命令行工作仍优先使用 `shell_command`。

## Impact

- 影响 Electron 运行时代码：`electron/main.ts` 生命周期、preload IPC，以及 `electron/server/browser-manager.ts`。
- 影响工具运行时：`nexo/tools.json`、`electron/server/tools/executors.ts` 和工具注册/迁移逻辑。
- 影响 Agent 行为：`electron/server/agent.ts` 的提示词、工具描述和截图附件收集。
- 影响聊天流：SSE `done` 事件、聊天路由、任务/渠道运行和前端 store 需要携带 assistant 附件。
- 影响 UI：新增对话旁浏览器视图组件，复用现有 `ChatPanel`，并同步 Web 内容 bounds。
- 影响安全姿态：外部 Web 内容必须禁用 Node integration、启用 context isolation 和 sandboxing，并与 Nexo 应用 UI 权限隔离。
