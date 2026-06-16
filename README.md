# FantasyWorld

FantasyWorld is an LLM-driven world simulation game prototype. The first implementation focuses on a single-player GM
workbench with generated world drafts, visible world state, mock turn advancement, turn review, rollback, JSON
import/export, model configuration, and a Fastify + React monorepo foundation.

## Development

```powershell
corepack enable
pnpm install
pnpm dev
```

The prototype login password is `fantasyworld` until `ADMIN_PASSWORD_HASH` is configured.

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
