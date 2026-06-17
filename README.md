# FantasyWorld

FantasyWorld is an LLM-driven world simulation game prototype. The first implementation focuses on a single-player GM
workbench with generated world drafts, visible world state, mock turn advancement, turn review, rollback, JSON
import/export, model configuration, and a Fastify + React monorepo foundation.

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

## Checks

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

## Plans

- [Product plan](plans/fantasyworld-part1-product-plan.md)
- [Tech stack plan](plans/fantasyworld-tech-stack-plan.md)
- [Project conventions](plans/fantasyworld-project-conventions.md)
- [Implementation roadmap](plans/fantasyworld-implementation-roadmap.md)
