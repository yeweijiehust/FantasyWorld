# FantasyWorld 完整实现路线图

## Summary

从当前 `codex/mvp-prototype`
的可运行原型出发，后续按可提交、可测试、可回滚的小步推进。每个 Step 默认独立分支或独立 commit/PR，完成后运行对应测试；只有前置 Step 通过后再进入下一步。

Render 部署由用户手动完成，项目实现侧只负责准备配置、文档和明确提醒。Step
13 不是代理执行任务；到达该步骤时代理只提醒用户按清单手动部署，不登录 Render、不触发生产部署。执行到 Step
13 时，代理必须停在提醒和核对清单，不继续代替用户完成部署动作。

## Step 1：发布当前 MVP 原型基线

- 将 `codex/mvp-prototype` push 到 GitHub，创建 Draft PR。
- 确认 GitHub Actions `ci.yml`、`security.yml` 能在远端跑通。
- 在 GitHub 设置 branch protection：`main` 禁止直接 push，要求 PR + required checks。
- 验收：
  - PR 存在。
  - CI/security 通过或失败原因明确。
  - 当前原型仍可本地运行：`pnpm dev`。

## Step 2：Postgres 持久化替换内存 Store

- 实现 Drizzle repository，替换 `PrototypeStore` 作为默认运行时存储。
- 存档、角色、地点、关系、回合、任务、模型配置写入 Postgres。
- 保留内存/mock store 只用于快速单测或 fixture。
- 回滚改为基于回合 snapshot，不依赖进程内存。
- 验收：
  - 重启 API 后存档仍存在。
  - `pnpm db:migrate` 可创建表。
  - API 测试覆盖 create/list/get/update/rollback/import/export。
  - `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 通过。

## Step 3：认证与密钥安全落地

- 管理员密码只接受 `ADMIN_PASSWORD_HASH`，生产环境禁止 fallback 明文密码。
- 模型 API key 使用 `ENCRYPTION_KEY` 加密后存 Postgres。
- 前端只显示 `hasApiKey` 和尾号，不返回完整 key。
- 启动时校验关键 env，生产缺失则失败。
- README 补充 `pnpm auth:hash`、Render env、`ENCRYPTION_KEY` 备份说明。
- 验收：
  - 错误密码、未登录、登出后访问 API 均返回正确错误。
  - API key 不出现在响应、日志、导出 JSON。
  - security workflow 不误报真实密钥。

## Step 4：真实 LLM Service 边界

- 新建 OpenAI-compatible LLM service，支持 `baseUrl`、`apiKey`、`model`。
- 所有 LLM 调用都通过统一接口，支持 mock provider。
- 增加模型连接/能力探测：JSON mode、usage、stream 支持。
- 真实调用失败时返回稳定错误，不写入正式世界状态。
- 验收：
  - mock provider 单测稳定。
  - 配置错误 API key 时 UI 能显示失败。
  - 不需要真实 key 也能跑 CI。

## Step 5：创建世界向导升级

- 增加 3-5 个内置世界模板 fixture。
- 创建流程拆成：模板选择、世界设定、角色种子、内容边界、语言、模型覆盖、草稿预览。
- 初始世界由 LLM/mock LLM 生成结构化草稿，用户编辑确认后才创建正式存档。
- Step 5 的模型覆盖先作为创建草稿输入保留；存档级模型覆盖的持久化与后续回合编排一起完善。
- 验收：
  - 中文存档生成中文内容，英文存档生成英文内容。
  - 角色数量限制 3-8。
  - 草稿未接受前不会出现在正式存档列表。

## Step 6：任务系统与 SSE 真正落地

- 创建存档和推进回合都写入 job table。
- job 状态支持 `queued/running/needs_review/failed/cancelled/accepted`。
- SSE 持续推送 job 状态、阶段、错误和最终草稿。
- 实现 cancel、retry、idempotency key。
- 同一存档同一时间只允许一个 active turn job。
- 验收：
  - 刷新页面后能恢复 job 状态。
  - 重复提交不会重复创建回合。
  - SSE 中断后前端能重新查询最终状态。

## Step 7：回合推演编排 v1

- 实现世界裁判流程：选择本回合焦点角色、地点、冲突和 GM 指令。
- 按需生成角色意图、行动、必要对话。
- 统一结算事件、状态变更、记忆更新、关系变化。
- LLM 输出必须通过 TypeBox schema 校验，失败有限重试。
- 验收：
  - 每回合至少有事件、状态变更、调用摘要。
  - GM 指令会影响结果。
  - 角色后续行动会参考目标、私有记忆、秘密、地点和关系。

## Step 8：回合草稿修正闭环

- 回合生成后先进入草稿态。
- UI 支持编辑事件文本、状态变更、角色目标、角色记忆、关系变化。
- 用户接受后才写入正式世界状态。
- 拒绝/重试不会污染正式存档。
- 实现采用 `TurnJob.draftState` 保存待应用世界变更，`PATCH /api/turn-jobs/:id/draft`
  修改草稿，`POST /api/turns/:id/accept` 才把草稿写入正式 save 和 turn row。
- 验收：
  - 编辑后的回合结果会影响后续回合。
  - 回滚能恢复接受前的 snapshot。
  - API 测试覆盖 accept、patch draft、rollback。

## Step 9：完整世界编辑器

- 右侧详情区扩展为可编辑面板。
- 支持编辑角色、地点、关系、秘密、状态、长期目标、短期目标、私有记忆、世界摘要、内容边界、随机性。
- 支持新增/删除角色、地点、关系。
- 所有编辑通过 shared schema 校验。
- 实现侧新增角色、地点、关系 CRUD API；右侧详情区通过 shared schema 校验后写入正式 save。
- 验收：
  - 编辑后刷新页面仍保留。
  - 下一回合使用编辑后的状态。
  - 非法字段或空关键字段返回稳定错误。

## Step 10：导入导出与版本兼容

- 导出完整可玩存档 JSON，但不包含 API key。
- 导入时校验 `schemaVersion`。
- 支持当前版本导入；未知版本明确拒绝。
- 为旧版本预留迁移器接口。
- 实现侧导出 `{ schemaVersion, exportedAt, save }` 包；导入兼容当前包与裸 save，并由 API 统一处理版本拒绝和迁移预留。
- 验收：
  - 导出后导入能继续推进回合。
  - 损坏 JSON、未知版本、缺字段都有明确错误。
  - E2E 覆盖导出再导入的基础流程。

## Step 11：UI/i18n 与移动体验补齐

- 接入 `react-i18next`，UI 支持中英切换。
- 存档生成语言与 UI 语言分离。
- 桌面保持三栏工作台；移动端改为列表 + 时间线 + 详情抽屉。
- 增加加载、错误、空状态和长文本溢出处理。
- 验收：
  - 桌面/移动 Playwright 均通过。
  - 中文 UI 和英文 UI 都可完成核心流程。
  - 关键页面无明显遮挡或溢出。

## Step 12：测试矩阵扩展

- 补 API 边界测试：未登录、错误 body、404、并发 job、idempotency、LLM 失败。
- 补 repository 测试：事务失败、rollback snapshot、一致性恢复。
- 补前端组件测试：创建向导、模型配置、工作台编辑。
- E2E 覆盖：登录、配置模型、创建、推进、修正、接受、回滚、导入导出。
- 验收：
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm test`
  - `pnpm build`
  - `pnpm test:e2e`

## Step 13：部署准备与手动部署提醒

- Step 13 不由 AI/代理执行部署，只作为手动部署提醒和发布前核对清单。
- Step 13 不是实现任务，也不是自动推进任务；执行到这里时必须提醒用户手动部署，然后等待用户确认。
- 实现侧只准备部署所需文件和文档，不登录 Render、不触发生产部署、不代填生产环境变量。
- 即使前 12 步全部完成，AI/代理也只给出手动部署提醒；是否连接 Render、填写生产 env、触发首个生产部署，由用户确认并执行。
- 到达 Step 13 时，AI/代理的唯一动作是提醒用户手动部署并逐项核对清单，然后等待用户完成。
- 确认 `render.yaml`、Drizzle migration、README 部署说明、环境变量说明完整。
- 在准备好合并/发布时提醒用户手动完成：
  - 连接 GitHub 仓库到 Render Blueprint。
  - 创建或确认 Render Postgres。
  - 设置 `SESSION_SECRET`、`ENCRYPTION_KEY`、`ADMIN_PASSWORD_HASH`。
  - 触发部署并检查 `/api/health`。
- 验收：
  - 仓库内配置足够支撑用户手动部署。
  - 明确提醒用户执行 Render 手动部署步骤。
  - 不由 AI/代理保存、输入或提交任何生产密钥。

## Step 14：v1 验收与收尾

- 对照三份计划文档逐项打勾。
- 更新计划文档，把已实现、推迟、变更决策写清楚。
- 创建 v1 release checklist。
- 确认公开仓库没有真实密钥、真实用户存档或生产配置泄漏。
- 验收：
  - 文档与实现一致。
  - Required checks 全绿。
  - 用户能完成：配置模型、创建世界、推进多回合、GM 介入、编辑状态、接受/修正、回滚、导入导出。
  - 用户已被提醒手动完成 Render 部署和生产健康检查。

## Assumptions

- 每个 Step 默认一个可审查 PR，不把多个高风险 Step 混在一起。
- CI 默认使用 mock LLM，不把真实模型调用作为 required check。
- Postgres 是第一版正式持久层；内存 store 只保留为测试辅助。
- 真实 LLM 接入晚于持久化和密钥安全，避免先把敏感 key 流程做歪。
- Render 部署、生产环境变量输入、生产密钥管理都由用户手动完成；代理只负责提醒和核对文档。
- 完整 v1 完成前，当前原型可以继续作为可试玩 demo 保留。
