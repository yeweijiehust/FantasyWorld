# FantasyWorld 技术栈方案

## Summary

FantasyWorld 第一版采用 TypeScript 全栈 monorepo。仓库使用 `pnpm workspace` 管理
`apps/api`、`apps/web`、`packages/shared`，后端使用 Fastify，前端使用 React + Vite，数据库使用 Postgres + Drizzle。

部署目标是 Render 上的单个 Web Service，由 Fastify 同时提供 REST
API、SSE 回合进度流和 React 构建后的静态文件。第一版优先做可玩闭环和可部署闭环，不引入多用户 SaaS、Redis 队列、复杂 agent 框架或前后端分离部署。

## Key Stack Decisions

- Runtime：Node.js 24、TypeScript strict、ESM；根目录声明 `engines.node`。
- Package manager：pnpm 10，使用 `pnpm-workspace.yaml` 管理 monorepo。
- Monorepo：只用 pnpm workspace，暂不上 Turborepo/Nx。
- Backend：Fastify v5，Pino 日志，REST API，SSE 推送回合任务进度。
- Schema：TypeBox-first，使用 `typebox@1.x` 和 `@fastify/type-provider-typebox@6.x`。
- API docs：`@fastify/swagger` + `@fastify/swagger-ui`，从 Fastify route schemas 生成 OpenAPI。
- Frontend：React + Vite SPA，TanStack Router，TanStack Query。
- Frontend state/forms：TanStack Query 管服务端状态，React Hook Form 管表单，少量 Zustand 管 UI 状态。
- UI：Tailwind CSS + shadcn/ui + Radix + lucide。
- i18n：`react-i18next` 管 UI 中英切换；存档生成语言作为业务字段传给后端。
- Database：Postgres + Drizzle ORM，使用显式迁移文件。
- Local database：Docker Compose 提供本地 Postgres。
- Auth：单用户密码门，HTTP-only cookie session。
- Secrets：用户模型 API key 服务端加密后存 Postgres，前端只显示配置状态和尾号。
- LLM：OpenAI-compatible 协议，用户配置 base URL、API key、model；使用 OpenAI SDK 薄封装。
- Long jobs：创建存档和推进回合都使用任务表 + SSE，支持取消、重试和 idempotency key。
- Testing：Vitest + Testing Library + Playwright。
- Quality：ESLint + Prettier + TypeScript typecheck。
- CI/CD：GitHub Actions 提供 PR 门禁、安全检查和手动 E2E workflow。
- Deployment：GitHub 公开仓库 `https://github.com/yeweijiehust/FantasyWorld.git` 已配置为
  `origin`；Render 连接 GitHub，`main` 合并后自动部署；Render `render.yaml` 蓝图管理单 Web Service + Render Postgres。

## Monorepo Structure

```text
FantasyWorld/
  .gitattributes
  .gitignore
  .github/
    workflows/
      ci.yml
      security.yml
      e2e.yml
  apps/
    api/
      src/
        plugins/
        routes/
        services/
        db/
        llm/
      drizzle/
    web/
      src/
        routes/
        components/
        features/
        lib/
        i18n/
  packages/
    shared/
      src/
        schemas/
        types/
        constants/
  plans/
```

- `apps/api`：Fastify 服务、REST routes、SSE、auth、LLM orchestration、Drizzle migrations。
- `apps/web`：React/Vite SPA、创建向导、存档列表、主工作台、设置页。
- `packages/shared`：TypeBox schemas、API DTO、存档/回合/LLM 输出类型、常量。
- `.github/workflows`：GitHub Actions 的 CI、安全检查和手动 E2E workflow。
- `.gitignore`：忽略 Node 依赖、真实环境变量、构建产物、缓存、测试报告和本地 IDE/OS 文件。
- `.gitattributes`：固定跨平台文本换行，避免 Windows 与 GitHub 协作时出现 LF/CRLF 漂移。

## Backend Architecture

- Fastify 按领域拆 plugins：auth、model-config、saves、turns、health。
- 每个公开 route 明确声明 `params`、`querystring`、`body`、`response` schema。
- 所有 route 使用 `.withTypeProvider<TypeBoxTypeProvider>()` 获得 TypeBox 类型推导。
- response schema 必填，以启用 Fastify response serialization 和 OpenAPI 输出。
- 所有错误统一走 Fastify error handler，返回稳定错误格式。
- 服务在 Render 上监听 `process.env.PORT` 和 `0.0.0.0`。

## API Surface

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `GET /api/model-config`
- `PUT /api/model-config`
- `GET /api/saves`
- `POST /api/saves`
- `GET /api/saves/:id`
- `PATCH /api/saves/:id`
- `DELETE /api/saves/:id`
- `GET /api/saves/:id/world-state`
- `PATCH /api/saves/:id/settings`
- `PATCH /api/saves/:id/model-config`
- `GET /api/saves/:id/characters`
- `POST /api/saves/:id/characters`
- `PATCH /api/saves/:id/characters/:characterId`
- `DELETE /api/saves/:id/characters/:characterId`
- `PATCH /api/saves/:id/characters/:characterId/memory`
- `GET /api/saves/:id/locations`
- `POST /api/saves/:id/locations`
- `PATCH /api/saves/:id/locations/:locationId`
- `DELETE /api/saves/:id/locations/:locationId`
- `GET /api/saves/:id/relationships`
- `POST /api/saves/:id/relationships`
- `PATCH /api/saves/:id/relationships/:relationshipId`
- `DELETE /api/saves/:id/relationships/:relationshipId`
- `PATCH /api/saves/:id/world-memory`
- `POST /api/saves/import`
- `GET /api/saves/:id/export`
- `POST /api/save-generation-jobs`
- `GET /api/save-generation-jobs/:id/events`
- `PATCH /api/save-generation-jobs/:id/draft`
- `POST /api/save-generation-jobs/:id/accept`
- `POST /api/save-generation-jobs/:id/cancel`
- `POST /api/save-generation-jobs/:id/retry`
- `POST /api/saves/:id/turns`
- `GET /api/turn-jobs/:id/events`
- `POST /api/turn-jobs/:id/cancel`
- `POST /api/turn-jobs/:id/retry`
- `PATCH /api/turns/:id/draft`
- `POST /api/turns/:id/accept`
- `POST /api/saves/:id/rollback`

## Database Model

- 核心表：`saves`、`characters`、`locations`、`relationships`、`turns`、`turn_jobs`、`save_generation_jobs`、`model_configs`、`sessions`。
- 核心对象使用关系表，便于查询、局部编辑和 UI 展示。
- 每回合保存完整 JSONB snapshot，用于回滚、导入导出和调试。
- 每个存档保存 `saveSeed`，每回合 snapshot 保存派生的 `turnSeed`，用于回滚、调试和测试复现。
- 存档 JSON、回合 snapshot、prompt、schema 都记录版本；导入旧版本时运行迁移器，无法迁移时拒绝导入并返回明确错误。
- 同一存档同一时间只允许一个 active job；不同存档可并行。
- schema 变更使用 Drizzle 显式迁移文件，不在生产启动时自动 push schema。

## Schema And Validation

- `packages/shared` 中 TypeBox schemas 是 API、前端类型、LLM 输出和导入导出格式的权威来源。
- 使用 `Static<typeof Schema>` 推导 TypeScript 类型。
- Fastify 直接消费 TypeBox schema 进行请求校验、响应序列化和 OpenAPI 生成。
- LLM 输出必须符合 TypeBox schema：事件、角色行动、对话、状态变更、记忆更新、调用摘要。
- LLM 输出校验失败时有限重试；仍失败则保留错误、原始输出和可修正草稿，不写入正式世界状态。
- 前端表单通过 TypeBox 校验适配层连接 React Hook Form，不引入 Zod 作为并行 schema 体系。
- 不接受用户提交的 schema，也不在运行时动态拼接不可信 schema。

## Frontend Architecture

- Vite 构建 React SPA，生产构建产物由 Fastify 静态托管。
- TanStack Router 管页面：登录、存档列表、创建向导、主工作台、模型配置。
- TanStack Query 管 API 数据、加载状态、错误状态和缓存失效。
- React Hook Form 管创建向导、模型配置、状态编辑等复杂表单，错误信息由 TypeBox resolver/适配层映射。
- Zustand 只放当前选中角色/地点/事件、侧栏展开、编辑面板等 UI 状态。
- react-i18next 管 UI 语言；存档语言不跟 UI 语言强绑定。
- Tailwind + shadcn/ui 实现桌面优先三栏工作台，移动端用折叠栏和详情抽屉适配。

## Auth And Secrets

- 第一版是单用户部署实例，不做注册、多用户和公开账号体系。
- 管理员密码 hash 由 `pnpm auth:hash` 生成并通过 `ADMIN_PASSWORD_HASH` 提供，运行时不读取明文管理员密码。
- 登录成功后发 HTTP-only cookie session，前端不保存 bearer token。
- 用户模型 API key 用 `ENCRYPTION_KEY` 加密后存 Postgres。
- 前端读取模型配置时只显示 provider/base URL/model、是否已配置 key、key 尾号。

## LLM And Turn Jobs

- 支持 OpenAI-compatible 接口：base URL、API key、model。
- LLM SDK 层保持薄封装，负责请求、结构化输出、重试、token/耗时统计和错误归一。
- 保存模型配置时执行连接和能力探测，记录 JSON mode、usage、stream 支持情况。
- 不支持 JSON mode 时使用纯文本 JSON 约束 + 本地 TypeBox 校验重试。
- 全局模型配置提供默认 API key、base URL 和 model；存档级覆盖可修改 base URL、model、随机性和内容偏好，API
  key 默认继承全局配置。
- 创建存档时后端写入 `save_generation_jobs`，前端通过 SSE 订阅生成进度；初始世界先进入草稿，用户确认后才创建正式存档。
- 创建回合时后端写入 `turn_jobs`，前端通过 SSE 订阅任务状态。
- 长任务请求使用 idempotency key 防止重复创建、重复扣费和重复写状态。
- 任务状态至少包括：queued、running、needs_review、failed、cancelled、accepted。
- 回合结果先进入草稿，用户可编辑事件和状态变更，接受后才写入正式世界状态。
- 每次模型调用记录模型、耗时、token、错误和 schema 校验结果。

## Environment And Deployment

- 必填环境变量：
  - `DATABASE_URL`
  - `SESSION_SECRET`
  - `ENCRYPTION_KEY`
  - `ADMIN_PASSWORD_HASH`
  - `NODE_ENV`
  - `PORT`
- 后端启动时使用 TypeBox schema 校验 env，缺失或格式错误立即失败。
- 本地提供 `.env.example` 和 Docker Compose Postgres；真实 `.env`、`.env.*` 必须被 `.gitignore` 忽略，`.env.example`
  必须保留可提交。
- 本地提供 `pnpm auth:hash` 生成管理员密码 hash，并在 `.env.example` 说明用法。
- GitHub remote：
  - GitHub 公开仓库已创建：`https://github.com/yeweijiehust/FantasyWorld.git`。
  - 本地 `origin` 已指向该仓库，当前 `main` 跟踪 `origin/main`。
  - `main` 分支启用保护规则，只允许通过 PR + required checks 合并。
  - 公开仓库中不得提交真实密钥、生产配置或真实用户存档。
- Render 使用 `render.yaml` 声明 Web Service、build/start 命令、数据库和环境变量占位。
- 首次手动部署默认使用 Render Web Service `free` plan 和 Render Postgres `free`
  plan；后续数据量、备份、可用性或性能需要提升时再手动升级对应 plan。
- Render build command 直接执行 `pnpm install --frozen-lockfile && pnpm build`；不要在 Render build command 中执行
  `corepack enable`，避免尝试修改只读系统路径导致构建失败。
- Render free Web Service 不支持 `preDeployCommand`；首版把 `pnpm db:migrate` 串进
  `startCommand`，再启动 API。升级到支持 pre-deploy 的层级后，可以再把迁移移回部署前命令。
- Render 连接 GitHub 仓库、填写生产环境变量和触发首次部署都由用户手动完成；项目实现侧只准备配置和提醒清单。
- 用户完成 Render 连接后，`main` required checks 通过并合并会触发 Render 自动部署。
- GitHub Actions 不直接调用 Render API，不在 GitHub Secrets 中保存 Render 部署密钥。

## GitHub Actions

- `ci.yml`：
  - 触发：`pull_request` 到 `main`、`push` 到 `main`。
  - 使用 Node 24、pnpm 10、`actions/checkout`、`actions/setup-node` 和 pnpm cache。
  - 执行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。
  - API/DB 测试使用 GitHub Actions Postgres service container，运行迁移后测试，不依赖外部测试数据库。
- `security.yml`：
  - 触发：`pull_request`、`push` 到 `main`。
  - 检查依赖变更、lockfile 变更和公开仓库密钥泄漏风险。
  - 配合 GitHub secret scanning、push protection 和 dependency review。
- `e2e.yml`：
  - 触发：`workflow_dispatch`，后续可扩展到 release 分支或高风险 PR。
  - 使用 mock LLM provider，不需要真实 LLM/API key。
  - 运行 Playwright，覆盖登录、创建存档、推进回合、回滚、导入导出和关键页面视觉检查。
- Actions 密钥策略：
  - 默认不在 GitHub Actions 中保存真实 LLM、Render、生产数据库或生产 session/encryption 密钥。
  - CI 使用 mock/fake provider 与固定 fixtures。
  - 真实 LLM live smoke test 只允许手动、本地或独立低权限测试环境运行。

## Test Plan

- Type tests：确认 shared TypeBox schemas 能正确推导 API DTO、存档状态和 LLM 输出类型。
- Unit tests：Vitest 覆盖 shared schemas、LLM 输出校验、加密/解密、回合状态 reducer、Drizzle repository 逻辑。
- API tests：Fastify `inject` 测试 auth、model
  config、存档 CRUD、世界对象编辑、创建存档任务、回合任务创建、取消、重试、失败处理、回滚。
- Frontend tests：Vitest + Testing Library 覆盖创建向导、配置页、三栏工作台基础交互。
- E2E
  tests：Playwright 覆盖登录、配置模型、创建存档、推进回合、编辑草稿、接受回合、回滚、导入导出，并在桌面/移动视口做关键页面截图或布局检查。
- Compatibility tests：覆盖当前版本导入、旧版本迁移、未知版本拒绝、模型能力探测降级和随机 seed 复现。
- GitHub Actions checks：PR 自动运行 `ci.yml` 并阻塞不合格 merge；`security.yml` 检查依赖和泄密风险；`e2e.yml`
  可手动触发。
- Deployment checks：用户手动完成 Render 连接和首次部署；后续 `main` 合并触发 Render 自动部署，部署完成后由用户检查
  `/api/health`。

## Assumptions And Defaults

- SQLite 不作为第一版正式数据库，因为 Render 默认文件系统不适合作为持久正式存储。
- MongoDB 暂不采用，因为第一版既需要结构化查询，也需要事务化回合写入和回滚快照。
- Redis 队列暂不引入，首版使用 Postgres 任务表和 SSE。
- LangChain/LangGraph 暂不引入，首版推演编排由业务代码控制。
- Zod 暂不作为核心 schema 方案；如果未来前端表单确实需要，可局部引入，但不得替代 shared TypeBox schemas 的契约地位。
- 第一版世界模板作为仓库内置、版本化 fixtures；创建存档时复制模板内容到用户存档草稿。

## References

- [pnpm Workspace](https://pnpm.io/workspaces)
- [React build tool guidance](https://react.dev/learn/build-a-react-app-from-scratch)
- [Vite guide](https://vite.dev/guide/)
- [Fastify docs](https://fastify.dev/docs/latest/)
- [Fastify validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- [Fastify type providers](https://fastify.dev/docs/latest/Reference/Type-Providers/)
- [Fastify plugins](https://fastify.dev/docs/latest/Reference/Plugins/)
- [fastify-type-provider-typebox](https://github.com/fastify/fastify-type-provider-typebox)
- [TypeBox docs](https://sinclairzx81.github.io/typebox/)
- [Render Web Services](https://render.com/docs/web-services)
- [Render Postgres](https://render.com/docs/postgresql-creating-connecting)
- [Render Disks](https://render.com/docs/disks)
- [Drizzle overview](https://orm.drizzle.team/docs/overview)
- [GitHub Actions workflow syntax](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions)
- [GitHub Actions setup-node](https://github.com/actions/setup-node)
- [GitHub Actions PostgreSQL service containers](https://docs.github.com/en/actions/use-cases-and-examples/using-containerized-services/creating-postgresql-service-containers)
- [GitHub branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)
- [GitHub dependency review action](https://github.com/actions/dependency-review-action)
