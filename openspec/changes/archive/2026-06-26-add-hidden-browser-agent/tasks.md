## 1. 浏览器运行时

- [x] 1.1 创建 `BrowserManager`，懒加载并复用共享 Electron 浏览器会话。
- [x] 1.2 配置隐藏运行模式：固定离屏视口、`partition: "persist:agent-browser"`、`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`。
- [x] 1.3 为对话旁的浏览器视图提供可嵌入主窗口的 Web 内容承载方式。
- [x] 1.4 添加管理器生命周期处理：窗口/视图复用、关闭恢复、导航等待、操作串行化，以及应用关闭时清理。
- [x] 1.5 统一维护当前 URL、标题、`canGoBack`、`canGoForward`、加载状态和最近快照引用映射。

## 2. `browser_action` 工具核心

- [x] 2.1 在 `nexo/tools.json` 中添加单一 `browser_action` 元数据，参数包含 `action`、`url`、`ref`、`text`、`submit`、`direction`、`amount` 等字段。
- [x] 2.2 在 `electron/server/tools/executors.ts` 中添加 `browser_action` 执行器，按 action 委托给 `BrowserManager`。
- [x] 2.3 实现 `navigate` action，校验 HTTP/HTTPS 协议，并对常规页面和 SPA 提供尽力而为的等待行为。
- [x] 2.4 实现 `snapshot` action，返回 URL、标题、导航状态、裁剪后的可见文本以及裁剪后的交互元素条目。
- [x] 2.5 为交互元素生成快照内引用，并在管理器中存储最新引用映射。
- [x] 2.6 实现 `click`、`type`、`scroll`、`refresh`、`back` 和 `forward` action，并在操作后返回更新后的页面状态。
- [x] 2.7 实现 `screenshot` action，捕获视口并返回托管图片 artifact，不将完整图片数据嵌入常规快照响应。
- [x] 2.8 返回清晰的引用失效、协议不支持、导航失败和 action 不支持错误信息。
- [x] 2.9 提升工具设置迁移版本号，使现有安装能够标准化设置并接收 `browser_action` 默认值。

## 3. 对话旁浏览器视图

- [x] 3.1 创建浏览器视图组件，左侧显示共享 Electron 浏览器页面，右侧直接复用现有对话组件。
- [x] 3.2 保留最小浏览器导航条：URL 输入、刷新、后退、前进；移除“隐藏工作台”按钮和功能说明文案。
- [x] 3.3 移除独立 Agent 提示表单、手动 action 下拉、快照/截图按钮、浏览器会话说明卡片和可见 warning alert。
- [x] 3.4 对话组件发送消息时复用现有 Agent runtime，并让 Agent 使用同一浏览器会话的 `browser_action`。
- [x] 3.5 实现浏览器区域和对话区域的左右分栏拖拽调整，并持久化用户偏好的分栏宽度。
- [x] 3.6 在浏览器页面左侧添加轻量历史记录栏，展示最近访问页面并支持点击重新导航。
- [x] 3.7 在浏览器和会话之间添加竖排占位控制条，支持网页放大、缩小和重置缩放。
- [x] 3.8 在浏览器视图右侧显示会话历史栏，并与现有聊天组件共同使用当前会话状态。
- [x] 3.9 处理窗口 resize、分栏 resize 后的 Web 内容 bounds 同步，避免网页区域与 UI 控件重叠。
- [x] 3.10 离开浏览器视图时隐藏或挂起可见 Web 内容，但保留共享浏览器会话状态。

## 4. IPC 与状态同步

- [x] 4.1 扩展 `DesktopApi` / preload，暴露受限浏览器 API：获取状态、执行 browser action、bounds 更新和状态订阅。
- [x] 4.2 在主进程中注册浏览器 IPC handler，并委托给 `BrowserManager`。
- [x] 4.3 将浏览器 URL、标题、加载状态、`canGoBack` 和 `canGoForward` 变化推送给渲染进程。
- [x] 4.4 确保外部页面打开新窗口或跳转非 Web 协议时按安全策略拦截或交给系统浏览器。

## 5. 对话编排与截图附件

- [x] 5.1 更新 `electron/server/agent.ts` 提示词，使其把浏览器视为当前对话使用的共享能力，而不是独立功能页。
- [x] 5.2 指导 Agent 在交互式 Web 浏览、页面检查和 Web 应用操作任务中使用 `browser_action`。
- [x] 5.3 指导 Agent 在用户要求查看当前页面、视觉状态重要或需要检查布局时调用 `browser_action` 的 `screenshot`。
- [x] 5.4 将 `browser_action.screenshot` 产生的 artifact 收集为 assistant 消息附件，并通过 SSE `done.attachments` 返回前端。
- [x] 5.5 在聊天路由、任务运行和渠道运行持久化 assistant 附件。
- [x] 5.6 确保前端流结束时把截图附件挂到当前 assistant 消息，由现有消息气泡渲染。
- [x] 5.7 保持引导仍将文件系统和命令行工作路由到 `shell_command`，不重新引入 HTTP/Web 搜索工具行为。
- [x] 5.8 保持 `browser_action` 工具描述明确说明用户意图、敏感站点、凭据输入限制以及 Electron 浏览器自动化的局限性。

## 6. 验证

- [x] 6.1 在代码库支持直接测试的地方，添加或更新针对 URL 校验、action 分发、快照格式、输出限制以及引用失效行为的测试说明；当前仓库未提供直接可用的单元/E2E 测试入口，已通过类型检查和构建覆盖静态验证部分。
- [x] 6.2 运行覆盖 Electron 服务端代码、preload 类型和工具元数据的 TypeScript/构建检查。
- [ ] 6.3 手工验证隐藏浏览器流程：导航到测试页面、获取元素快照、点击链接或按钮、输入文本、滚动并捕获截图。
- [ ] 6.4 手工验证对话旁浏览器视图：打开浏览器视图、输入 URL、刷新、前进、后退、拖拽分栏，并确认右侧会话能控制左侧页面。
- [ ] 6.5 手工验证截图进入对话：让 Agent 在浏览器任务中调用 `screenshot`，确认 assistant 消息显示图片附件且会话历史能持久化该附件。
- [x] 6.6 验证现有非浏览器工具仍可加载，且包含已移除工具名的旧保存工具设置仍能正确标准化。
