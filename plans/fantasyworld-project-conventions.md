# FantasyWorld Part 3 项目工作归约

## Summary

项目开发采用“分支开发、测试先行、PR 门禁、文档同步”的工作方式。任何代码变更都必须能被类型检查、自动化测试和人工审查追踪；不能在未验证状态下 commit 到主线或 merge。

代码风格强调清晰命名、明确类型、边界测试和少依赖。默认不写代码注释，通过类型、schema、函数拆分、测试和文档表达意图。

## Core Workflow

- Git 工作流：
  - 远程仓库使用 GitHub 公开仓库：`https://github.com/yeweijiehust/FantasyWorld.git`。
  - 本地 `origin` 指向该仓库，`main` 跟踪 `origin/main`。
  - 所有开发在分支上完成，AI/代理分支默认使用 `codex/<topic>`。
  - `main` 启用 GitHub branch protection，只接受通过 PR 的变更。
  - 禁止直接 push 到 `main`。
  - PR 通过后使用 squash merge，保持主线历史干净。
- Commit 规则：
  - 使用 Conventional Commits：`feat:`、`fix:`、`test:`、`docs:`、`chore:`、`refactor:`。
  - 每个 commit 聚焦一个可验证变更。
  - commit 前必须至少运行相关 typecheck、lint、单元/API/前端测试。
  - 如果测试无法运行，不能 commit；必须记录 blocker。
- Merge 规则：
  - PR 必须 GitHub Actions required checks 通过。
  - PR 必须包含变更摘要、测试结果、风险说明、回滚说明。
  - 建议要求 PR review 或至少所有 conversation resolved。
  - 涉及产品、技术、API、数据库、LLM 推演或工作流变化时，必须同步更新 `plans/` 文档。
  - 不允许带着已知边界错误、未解释失败测试或未审查迁移 merge。

## Code And Architecture Rules

- 注释规则：
  - 默认零注释，不写解释性代码注释。
  - 通过清晰命名、函数拆分、类型、schema、测试和文档表达意图。
  - 仅允许许可证头、生成文件标记、外部协议/安全约束这类必要例外。
- TypeScript：
  - 全仓库开启 strict。
  - 默认禁止 `any`；确需使用必须局部隔离，并由测试覆盖。
  - API、DB、LLM、导入导出等边界必须经过 TypeBox schema 或明确转换层。
- API/schema：
  - 契约先行，先改 `packages/shared` 的 TypeBox schema，再同步后端 route、前端调用和测试。
  - Fastify route 必须声明 request/response schema。
  - LLM 输出必须 schema 校验，不能从自由文本里猜状态。
- 数据库：
  - Drizzle schema 变更必须生成显式迁移文件。
  - 迁移和代码在同一 PR 审查。
  - 涉及数据变化时必须说明备份、回滚或兼容策略。
- 安全：
  - 不得提交 `.env`、真实 API key、session secret、生产 DB URL。
  - 公开仓库中不得提交真实用户存档、真实 prompt 样本、生产 Render 配置或任何可识别用户数据。
  - GitHub Actions 默认不保存真实 LLM、Render、生产数据库或生产 session/encryption 密钥。
  - Render 生产环境变量只保存在 Render 面板或 Render secret/env 配置中。
  - 日志必须脱敏，不记录完整 API key、session、敏感 prompt 或用户密钥。
  - 导出存档默认不包含解密后的模型 API key。
  - 首版不支持 `ENCRYPTION_KEY` 自动轮换；启动或配置读取时必须检测解密失败并给出明确错误。
  - 部署文档必须强调备份 `ENCRYPTION_KEY`，否则已加密的 API key 可能无法恢复。
- 仓库基础文件：
  - 实现前必须先建立 `.gitignore` 和 `.gitattributes`。
  - `.gitignore` 必须忽略 Node 依赖、真实环境变量、构建产物、缓存、测试报告、临时目录和本地 IDE/OS 文件。
  - `.gitignore` 不得误忽略 `.env.example`、`pnpm-lock.yaml`、`.github/workflows/*.yml`、`render.yaml`、Docker
    Compose、Drizzle schema 或 migrations。
  - `.gitattributes` 默认固定文本文件为 LF，Windows 脚本可显式使用 CRLF。
  - 公开仓库暂不添加 LICENSE，默认保留权利；未来决定开源授权时再单独讨论。
- 依赖：
  - 新依赖必须有明确用途，优先官方、活跃、维护良好的包。
  - 必须提交 lockfile。
  - 升级依赖要跑相关测试，并记录破坏性变化。

## Testing Requirements

- 分层门禁：
  - commit 前：运行相关 `typecheck`、`lint`、单元测试或受影响测试。
  - PR/merge 前：运行全量 typecheck、lint、unit/API tests、web build。
  - 涉及核心流程时运行 Playwright E2E。
- 必测边界：
  - Auth：未登录、过期 session、错误密码。
  - API：非法 params/query/body、schema 校验失败、稳定错误格式。
  - DB：事务失败、迁移、回滚、一致性恢复。
  - Jobs：同一存档并发创建或推进、任务取消、任务失败、SSE 中断、重试、idempotency key。
  - LLM：超时、API key 错误、坏 JSON、缺字段、schema 失败、重试后仍失败。
  - World state：回合接受、草稿编辑、回滚、导入导出、记忆一致性。
  - World versioning：当前版本导入、旧版本迁移、未知版本拒绝、snapshot 版本兼容。
  - Frontend：加载、错误、空状态、表单校验、关键交互、桌面/移动布局、长文本溢出。
- LLM 测试：
  - 自动化测试默认使用 mock/fake provider 和固定 fixtures。
  - 真实模型调用只作为手动或标记的 live smoke test，不作为普通 CI 的必要条件。
- 前端视觉验收：
  - 主工作台、创建向导、模型配置页必须在桌面和移动视口做 Playwright 截图或布局检查。
  - 检查重点包括无重叠、无明显溢出、加载状态、错误状态和空状态可用。
- CI：
  - `.github/workflows/ci.yml` 是 required check，PR 必跑 install、typecheck、lint、unit/API tests、web build。
  - `ci.yml` 使用 GitHub Actions Postgres service container 跑迁移和 API/DB 测试。
  - `ci.yml` 必须运行 `pnpm check:render`，防止 Render 生产启动路径、静态资源路径或免费层不支持的命令再次漂移。
  - `.github/workflows/security.yml` 检查依赖、lockfile 和公开仓库密钥泄漏风险。
  - GitHub 仓库应启用 secret scanning、push protection、dependency review 和 branch protection。
  - E2E 可先用于关键路径、发布前或高风险 PR。
  - `.github/workflows/e2e.yml` 默认手动触发，使用 mock LLM provider，不依赖真实 LLM key。
  - CI 失败不得 merge。
- 发布前核对：
  - v1 及之后每个可发布版本必须维护 release checklist，记录已实现范围、延期项、测试结果、部署状态和泄密检查结果。
  - 生产 Web Service 必须验证公开前端 shell 可加载，非公开 `/api` 业务接口仍需鉴权，`/api/health` 可用于健康检查。
  - Render 免费层不得使用 `preDeployCommand`；如果继续使用免费层，迁移命令必须在当前部署方案中有明确位置并被文档记录。

## Agent And Documentation Rules

- AI/代理工作：
  - 改代码前必须读取相关 `plans/` 文档并检查 `git status`。
  - 必须说明计划修改范围。
  - 不得覆盖未理解的用户改动。
  - 不得执行 destructive git 命令，除非用户明确要求。
  - 不得登录 Render、触发生产部署、代填生产环境变量或保存生产密钥；Step 13 只负责提醒用户手动部署和核对清单。
- 文档：
  - `plans/` 是项目决策来源。
  - 产品、技术栈、API、数据库、LLM 推演、测试门禁、部署或工作流发生变化时必须同步文档。
  - README 只作为入口索引和快速启动说明，不承载全部设计细节。
  - 部署文档必须说明 Render Postgres 备份与恢复；应用内存档 JSON 导入/导出是用户级迁移和备份路径。
  - README 或部署文档必须说明 GitHub 公开仓库、branch protection、GitHub Actions 和 Render 自动部署的关系。

## Assumptions

- 具体脚本名后续实现时固定为根目录统一命令，例如
  `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm test:e2e`。
- 项目初期仍是单人/单实例 MVP，但工作流按可持续协作标准设计。
- 首版不做应用内自动云备份，依赖存档 JSON 导入/导出和部署层数据库备份。
