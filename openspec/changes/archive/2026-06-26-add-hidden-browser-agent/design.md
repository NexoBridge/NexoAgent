## 背景

Nexo Agent 目前运行在 Electron 主进程中，内置工具在 `nexo/tools.json` 中声明，执行器在 `electron/server/tools/executors.ts` 中接线。现有运行时保持精简，核心仍是 shell、模型调用、记忆和知识检索。

这次需求需要一个交互式浏览器会话。它要能加载真实 Web 应用、保留 Cookie、读取当前页面，并通过可见页面控件执行用户请求的操作。同时，用户希望在同一屏幕里看到页面和对话，所以浏览器能力不能只是一个独立工具页，而要嵌入对话体验中。

Electron 已经提供 Chromium Web 运行时，因此第一版应优先复用 Electron 原生能力，而不是引入 Playwright 或其他额外浏览器依赖。

## 目标 / 非目标

**目标：**
- 提供一个 Electron 浏览器运行时，Agent 可以通过 `browser_action` 进行导航和操作，默认支持隐藏运行。
- 提供一个对话旁浏览器视图，左侧显示页面，右侧直接复用现有会话组件。
- 共享浏览器会话 partition，使隐藏工具调用和可见视图共享 Cookie 与登录状态。
- 返回对语言模型有用的紧凑页面快照，包括 URL、标题、可见文本、导航状态以及稳定的交互元素引用。
- 支持核心交互：导航、快照、点击、输入、滚动、截图、刷新、前进和后退。
- 通过安全的 Electron webPreferences 隔离外部 Web 内容。
- 将截图作为 assistant 消息附件返回到对话中。

**非目标：**
- 构建完整的 Playwright 兼容自动化框架。
- 解决反机器人检测、验证码或受限金融网站等高风险站点。
- 提供通用 Web 搜索或 HTTP 请求工具。
- 在没有用户明确意图时自动输入凭据。
- 第一版不需要多标签页、书签、下载管理或完整浏览器设置页。

## 决策

### 共享浏览器会话

创建一个 `BrowserManager` 模块，负责懒加载和复用浏览器会话。隐藏自动化模式可以使用 `show: false` 的 `BrowserWindow`；对话旁浏览器视图使用可嵌入主窗口布局的 Electron Web 内容承载方式，例如 `BrowserView` 或新版本 Electron 的 `WebContentsView`，让左侧页面和右侧 React 会话组件共存。

两种模式应使用同一个持久化 partition，例如 `partition: "persist:agent-browser"`。这样用户在可见视图里登录后，Agent 的隐藏 `browser_action` 可以继续读取和操作同一站点状态；Agent 在隐藏模式导航后的状态也能在打开视图时恢复或显示。

### 单一 `browser_action`

工具注册表只暴露一个浏览器工具：

```json
{
  "name": "browser_action",
  "parameters": {
    "action": "snapshot | navigate | click | type | scroll | screenshot | refresh | back | forward",
    "url": "用于 navigate",
    "ref": "用于 click/type",
    "text": "用于 type",
    "submit": "用于 type 的可选提交",
    "direction": "用于 scroll: up | down | left | right",
    "amount": "用于 scroll 的可选像素距离"
  }
}
```

执行器根据 `action` 分发到 `BrowserManager`，并统一返回结构化结果或错误。这样工具面更小，模型更容易理解，也避免重新引入已移除的分散工具。

### 紧凑快照

`snapshot` 应返回：
- `url`
- `title`
- `canGoBack`
- `canGoForward`
- `text`
- `elements`
- `warning` / `error`

`elements` 中的引用在每次快照时重新生成，并存储在管理器中作为引用到选择器/路径元数据的映射。点击和输入基于最新映射执行。如果引用失效，工具应返回清晰错误，引导 Agent 重新调用 `snapshot`。

`screenshot` 不应把图片数据塞进普通文本响应，而应返回托管 artifact。运行时再把该 artifact 作为 assistant 消息附件传给对话层。

### 对话旁浏览器视图

在主应用导航或菜单中添加浏览器入口。打开后进入浏览器视图：
- 顶部是地址栏和最少量导航控件。
- 浏览器左侧显示轻量历史记录。
- 中间显示真实 Web 页面。
- 右侧显示会话历史栏，并直接复用现有聊天组件。
- 浏览器和会话之间的分栏可拖拽，偏好持久化。
- 浏览器和会话之间提供竖排占位控制条，支持网页缩放、重置缩放，语义类似 `Ctrl + 鼠标滚轮`。

右侧发送消息时，任务仍路由给现有 Agent runtime，并让 Agent 使用同一浏览器会话的 `browser_action` 控制左侧页面。

外部页面不应直接运行在 React DOM 的 iframe 中作为首选方案。Electron 原生 Web 内容承载层更适合隔离权限、复用 partition、处理导航事件并支持前进/后退/刷新。

### IPC 与状态同步

主进程向渲染进程暴露受限的桌面 API：
- 获取当前浏览器状态
- 导航到 URL
- 刷新、前进、后退
- 更新浏览器内容区域 bounds
- 订阅浏览器状态变化

React 组件负责绘制地址栏、导航按钮、对话组件和拖拽分栏；Electron 主进程负责真实的 Web 内容生命周期和 bounds。窗口 resize、分栏 resize、侧边栏切换等布局变化后，渲染进程应通知主进程更新 Web 内容 bounds。

### 默认启用但保持边界清晰

`browser_action` 属于内置目录，并在包含安全约束的前提下默认启用。现有精简工具集规范需要更新，以明确允许这个专用浏览器工具，同时继续拒绝已移除的通用工具。

工具描述和系统提示必须强调：
- 仅在交互式浏览、页面检查或操作 Web 应用时使用。
- 不用于通用 HTTP 请求、搜索、爬虫或文件访问。
- 敏感操作和凭据输入需要明确用户意图。
- 截图在需要视觉确认时进入对话附件。

## 风险 / 缓解

- 隐藏浏览器自动化可能在 SPA 或慢页面上挂起 -> 集中管理导航等待和超时，并返回最好可用快照加警告。
- 可见视图和隐藏工具争用同一会话 -> 由 `BrowserManager` 串行化关键操作，并向 UI 推送状态变化。
- 某些网站会阻止 Electron 或自动化行为 -> 清晰报告屏蔽情况，避免承诺通用站点支持。
- DOM 生成的元素引用在页面更新后可能失效 -> 每次快照时重新生成引用，返回明确的失效引用错误。
- 已登录会话可能触及敏感数据 -> 使用专用持久化 partition，外部页面沙箱化，并在工具描述中要求明确用户意图。
- 截图文本可能超出模型上下文限制 -> 仅在 `screenshot` 请求时保存截图，并以显式附件返回，而不是嵌入常规文本。
- Web 内容嵌入主窗口会增加布局复杂度 -> 将 bounds 计算集中在工作台容器中，使用稳定的 resize observer/IPC 同步。

## 迁移计划

1. 在现有工具注册表背后添加浏览器管理器和 `browser_action` 执行器。
2. 将 `browser_action` 元数据添加到 `nexo/tools.json`，并提升工具设置迁移版本。
3. 更新 Agent 提示词引导和工具描述，说明何时使用 `browser_action` 以及何时返回截图附件。
4. 增加对话旁浏览器视图、地址栏控件、真实页面承载层、右侧会话复用和分栏。
5. 增加主进程和渲染进程 IPC，使视图和共享浏览器会话保持 URL、标题、导航状态和 bounds 同步。
6. 验证现有非浏览器工具仍能正常加载，且包含旧工具名的保存设置仍能正确标准化。
7. 如需回滚，从 `nexo/tools.json` 中移除 `browser_action`，隐藏浏览器视图入口，并保留专用 partition 数据以便后续复用。

## 待确认问题

- 截图文件应存储在现有 uploads/artifacts 区域下，还是新建专用 browser artifacts 目录？
- 可见视图是否需要手动清空浏览器 Cookie，还是仅依赖持久化 partition？
- 右侧会话是否复用当前聊天列表，还是为浏览器视图创建独立会话类型和历史记录？
