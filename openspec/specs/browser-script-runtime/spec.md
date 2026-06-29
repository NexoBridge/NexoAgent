# browser-script-runtime Specification

## Purpose
TBD - created by archiving change add-browser-script-runtime. Update Purpose after archive.
## Requirements
### Requirement: 高权限 Electron 浏览器脚本执行
系统 SHALL 提供一个高权限浏览器脚本运行时，使 Agent 可以提交并执行 Electron 侧 JavaScript，以直接操控当前共享浏览器会话。

#### Scenario: 执行 Electron 侧服务端脚本
- **WHEN** Agent 使用浏览器脚本入口提交 Electron 侧服务端 JavaScript 源码
- **THEN** 系统应当在 Electron 侧为当前共享浏览器会话执行该脚本
- **AND** 该脚本应当绑定到当前对话使用的共享浏览器会话，而不是新建独立浏览器实例

#### Scenario: 直接访问实时浏览器运行时对象
- **WHEN** 系统执行浏览器脚本
- **THEN** 脚本应当可以直接访问当前会话的实时 `BrowserView`、`webContents`、原始 `debugger/CDP` 连接和相关 Electron/Node 能力
- **AND** Agent 不需要把这些对象先转成固定 action 或受控 primitive 才能使用

#### Scenario: 脚本可直接控制 BrowserView
- **WHEN** Agent 编写的脚本调用 `BrowserView` 方法，或通过注入的原始 `debugger/CDP` 发送浏览器与页面协议命令
- **THEN** 该脚本应当可以直接控制当前共享会话对应的 `BrowserView` 及其承载网页
- **AND** 系统不应强制 Agent 退回到页面内 JS 或固定 browser action wrapper 才能完成控制

#### Scenario: 无浏览器会话时按需创建
- **WHEN** Agent 调用浏览器脚本入口且当前不存在共享浏览器会话
- **THEN** 系统应当先创建共享浏览器会话
- **AND** 随后在该会话上执行脚本

### Requirement: 脚本结果与异常回传
系统 SHALL 把 Electron 侧浏览器脚本的执行结果返回给 Agent，并在失败时返回明确异常信息。

#### Scenario: 返回可序列化结果
- **WHEN** 浏览器脚本返回可序列化结果
- **THEN** 系统应当把该结果返回给 Agent
- **AND** 返回结果应当可用于后续推理或下一次工具调用

#### Scenario: 返回原生对象或不可序列化结果
- **WHEN** 浏览器脚本返回 `BrowserView`、`webContents` 或其他不可直接序列化的原生对象
- **THEN** 系统应当返回该结果的类型信息和可读表示
- **AND** 系统不得因为返回值不可序列化而静默丢失整个执行结果

#### Scenario: 脚本抛出异常
- **WHEN** 浏览器脚本执行期间抛出异常
- **THEN** 系统应当把异常消息和失败状态返回给 Agent
- **AND** Agent 应当能够基于该异常决定是否继续编写下一段脚本

### Requirement: 脚本与既有浏览器能力共用同一会话
系统 SHALL 让高权限浏览器脚本与既有 `browser_action` 固定 action、`run`、DOM resolver 和截图能力共用同一浏览器会话。

#### Scenario: 脚本后的固定 action 看到相同状态
- **WHEN** Agent 先执行高权限浏览器脚本并改变页面状态
- **THEN** 后续 `snapshot`、`resolve`、`click`、`type`、`run` 或 `screenshot` 应当看到同一会话中的更新后状态

#### Scenario: 固定 action 后的脚本看到相同状态
- **WHEN** Agent 先通过固定 action、`run` 或 DOM resolver 操作共享浏览器
- **THEN** 后续高权限浏览器脚本应当可以读取并继续操控同一会话状态

### Requirement: 脚本执行控制
系统 SHALL 为高权限浏览器脚本定义最基本的执行控制契约，以避免脚本永久阻塞浏览器运行时。

#### Scenario: 脚本超时
- **WHEN** Agent 为浏览器脚本指定超时时间或系统使用默认超时
- **THEN** 系统应当在超时后终止本次脚本执行并返回超时错误

#### Scenario: 脚本参与浏览器动作队列
- **WHEN** 高权限浏览器脚本与其他浏览器动作在同一会话中连续调用
- **THEN** 系统应当保持与既有浏览器动作一致的队列语义
- **AND** 系统不得因为并发脚本执行破坏共享浏览器会话的一致性

