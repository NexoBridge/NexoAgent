## Context

Nexo Agent 前端基于 React 18 + Ant Design 5 + Vite 6。当前 `src/` 下仅有 `index.css` 一个全局样式文件，18 个组件目录中大量 JSX 使用内联 `style={{ ... }}`，并通过 `useTheme().colors` 在运行时注入颜色值。主题系统已在 `applyThemeCssVars` 中写入 `--nexo-*` CSS 变量，但组件样式并未系统性地消费这些变量。

典型问题：
- `AppLayout.tsx`、`MessageBubble.tsx`、`Settings/index.tsx` 等文件 JSX 与样式对象混杂，阅读成本高。
- 静态布局、hover、scrollbar、伪类无法优雅表达。
- 相同视觉模式（图标按钮、侧栏项、面板容器）在多个组件中重复定义 inline 对象。

## Goals / Non-Goals

**Goals:**
- 建立“按需选型”的样式分层规则，而不是一刀切全部 inline 或全部 SCSS。
- 为复杂组件引入同目录 SCSS 文件，使 JSX 聚焦结构与交互。
- 优先使用现有 `--nexo-*` CSS 变量与 Ant Design token，保证 dark/light 主题一致。
- 提供可渐进执行的迁移顺序与验收方式。

**Non-Goals:**
- 不在本变更中完成所有组件迁移。
- 不引入 CSS Modules 以外的额外样式框架。
- 不改变 UI 视觉设计或交互行为。

## Decisions

### 1. 样式分层：inline / Ant Design / SCSS 三档

| 场景 | 推荐方式 | 示例 |
|------|----------|------|
| 运行时计算的单一属性 | inline `style` | `width: sessionSiderWidth` |
| 条件激活态且依赖 React state | inline 或 `className` + 状态类 | 当前 view 高亮 |
| 稳定布局、hover、伪元素、嵌套选择器 | 组件 SCSS | 侧栏、消息气泡、设置页分组 |
| 全局 reset、scrollbar、keyframes | `src/index.css` | 现有 body/scrollbar |
| Ant Design 组件外观 | `ConfigProvider token` + 组件 props | 主色、圆角 |

**理由：** 保留 inline 处理真正动态值，避免为了 SCSS 引入大量 CSS 变量桥接；同时把重复、静态样式移出 JSX。

**备选方案：**
- 全部 CSS Modules：可行，但对简单动态样式反而增加 `className` 拼接成本。
- 继续全部 inline：维护成本已不可接受。

### 2. SCSS 文件组织：同目录 `index.scss`

约定：
```
src/components/Layout/
  AppLayout.tsx
  index.scss        # 组件级样式，AppLayout.tsx 顶部 import
```

- 使用 BEM 风格前缀：`app-layout__sider`、`app-layout__nav-item--active`。
- 根块类挂在组件最外层元素，避免全局污染。
- 暂不使用 CSS Modules，降低迁移成本；通过 BEM + 组件根类限制作用域。

**备选方案：**
- `<Component>.module.scss`：作用域更强，但当前项目无先例，首版先用普通 SCSS + BEM。

### 3. 主题变量：CSS 变量优先，SCSS 仅做别名

- 组件 SCSS 直接写 `background: var(--nexo-bg-secondary)`。
- 不在 SCSS 中硬编码 dark/light 色值。
- 若 `applyThemeCssVars` 缺少变量（如 `textSecondary`、`accent`），在本变更中补齐并文档化。

动态仍无法用 CSS 变量表达的值（如拖拽宽度）继续 inline。

### 4. 构建：添加 `sass` 依赖，沿用 Vite 内置 SCSS 支持

- 添加 `sass` 到 `devDependencies`。
- 无需修改 Vite 配置即可 `import "./index.scss"`。
- 不在此变更引入 `sass-embedded` 以外的预处理器链。

### 5. 迁移策略：按组件复杂度分批

优先级：
1. `AppLayout` — 布局壳层、导航、窗口控件
2. `ChatPanel/*` — 消息列表、输入栏、工具步骤
3. `Settings` — 表单密集、样式对象最多之一
4. 其余面板组件按 touch 频率逐步迁移

每个组件迁移原则：
- 先提取静态/重复样式到 SCSS。
- 保留依赖 state/props 计算的 inline。
- 迁移后视觉与交互应与迁移前一致（手工 smoke test）。

## Risks / Trade-offs

- **[Risk] 全局类名冲突** → 使用组件根 BEM 块前缀；禁止在 SCSS 中写无前缀的通用类名。
- **[Risk] 主题变量不完整导致 SCSS 硬编码** → 迁移前先补齐 `--nexo-*` 映射表。
- **[Risk] 大规模迁移 PR 难以 review** → 按组件拆分任务，每 PR 聚焦 1–2 个目录。
- **[Trade-off] 普通 SCSS 而非 CSS Modules** → 依赖命名纪律；后续若冲突增多可再评估 Modules。

## Migration Plan

1. 添加 `sass` 依赖与样式规范文档（spec）。
2. 补齐主题 CSS 变量。
3. 迁移 `AppLayout` 作为参考实现。
4. 迁移 `ChatPanel` 与 `Settings`。
5. 将其余组件列入 backlog，新代码默认遵循规范。

回滚：SCSS 文件可独立删除并恢复 inline，不影响运行时逻辑。

## Open Questions

- 是否在 ESLint 中加入“禁止大段 inline style 对象”的启发式规则？首版暂不引入，仅文档约定。
- 是否在后续变更引入 CSS Modules？待首个迁移批次完成后根据命名冲突情况决定。
