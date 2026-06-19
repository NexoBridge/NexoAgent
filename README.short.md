# Nexo Agent

Nexo Agent 是一个本地优先的 AI Agent 工作台，支持桌面端和浏览器端访问。它把聊天、工具调用、记忆、知识库、技能和定时任务放在同一个界面里，适合用来构建个人或团队内部的 Agent 助手。

## 亮点

- Electron + React + TypeScript + Ant Design 构建。
- 支持 OpenAI-compatible 模型服务。
- 基于 LangChain 执行工具调用。
- 支持多会话、流式输出和 Markdown 渲染。
- 内置搜索、HTTP 请求、计算器、文件读写、终端命令、记忆召回等工具。
- 记忆系统支持每日记忆、梦境记忆、长期记忆和脚本记忆。
- 使用 SQLite 管理本地记忆数据，并支持 embedding 语义召回。
- 支持本地 Markdown 知识库。
- 支持技能加载、创建、搜索和安装。
- 支持 5 字段 Cron 定时任务。

## 快速启动

```bash
npm install
npm run dev:electron
```

仅启动 Web 前端：

```bash
npm run dev:web
```

常用地址：

```text
http://localhost:8106
```

## 常用命令

```bash
npm run typecheck
npm run build
npm run package
```

## 目录概览

```text
electron/          Electron 主进程、本地服务、Agent、工具、记忆
src/               React 前端界面
nexo/              内置工具和技能配置
docs/              项目文档
openspec/          OpenSpec 变更与规格
.nexo-data/        本地运行数据
```

## 适用场景

- 本地 AI 助手
- 内部 Agent 控制台
- 带工具调用的模型实验平台
- 个人知识库和长期记忆管理
- 自动化任务和脚本辅助工作台

## 技术栈

Electron、React、TypeScript、Vite、Ant Design、Zustand、Express、LangChain、SQLite/sql.js、Chroma、OpenAI-compatible API。
