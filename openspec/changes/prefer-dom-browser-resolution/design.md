## Background

当前 `browser_action.snapshot` 已经能返回可交互元素列表和 ref，但 Agent 在浏览器模式下仍会偏向截图/多模态。单纯继续加提示词只能缓解，不能从能力层面改变路径。需要把“根据用户意图找到 DOM 元素”变成浏览器工具的一等能力，让模型可以直接请求“解析发送按钮”，而不是自己在截图里找坐标。

用户提出的 `all-MiniLM-L6-v2` 向量化预索引方案应作为正式语义层，而不是纯可选能力。它对“帮我点那个确认一下的按钮”“找一下比较合适的选项”“继续下一步”这类模糊表达很有帮助。关键是不要让向量分单独决定点击，而是和 DOM 规则、可见性、可用性、角色、上下文一起融合评分。

## Optimized Approach

### 1. DOM Descriptor Layer

每次 snapshot 或 DOM index 刷新时，为候选元素生成 descriptor。候选元素包括：

- 可交互元素：`button`、`a`、`input`、`textarea`、`select`、`summary`
- ARIA 控件：`[role=button]`、`[role=link]`、`[role=menuitem]`、`[role=checkbox]`、`[role=radio]`
- 可聚焦/可编辑元素：`[tabindex]`、`[contenteditable=true]`
- 可能作为标签或上下文的文本节点：`label`、`h1-h6`、附近短文本、表单标题

descriptor 应包含：

- stable ref 和 selector
- tag、role、type、enabled、visible、editable
- accessible name：`aria-label`、`aria-labelledby`、`label[for]`、`title`、`alt`、`placeholder`、text
- context：最近 heading、所属 form/dialog/toolbar、附近 label、最近焦点或刚输入字段
- bounds 和 z-index/visibility 相关信息
- normalized text：小写、空白归一、符号清理、中英文同义词展开

描述文本仍然使用规则生成，不调用 AI。示例：

```text
发送 | button | toolbar | compose mail | enabled | top
收件人 | input | email | label: 收件人 | compose mail
```

### 2. Deterministic Resolver

新增本地 resolver，根据 query 和可选 role/action hint 返回候选元素：

```json
{
  "action": "resolve",
  "query": "发送按钮",
  "role": "button",
  "limit": 5
}
```

评分由多路信号组成：

- exact accessible-name/text match
- contains / fuzzy edit-distance match
- role/action match，例如 `发送/提交/send/submit` 强 boost `button`、`input[type=submit]`
- form/dialog/toolbar context，例如刚在正文输入后，邮件 compose toolbar 的 `发送` 获得 boost
- visible/enabled/in-viewport boost，disabled/hidden penalty
- recent focus context boost
- spatial hint：顶部、底部、左侧、右侧等用户描述

返回：

```json
{
  "ok": true,
  "query": "发送按钮",
  "candidates": [
    {
      "ref": "e6",
      "confidence": 0.94,
      "role": "button",
      "name": "发送",
      "text": "发送",
      "bounds": { "x": 24, "y": 16, "width": 64, "height": 32 },
      "reasons": ["exact-name", "role-button", "compose-toolbar", "enabled"]
    }
  ],
  "needsVisionFallback": false
}
```

### 3. Query-Based Click/Type

`click` 和 `type` 继续优先使用 ref。为了减少模型负担，可允许：

```json
{ "action": "click", "query": "发送按钮", "minConfidence": 0.86 }
```

行为规则：

- 如果 resolver 返回唯一候选且置信度 >= `minConfidence`，执行 click/type。
- 如果候选低置信度或多个接近候选，返回 `needs_disambiguation` 和 Top K，不执行。
- 如果目标可能是敏感或破坏性操作，仍遵守现有确认策略。

### 4. Local MiniLM Semantic Index

使用 `all-MiniLM-L6-v2` 作为本地语义索引模型。它不生成 descriptor，也不直接操作页面，只负责把规则生成的 descriptor text 和用户 query 投影到同一个向量空间。

实现上可以封装一个本地 embedding service，例如基于 Transformers.js 的 `Xenova/all-MiniLM-L6-v2` feature-extraction pipeline。BrowserManager 只调用该服务的 `embed(texts)` 接口，不把模型加载、缓存和降级逻辑散落到 DOM 抽取脚本或 Agent 编排层。

索引策略：

- 仅向量化元素 descriptor text，不向量化完整页面正文，避免噪声和隐私面扩大。
- descriptor text 使用规则生成，例如 `发送 | button | toolbar | compose mail | enabled | top`。
- 使用 mean pooling + normalize，保存 384 维向量。
- 按 descriptor text hash 缓存向量；DOM mutation 只刷新变更 descriptor。
- query 每次运行时向量化，取语义 Top K 后与规则/词法候选做 union。

融合评分：

```text
finalScore =
  semanticScore * 0.40 +
  lexicalScore  * 0.25 +
  roleScore     * 0.15 +
  contextScore  * 0.15 +
  stateScore    * 0.05
```

权重是初始建议，应通过测试校准。直接 click/type 仍需要满足：

- finalScore 达到 `minConfidence`
- Top 1 与 Top 2 分差达到歧义阈值
- 候选 visible、enabled，且 role/editable 与动作兼容
- 敏感或破坏性动作仍遵守确认策略

冷启动策略：

- 浏览器模式打开后后台预热 MiniLM。
- 如果模型尚未就绪，resolver 先使用规则+词法路径，并在结果中标记 `semanticReady: false`。
- 对模糊 query，如果规则路径低置信度且 MiniLM 正在加载，可以短暂等待一个小窗口；超时后返回候选和 `semanticPending`，不直接截图。
- 模型缓存目录和离线策略必须明确：优先使用本地缓存；若首次下载失败，降级到规则+词法并提示 capability degraded。

这样保留 MiniLM 对模糊语义的收益，同时避免 embedding-only 带来的误点、冷启动卡顿和动态 DOM 维护风险。

### 5. Vision Fallback Gate

截图/视觉模型只在以下情况使用：

- 用户明确要求截图、视觉检查、比较页面外观、识别图片/图表/canvas。
- DOM resolver 返回低置信度，并且无法通过 scroll/snapshot/resolve 得到可靠候选。
- 目标本身不是 DOM 控件，例如 canvas 绘制按钮、图片中的文字、复杂地图/图表。

Agent 在调用视觉前应能说明 DOM 路径为何不足。运行时可以先只通过提示词约束；后续如仍频繁误用，再增加 tool-call guard 记录或拒绝明显的 DOM 控件视觉定位。

## Risks and Mitigations

- **误点风险**：query-based click 必须有置信度阈值和歧义返回，不应低置信度直接操作。
- **动态 DOM 过期**：导航、输入、点击、MutationObserver 都应标记 index dirty，resolve 前按需刷新。
- **跨域 iframe**：同源 iframe 可递归采集，跨域 iframe 返回 frame descriptor 和限制原因，必要时视觉兜底。
- **模型依赖膨胀**：MiniLM 是正式语义层，但必须支持后台预热、缓存、离线降级和规则路径兜底，不能阻塞基础 DOM resolver。
- **提示词回退到截图**：在 orchestrator prompt 和工具描述中明确 DOM-first，并把 screenshot/vision 限定为视觉任务或 resolver 失败后的兜底。
