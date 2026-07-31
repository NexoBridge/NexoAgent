## Why

Nexo Agent 的前端组件目前几乎完全依赖 React 内联 `style` 与运行时 `colors` 对象来组织样式。随着页面与组件复杂度上升，这种写法让 JSX 变得冗长、样式难以复用，也不利于维护 hover/active、媒体查询、伪元素等常规 CSS 能力。项目已经通过 `applyThemeCssVars` 暴露了主题 CSS 变量，但组件层并未形成与之匹配的样式分层约定。

现在需要建立一套按需选型的样式规范：简单、动态、一次性的样式可以继续使用内联 `style`；稳定、可复用、结构化的样式应迁移到组件级 SCSS 文件，而不是把所有样式都堆在 JSX 里。

## What Changes

- 定义前端组件样式分层规则：何时使用内联 `style`、Ant Design token/props、全局 CSS 变量，以及何时使用组件级 `.scss` 文件。
- 引入 SCSS 构建支持（Vite 原生支持），约定每个复杂组件使用同目录 `index.scss` 或 `<ComponentName>.module.scss`。
- 将主题色、间距、圆角等稳定视觉 token 优先映射到 CSS 变量与 SCSS 变量，减少在 JSX 中重复构造样式对象。
- 按优先级逐步迁移现有高复杂度组件（如 `AppLayout`、`ChatPanel`、`Settings`）中的静态样式到 SCSS，保留真正动态的 inline style。
- 补充开发约定与验收标准，避免“全部 inline”或“为了用 SCSS 而过度拆分”两种极端。

## Capabilities

### New Capabilities

- `frontend-component-styling`: 定义 Nexo Agent Web/Electron UI 的组件样式组织规范、SCSS 文件约定、主题变量使用方式，以及 inline style 的适用边界。

### Modified Capabilities

- （无）

## Impact

- `src/components/**`: 主要迁移与样式文件新增位置。
- `src/index.css`: 保留全局 reset/scrollbar/keyframes，并与 SCSS 变量体系对齐。
- `src/theme/index.ts`: 继续负责 CSS 变量注入；可能需要补充变量命名约定文档化。
- `vite.config.ts` / `package.json`: 如需显式依赖，添加 `sass` 开发依赖。
- 开发者体验：新组件默认遵循“按需选型”，减少 JSX 噪音，提高样式可读性与可测试性。

## Non-Goals

- 不强制一次性重写全部现有组件；采用渐进式迁移。
- 不引入 CSS-in-JS 库（如 styled-components、Emotion）。
- 不修改 Ant Design 全局主题算法本身，只在现有 `ConfigProvider` 基础上补充组件级样式约定。
- 不改变产品功能行为，仅调整样式组织方式与可维护性。
