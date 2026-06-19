# FantasyWorld

FantasyWorld is an LLM-driven world simulation game prototype. The v1 foundation provides a GM workbench with generated
world drafts, visible world state, turn review, rollback, JSON import/export, model configuration, and a Fastify + React
monorepo. The Post-v1 branch adds real OpenAI-compatible structured world/turn generation, background jobs, branching
turn history, save-level model overrides, usage visibility, multi-user ownership, and lightweight GM/Viewer/Player
collaboration. It also includes manual backup/key-rotation runbooks and model health smoke testing.

## Development

```powershell
corepack enable
pnpm install
docker compose up -d
pnpm db:migrate
pnpm dev
```

The prototype login password is `fantasyworld` until `ADMIN_PASSWORD_HASH` is configured. Playwright uses a separate
in-memory API process for E2E runs.

## Production Environment

Production requires persistent Postgres storage and explicit secrets:

```powershell
pnpm auth:hash "replace-with-admin-password"
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Set `DATA_STORE=postgres`, `DATABASE_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`, and `ADMIN_PASSWORD_HASH` in Render. Back
up `ENCRYPTION_KEY`; stored model API keys cannot be recovered if it is lost.

Before rotating `ENCRYPTION_KEY`, take a Postgres backup and run:

```powershell
pnpm keys:rotate -- --dry-run
pnpm keys:rotate
```

Follow the [backup, restore, and key rotation runbook](plans/fantasyworld-backup-restore-runbook.md) for the full
maintenance sequence.

## Checks

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm check:render
pnpm test:e2e
```

## Plans

- [Product plan](plans/fantasyworld-part1-product-plan.md)
- [Tech stack plan](plans/fantasyworld-tech-stack-plan.md)
- [Project conventions](plans/fantasyworld-project-conventions.md)
- [Implementation roadmap](plans/fantasyworld-implementation-roadmap.md)
- [V1 release checklist](plans/fantasyworld-v1-release-checklist.md)
- [Post-v1 roadmap](plans/fantasyworld-post-v1-roadmap.md)
- [Backup, restore, and key rotation runbook](plans/fantasyworld-backup-restore-runbook.md)
