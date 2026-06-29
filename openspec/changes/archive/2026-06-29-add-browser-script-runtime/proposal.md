## Why

当前 `browser_action` 已经具备 DOM-first 控件查找、CDP 点击和多步 `run` 执行能力，但它仍然主要服务于标准 DOM 控件。对于 Three.js canvas、自定义绘图层、复杂前端状态机以及需要直接调度 `BrowserView`、`webContents`、Debugger 或 Electron 能力的场景，Agent 仍然缺少一种“拿到浏览器运行时高权限入口，自己写 Electron 侧服务端 JS，并直接操控同一个浏览器会话”的能力。

现在需要新增这类能力，因为页面内 JavaScript 受限于页面上下文、跨域、前端封装和页面暴露 API，很多浏览器自动化问题并不能靠页面脚本解决；同时，调用方不希望继续被固定 action、受限 target schema 或受控包装层约束，而是希望 Agent 能对共享浏览器会话进行近乎无边界的直接编程。

同时，标准控件定位方向也需要调整。现有提案里保留了 `MiniLM` 向量语义解析思路，但当前目标不再是“向量化找元素”，而是以 `AX tree + 稳定 ref + stale 重解析` 作为标准 DOM 控件的结构化定位链路。也就是说，普通按钮、输入框、链接、菜单和表单应当优先通过可访问性树、稳定元素引用和引用失效后的重解析来完成，而不是把向量语义作为默认解析路径。这个结构化链路仍然有价值，不能被高权限脚本入口替代或削弱。

## What Changes

- 为共享浏览器新增一个高权限的 Electron 侧浏览器脚本执行入口，使 Agent 可以针对当前 `browserView` 会话编写并执行 Electron/Node 上下文中的浏览器控制脚本。
- 脚本执行入口应允许 Agent:
  - 直接访问当前共享浏览器会话对应的 `BrowserView`、`webContents`、Debugger/CDP 和相关 Electron/Node 能力
  - 自主决定如何执行页面 JS、输入事件、坐标交互、调试命令、状态读取和浏览器操作编排
  - 把脚本执行的最终结果返回给 Agent 继续推理
- 该入口执行的是 Electron 侧服务端 JS，而不是页面内 JS；因为脚本运行时直接注入实时 `browserView`、`webContents` 和 `debugger/CDP` 对象，Agent 编写的脚本应当能够直接控制 `BrowserView` 本身以及其中承载的网页。
- 该能力的目标是对 Agent 暴露近乎无边界的浏览器运行时编程表面，而不是继续把高级操作限制在固定 action 或受控 primitive 中。
- 保留现有 DOM-first + `AX tree + 稳定 ref + stale 重解析` 链路，继续用于标准按钮、输入框、链接、菜单和表单类目标定位。
- 允许 Agent 在同一浏览器任务中混合使用:
  - DOM snapshot / AX resolver / fixed actions / `run`
  - 高权限 Electron 侧浏览器脚本执行
  - 原始 CDP 输入事件与调试命令
- 脚本执行仍需要定义最基本的调用契约，例如脚本如何接收上下文、如何返回结果、如何超时和如何回传异常，但不应再以受控包装层的方式限制 Agent 可编程能力。
- **BREAKING** 系统将引入一个面向 Agent 的高权限浏览器编程入口；后续高级浏览器自动化可以直接通过该入口绕过现有固定 action 的能力边界。

## Capabilities

### New Capabilities
- `browser-script-runtime`: 在共享浏览器会话中执行 Agent 编写的高权限 Electron 侧浏览器控制脚本，并把结果返回给 Agent。

### Modified Capabilities
- `hidden-browser-agent`: 扩展共享浏览器工具契约，使其在保留现有 DOM/AX 解析和固定 action 的同时支持高权限 Electron 侧脚本执行。
- `model-orchestration`: 扩展编排器浏览器策略，使 Agent 能在需要时直接选择高权限浏览器脚本入口，同时继续保留 `AX tree + 稳定 ref + stale 重解析` 路径作为标准控件任务的优先解。

## Impact

- 影响 `electron/server/browser-manager.ts`：需要新增高权限 Electron 侧脚本执行能力、浏览器运行时对象注入、结果序列化、超时/错误处理，并与当前 `BrowserView` 生命周期集成。
- 影响 `src/shared/types.ts` 和 `nexo/tools.json`：需要为脚本执行请求、返回值、错误和运行轨迹定义共享类型与 schema。
- 影响 `electron/server/tools/executors.ts`：需要把脚本内容、参数和返回结果桥接到 BrowserManager。
- 影响 `electron/server/agent.ts`：需要更新提示词，明确 Agent 可以直接编写和调用高权限浏览器脚本。
- 影响浏览器快照与元素解析契约：需要把标准控件路径明确为 `AX tree + 稳定 ref + stale 重解析`，并移除本提案中对 `MiniLM` 向量定位的依赖表述。
- 影响浏览器安全边界与调试体验：这是一个高风险能力，意味着原有工具边界、能力约束和部分安全假设将被主动放宽。
- 影响 Electron 能力暴露方式：需要决定是直接注入原始对象，还是以尽可能接近原始对象的方式暴露可执行上下文；无论采用哪种形式，都需要支持 Agent 进行近乎无边界的浏览器运行时操控。
