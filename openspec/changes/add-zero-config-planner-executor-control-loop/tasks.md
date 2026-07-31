## 1. Settings UX

- [x] 1.1 在 Settings 中保留“大模型规划，小模型执行”开关。
- [x] 1.2 恢复“小模型执行器”下拉选择，写入 `executorProfileId`。
- [x] 1.3 下拉候选只展示已启用、非主模型、具备 chat/orchestration 能力的 profile。
- [x] 1.4 开关开启时必须选择 executor profile，否则 Settings 表单校验失败。

## 2. Runtime Resolution

- [x] 2.1 移除运行时自动 executor 猜测/排序路径。
- [x] 2.2 开关开启时严格使用 `settings.executorProfileId` 指定的 profile。
- [x] 2.3 未选择、选择主模型、profile 不存在、禁用或缺少 chat/orchestration 能力时返回配置错误。
- [x] 2.4 不再因为缺少 executor 自动回退主模型完成请求。

## 3. Control Loop

- [x] 3.1 保留任务分类、执行模式、风险等级和验证等级。
- [x] 3.2 复杂任务可由主模型生成结构化 execution brief。
- [x] 3.3 小模型执行后可提交阶段性证据，大模型可再规划、验证或接管。
- [x] 3.4 限制自动再规划/修复轮次，避免无限循环。

## 4. Validation

- [x] 4.1 运行 `npx tsc -p tsconfig.json --noEmit`。
- [x] 4.2 运行 `npx tsc -p tsconfig.electron.json --noEmit`。
- [x] 4.3 运行 `npx tsc -p tsconfig.electron.json` 刷新验证脚本所需输出。
- [x] 4.4 运行 `node scripts\verify-configured-executor-resolution.mjs`。
- [x] 4.5 运行 `node scripts\verify-planner-executor-routing.mjs`。
