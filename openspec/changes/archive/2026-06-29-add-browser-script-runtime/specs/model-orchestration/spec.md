## ADDED Requirements

### Requirement: 编排器可使用高权限浏览器脚本入口
编排器 SHALL 在需要直接编程浏览器运行时、直接操控 `BrowserView` / `webContents` / CDP，或用户明确要求高权限浏览器脚本时，能够调用共享 `browser_action` 的高权限脚本动作。

#### Scenario: 用户明确要求原始浏览器运行时控制
- **WHEN** 用户明确要求把浏览器运行时高权限暴露给 Agent，或要求 Agent 自己写 Electron 侧服务端浏览器脚本
- **THEN** 编排器应当可以调用共享 `browser_action` 的高权限脚本动作
- **AND** 不应当强制把该请求改写回固定 action、受控 primitive 或页面内脚本

#### Scenario: 自定义渲染层任务可使用脚本动作
- **WHEN** 浏览器任务涉及 Three.js canvas、自定义绘图层、复杂前端状态机或需要直接调试浏览器运行时的场景
- **THEN** 编排器应当可以选择高权限浏览器脚本动作
- **AND** 不需要先把问题压缩成普通 DOM 控件定位任务

#### Scenario: 普通控件任务仍优先 DOM-first
- **WHEN** 用户请求点击、输入、选择或提交普通 DOM 控件
- **THEN** 编排器仍应当优先使用现有 DOM snapshot、AX tree + 稳定 ref + stale 重解析路径、固定 action 或 `run`
- **AND** 高权限脚本动作不应取代标准 DOM 控件任务的默认路径

#### Scenario: 高权限脚本与 AX/ref resolver 可混合使用
- **WHEN** 编排器先使用高权限浏览器脚本完成部分浏览器运行时操作
- **THEN** 它后续仍应当可以继续使用 `snapshot`、`resolve`、`click`、`type`、`run` 或 `screenshot`
- **AND** DOM + AX tree/ref/stale 重解析路径应当继续可用
