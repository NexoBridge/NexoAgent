## Context

当前共享浏览器运行时已经支持固定 `browser_action`、DOM-first 交互和 `action="run"` 多步浏览器操作。这条路线对普通按钮、输入框、链接和表单工作流非常有效，但它仍然建立在“浏览器能力通过受控工具 schema 暴露”的前提上。

这次变更的目标不同。用户明确希望把浏览器运行时近乎无边界地暴露给 Agent，使 Agent 能直接编写 Electron 侧服务端 JS，直接操控实时 `BrowserView`、`webContents`、Debugger/CDP 和相关 Electron/Node 能力，而不是继续被固定 action、页面脚本限制或受控 primitive 包裹。

技术上的关键事实是：原生 Electron 对象本身不能作为 JSON 值直接传进模型上下文。因此“无边界暴露给 AI”的实际落点，不是把 `BrowserView` 序列化给模型，而是在 Electron 侧提供一个脚本执行环境，把这些实时对象直接注入脚本作用域，让 Agent 每次通过脚本调用时都能像拿到原始对象一样编程。这里的“服务端 JS”必须明确指向 Electron 侧运行时 JS，而不是页面内 JS，也不是拿不到浏览器对象句柄的普通后端辅助脚本。

与此同时，标准控件定位策略也需要收敛到结构化路径。此前文档里保留了 `MiniLM` 向量语义解析思路，但当前目标调整为：普通 DOM 控件默认走 `AX tree + 稳定 ref + stale 重解析`。也就是通过可访问性树抓取结构、对可交互元素分配稳定引用，并在 ref 失效时基于同一结构化信息重解析，而不是把向量语义作为标准控件的默认定位面。

## Goals / Non-Goals

**Goals:**
- 让 Agent 可以对当前共享浏览器会话执行 Electron 侧服务端 JavaScript。
- 在脚本作用域中直接提供实时 `BrowserView`、`webContents`、Debugger/CDP 和相关 Electron/Node 能力。
- 让 Agent 可以通过注入的 `BrowserView`、`webContents` 和原始 `debugger/CDP` 能力直接控制 BrowserView 及其承载网页。
- 让脚本执行结果、异常和超时状态都能回传给 Agent。
- 保留现有 DOM-first + `AX tree + 稳定 ref + stale 重解析` 路径，并允许同一会话混合使用固定 action、`run` 和高权限脚本。
- 在不削弱能力边界的前提下，仅保留最基本的执行控制，例如队列、超时和错误回传。

**Non-Goals:**
- 不把页面内 JavaScript 执行当作主要解决方案。
- 不移除现有 `browser_action` 固定 action、`run` 或 DOM resolver。
- 不把这次变更设计成严格受控的白名单 primitive API。
- 不把 `MiniLM` 向量定位继续作为标准控件默认解析路径或本次高权限入口的依赖前提。
- 不承诺从一开始就解决所有脚本安全和隔离风险；这次变更本身就是主动放宽原有边界。

## Decisions

### 1. 继续使用单一 `browser_action` 工具，并新增高权限脚本动作

保留单一浏览器工具的外部形态，新增一个高权限脚本动作，例如 `action: "script"`。这样可以复用现有浏览器会话、动作队列、日志和对话绑定关系，而不是再引入一个完全独立的新工具。

备选方案：
- 新增独立工具，例如 `browser_runtime_script`
  - 优点：语义上更干净
  - 缺点：会打破现有“单一浏览器工具”模型，并增加编排复杂度

选择理由：
- 用户要的是能力边界放开，而不是工具数量增加
- 复用 `browser_action` 更容易共享当前浏览器会话和上下文

### 2. 使用 Electron 侧服务端 `AsyncFunction` 脚本执行模型，并直接注入实时对象

高权限脚本将在 Electron 侧通过 `AsyncFunction` 或等价机制执行。执行环境直接注入实时 `browserView`、`webContents`、原始 `webContents.debugger` / CDP 句柄、`browserManager`、`electron` 模块、`require`、`Buffer`、计时器和 `console` 等运行时对象。这样 Agent 写的脚本不是在网页里跑，而是在 Electron 侧服务端运行时里直接编程。

备选方案：
- 页面内 `executeJavaScript`
  - 缺点：受页面上下文和跨域限制，无法满足目标
- 基于 `vm` 的沙箱环境
  - 缺点：与“无边界暴露给 AI”目标相冲突
- 仅暴露白名单 helper
  - 缺点：仍然属于受控 primitive，不符合用户诉求

选择理由：
- 这是最接近“把原始浏览器运行时交给 Agent 编程”的实现方式
- Agent 可以直接调 `BrowserView` / `webContents` / `CDP`，而不是等待工具层补能力

### 3. 把原始 CDP 作为 Agent 可直接编程的第一等控制面

高权限脚本不应只暴露“帮我点击”“帮我输入”这类包装后能力，而应允许 Agent 直接通过注入的 `debugger/CDP` 发送原始协议命令控制网页。这意味着 canvas、坐标交互、自定义渲染层、调试态检查、Runtime/Page/Input/DOM 等浏览器协议能力都应当由 Agent 自己编排。

备选方案：
- 仅保留固定 `click` / `type` / `scroll` / `run` 等受控动作
  - 缺点：仍然把高权限任务压回固定工具边界
- 只暴露一个有限 helper，例如 `sendCdpCommand`
  - 缺点：如果 helper 本身重新对白名单、参数或目标做限制，仍然偏离“近乎无边界”的目标

选择理由：
- 用户明确要的是“把 CDP 交给 AI 自己去控制网页”
- BrowserView 级交互、canvas 拖拽和运行时调试场景往往天然需要原始协议能力

### 4. 保留最小执行控制：动作队列、超时、错误回传

虽然能力边界放开，但仍保留三类最基本的运行时控制：
- 与现有浏览器动作共用同一 action queue
- 每次脚本执行支持默认超时和可选显式超时
- 异常必须回传给 Agent

不做更强限制，例如禁止访问某些对象、限制调用深度或白名单方法。

备选方案：
- 完全不做超时与队列控制
  - 风险：脚本可永久阻塞浏览器运行时
- 做强限制沙箱
  - 风险：违背变更目标

选择理由：
- 这些控制属于运行时稳定性底线，而不是能力限制

### 5. 返回值采用“先序列化，失败则可读化”的结果策略

脚本执行结束后，优先返回 JSON 可序列化结果。如果返回值包含原生 Electron 对象、循环引用或不可序列化结构，则降级为类型信息和可读表示，例如 `util.inspect` 风格摘要。

备选方案：
- 强制脚本只能返回 JSON
  - 缺点：会让高权限脚本使用体验退化
- 对不可序列化返回值直接报错
  - 缺点：对调试和探索式脚本体验很差

选择理由：
- Agent 需要看到尽可能多的执行反馈，哪怕不是严格 JSON

### 6. 现有 DOM + AX tree + 稳定 ref + stale 重解析保持原样，作为标准控件默认路线

尽管新增了高权限入口，普通 DOM 控件任务仍保留现有 DOM-first + `AX tree + 稳定 ref + stale 重解析` 作为默认方案。编排器只在显式需要高权限浏览器编程、结构化路径不足或用户明确要求时使用脚本动作。

备选方案：
- 让脚本动作取代 `run`
  - 缺点：普通页面任务会失去更稳定、更容易回归测试的结构化路径

选择理由：
- 用户要求的是增加高权限入口，不是抛弃现有稳定能力
- `AX tree + 稳定 ref + stale 重解析` 对标准控件仍然比任意脚本或向量语义更可预测、更容易校验

## Risks / Trade-offs

- [任意代码执行风险] → 这是能力目标本身的一部分；仅通过动作队列、超时、错误回传和日志降低运行时失控概率。
- [共享浏览器会话可能被脚本破坏] → 保持单会话设计，但要求脚本动作与固定 action 共用同一状态观测链路，便于后续 `snapshot` 检查结果。
- [Debugger/CDP 状态可能被脚本污染] → 在运行时层记录 attach/detach 状态，并在脚本结束后尽量恢复到可继续使用的状态。
- [返回值不可序列化] → 采用“先序列化，失败则可读化”的结果策略，避免整次调用只因为返回值形态失败。
- [AX tree 对 canvas/自定义渲染层覆盖有限] → 这是预期 trade-off；标准控件走 AX/ref 路线，canvas 和运行时调试任务走高权限脚本与原始 CDP 路线。
- [Agent 过度依赖脚本动作] → 在编排器提示词中继续保留 DOM-first 默认路线，避免普通控件任务被不必要地脚本化。

## Migration Plan

1. 扩展 `browser_action` schema，新增高权限脚本动作及其参数。
2. 在 `BrowserManager` 中实现脚本执行入口，把实时浏览器运行时对象注入脚本上下文，并确保脚本直接获得 `BrowserView` / `webContents` / 原始 `debugger/CDP`。
3. 增加脚本结果序列化、异常回传和超时处理。
4. 更新浏览器快照与元素解析文档，把标准控件路径统一为 `AX tree + 稳定 ref + stale 重解析`，并移除本变更中的 `MiniLM` 依赖表述。
5. 更新编排器提示词和浏览器文档，明确普通 DOM 任务与高权限脚本任务的分流策略。
6. 增加验证：脚本读取 `webContents` 状态、脚本直接调用 `BrowserView` 方法、脚本执行页面 JS、脚本驱动原始 CDP/canvas，以及现有 AX/ref resolver 不回退。

回滚策略：
- 从 `browser_action` schema 中移除高权限脚本动作
- 保留现有固定 action、`run` 和 DOM resolver 路径
- 不需要迁移持久化数据，因为该能力主要影响运行时而非数据模型

## Open Questions

- 是否直接注入 `require` 和完整 `electron` 模块，还是只注入运行时已加载的对象引用？
- 是否允许脚本跨调用持久化状态或对象句柄，还是每次重新注入实时对象？
- 脚本源码和返回值应在日志中保留到什么程度，才能同时满足调试与隐私控制？
- 如果脚本主动修改 `webContents.debugger` 状态，运行时是否需要在脚本结束后做强制恢复？
- 在脚本上下文中，是直接暴露原始 debugger 对象，还是同时补充一个不额外设限的便捷 `sendCommand` 引用以降低调用摩擦？
