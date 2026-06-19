# FantasyWorld v2 Acceptance Checklist

## Summary

This checklist closes Post-v1 Step 14. Implementation-side checks can be completed in PR/CI. Production deployment and
live model smoke testing remain manual user actions.

## Implementation Evidence

- [x] Real LLM world generation path exists through OpenAI-compatible structured JSON generation.
- [x] Real LLM turn orchestration path exists through OpenAI-compatible structured JSON generation.
- [x] Mock mode remains available for local development, CI, and no-key environments.
- [x] Failed LLM output does not write accepted world state.
- [x] Generation and turn jobs support failed, retry, cancel, refresh/recover, and needs-review states.
- [x] Cost and token usage are visible on turn call summaries.
- [x] Save-level model overrides are supported and do not export decrypted API keys.
- [x] Multi-user ownership and GM/Viewer/Player collaboration are implemented.
- [x] Backup, restore rehearsal, and `ENCRYPTION_KEY` rotation runbook exists.
- [x] Manual model health smoke test endpoint and Settings UI exist.

## Local Gates

Last verified on 2026-06-19:

- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] `pnpm check:render`
- [x] `git diff --check`
- [x] `pnpm keys:rotate -- --help`

## Browser Checks

Last verified on 2026-06-19:

- [x] Login loads and succeeds locally.
- [x] World creation and draft acceptance work locally.
- [x] Collaboration panel renders and can add a Viewer collaborator locally.
- [x] Settings health panel renders app/model health locally.
- [x] No-key smoke test returns skipped locally.
- [x] Browser console has no app errors in the checked flows.

## GitHub Checks

- [x] PR branch pushed to GitHub.
- [x] `ci` GitHub Action passed for latest Step 13 commit.
- [x] `security` GitHub Action passed for latest Step 13 commit.
- [ ] Final PR head `ci` passes after this checklist commit.
- [ ] Final PR head `security` passes after this checklist commit.

## Manual Production Deployment

These steps are intentionally manual:

- [ ] Merge PR after required checks pass.
- [ ] Confirm Render deploy starts from `main`.
- [ ] Confirm Render deploy completes successfully.
- [ ] Open production `/api/health`.
- [ ] Open production frontend shell.
- [ ] Log in with the production admin password.
- [ ] Confirm no production secret appears in browser, logs, PR text, or exported save JSON.

## Manual Live Model Smoke Test

Run only after production env vars are set:

- [ ] Confirm production `ENCRYPTION_KEY`, `SESSION_SECRET`, `ADMIN_PASSWORD_HASH`, `DATABASE_URL`, and
      `DATA_STORE=postgres`.
- [ ] Configure a real OpenAI-compatible `baseUrl`, `model`, and API key in Settings.
- [ ] Run model settings save/probe.
- [ ] Run Settings model smoke test and confirm status is succeeded.
- [ ] Create a new world and confirm generation uses the configured live model.
- [ ] Advance a turn and confirm turn orchestration uses the configured live model.
- [ ] Confirm turn call summary shows model, latency, tokens, and estimated cost when prices are configured.
- [ ] Confirm failed provider calls show recoverable failed job state and do not change accepted world state.

## Release Decision

- [ ] v2 accepted for production use.
- [ ] Known deferred items are recorded in the next roadmap.
- [ ] Rollback path is understood: revert PR/deploy and restore the pre-maintenance database backup if migration or key
      rotation was applied.
