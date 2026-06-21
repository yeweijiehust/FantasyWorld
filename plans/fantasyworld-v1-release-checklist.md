# FantasyWorld V1 Release Checklist

## Summary

FantasyWorld v1 是单人 GM 工作台原型版本。

目标不是完整商业化平台，也不声称真实 LLM 已驱动世界推演，而是完成“配置模型、创建世界、推进回合、人工修正、回滚、导入导出、部署上线”的可玩闭环。

当前状态：用户已在 2026-06-18 手动完成 Render 部署并确认服务成功上线；本清单用于 Step 14 验收收尾和后续发布回看。

## Product Scope

- [x] 单人/单实例登录与 GM 工作台。
- [x] 全局模型配置页，支持 OpenAI-compatible `baseUrl`、`apiKey`、`model` 和连接探测。
- [x] 世界生成和回合推演使用 mock/模板编排；真实 LLM 推演进入 Post-v1 roadmap。
- [x] 创建世界向导，支持模板、世界语言、角色种子、内容边界、随机性、风格和创建草稿。
- [x] 创建草稿先预览，用户接受后才进入正式存档列表。
- [x] 回合推进支持 GM 介入、任务状态、SSE 更新、草稿预览、草稿修正和接受。
- [x] 世界编辑支持角色、地点、关系、世界记忆和存档设置。
- [x] 回滚支持线性回退到上一回合 snapshot。
- [x] JSON 导出不包含解密后的模型 API key；JSON 导入支持当前版本并拒绝未知版本。
- [x] UI 支持中英切换，存档生成语言和 UI 语言分离。
- [x] 移动端提供可用的折叠详情布局。
- [x] 每回合展示调用次数、耗时和 estimated tokens；真实账单金额换算延后。

## Technical Scope

- [x] Monorepo 使用 pnpm workspace，包含 `apps/api`、`apps/web`、`packages/shared`。
- [x] 后端使用 Fastify + TypeBox schema + Drizzle + Postgres。
- [x] 前端使用 React + Vite + TanStack Query/Router + react-i18next。
- [x] shared TypeBox schemas 是 API、导入导出、LLM 输出和前端 DTO 的共同契约。
- [x] 模型 API key 加密后持久化，响应只暴露 `hasApiKey` 和尾号。
- [x] 生产启动要求 `DATA_STORE=postgres`、`DATABASE_URL`、`SESSION_SECRET`、`ENCRYPTION_KEY`、`ADMIN_PASSWORD_HASH`。
- [x] Render `render.yaml` 使用免费层可用命令：build 不执行 `corepack enable`，不使用 `preDeployCommand`。
- [x] Fastify 生产服务监听 `process.env.PORT` 和 `0.0.0.0`。
- [x] 生产静态前端 shell 和 assets 公开加载，非公开 `/api` 业务接口保持登录保护。
- [x] GitHub Actions 包含 CI、security 和手动 E2E workflow。

## Deferred Beyond V1

- [x] 多用户账号、权限、多人协作和公开社区延后。
- [x] 完整分支时间线延后，v1 只做线性回滚。
- [x] 真实模型 live smoke test 不作为 CI required check。
- [x] 真实 LLM 创建世界和回合推演延后到 Post-v1。
- [x] 账单金额级成本计算延后，v1 只展示调用可见性。
- [x] 创建后独立编辑存档级模型覆盖延后。
- [x] 应用内云备份、自动恢复演练和 `ENCRYPTION_KEY` 轮换工具延后。
- [x] 付费 Render 层级的 `preDeployCommand` 迁移流程延后。

## Release Gates

- [x] `pnpm typecheck`
- [x] `pnpm lint`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] `pnpm check:render`
- [x] `pnpm test:e2e`
- [x] `pnpm audit --prod --audit-level high`
- [x] `git diff --check`
- [x] 公开仓库泄密检查：无 `.env`、无真实 API key、无私钥、无真实用户存档。
- [x] 用户已手动完成 Render 部署。
- [x] 生产 `/api/health` 返回健康结果。
- [x] 生产根路径返回前端 shell，不再被 API 鉴权拦截。

## Manual Production Notes

- Render 环境变量只保存在 Render 面板或 Render secret/env 配置中，不写入仓库。
- 必须备份 `ENCRYPTION_KEY`；丢失后已加密的模型 API key 无法恢复。
- Render Postgres 备份和恢复由部署层处理；用户级迁移继续使用存档 JSON 导入导出。
- 本仓库不保存真实 Render API key、生产数据库 URL、生产 session secret 或真实用户存档。
