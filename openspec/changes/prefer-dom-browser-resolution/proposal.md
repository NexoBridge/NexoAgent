## Why

在浏览器模式下，Agent 仍然容易把“找按钮/点按钮/提交表单”误判为视觉定位任务，转而调用 `screenshot` 和多模态模型分析页面位置。这个路径慢、消耗模型调用、容易退化成坐标点击，而且绕过了浏览器运行时已经能提供的 DOM 元素引用。

用户提出的“向量化预索引”方向有价值：让页面元素在本地形成可检索的语义地图，运行时先从本地找候选元素，低置信度再交给大模型。但纯 embedding-first 方案也有明显缺点：模型包体和冷启动成本高、动态 DOM 更新复杂、跨语言/短文本相似度不稳定、容易把简单精确匹配问题做重，并且不擅长处理 enabled/visible/form context 等浏览器语义。

这个变更将方案优化为“DOM 语义融合解析器”：先用浏览器可访问性语义、属性、文本、表单上下文和最近操作状态做确定性匹配；同时使用 `all-MiniLM-L6-v2` 对元素 descriptor 和用户 query 做本地向量化，处理模糊表达、同义词和弱文本匹配；最后把规则分、词法分、MiniLM 语义分和上下文分融合成一个置信度。截图和视觉模型只作为最后兜底。

## What Changes

- 新增浏览器 DOM resolver，用于把用户意图或控件名称解析为可点击/可输入的元素候选。
- 扩展元素描述，不只返回 `name/text/bounds`，还生成规则化 descriptor：role、accessible name、labels、placeholder、title、heading context、form context、nearby text、enabled/visible 状态、最近焦点关系等。
- 为 `browser_action` 增加 `resolve` action，返回 Top K 元素候选、置信度、匹配原因和是否需要视觉兜底。
- 允许 `click` / `type` 在没有 `ref` 但有 `query` 时先走 DOM resolver；高置信度唯一命中才执行，低置信度或多候选时返回候选而不操作。
- 建立 DOM-first 工具路由策略：普通按钮、链接、输入框、菜单和表单提交必须先走 `snapshot`/`resolve`/`click ref`，不得直接截图、多模态分析或 OS 级鼠标键盘模拟。
- 引入 `all-MiniLM-L6-v2` 本地语义索引：对 descriptor text 建向量缓存，运行时对 query 向量化并参与融合排序。
- 添加 MutationObserver/导航事件触发的索引失效和增量刷新，避免 DOM 变化后引用过期。

## Capabilities

### Modified Capabilities

- `hidden-browser-agent`: 增强页面快照、元素描述、DOM resolver、`browser_action.resolve` 以及 query-based click/type 行为。
- `model-orchestration`: 强化浏览器模式下 DOM-first 的工具选择规则，并限制截图/视觉模型的使用条件。

## Impact

- 影响 `electron/server/browser-manager.ts`：需要维护 DOM descriptor/index，增加 resolve 逻辑和 query-based click/type 分发。
- 影响 `src/shared/types.ts` 和 `nexo/tools.json`：扩展 `BrowserActionRequest`、`BrowserState`/候选结果类型、工具 schema。
- 影响 `electron/server/tools/executors.ts`：把 `resolve`、`query`、`role`、`minConfidence` 等参数传给 BrowserManager。
- 影响 `electron/server/agent.ts`：系统提示词和工具描述需要强制 DOM-first，并要求视觉调用说明 DOM 路径为何不足。
- 影响本地模型依赖：需要引入或封装 `all-MiniLM-L6-v2` embedding runtime，定义模型缓存目录、首次下载/内置打包策略、离线失败降级和冷启动预热。

## Non-Goals

- 不把 MiniLM 向量相似度作为唯一点击依据；所有直接操作仍必须经过可见性、可用性、角色和歧义检查。
- 不把截图或多模态能力移除；它们仍用于图像、canvas、图表、视觉布局和用户显式截图需求。
- 不承诺跨域 iframe 内部 DOM 一定可解析；跨域受限时应返回明确原因并进入视觉兜底。
- 不做通用网页搜索、HTTP 抓取或反自动化绕过。
