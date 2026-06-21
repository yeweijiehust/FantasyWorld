# FantasyWorld Backup, Restore, and Key Rotation Runbook

## Summary

Post-v1 Step 12 adds an operational runbook for save backup, database restore rehearsal, and `ENCRYPTION_KEY` rotation.

There are two backup levels:

- User-level save export/import: use the in-app JSON export/import flow for a single save. This does not include model API keys.
- Deployment-level database backup: use Postgres backup/restore for full app recovery, including encrypted model key ciphertext.

## Required Secrets

- `DATABASE_URL`
- Current `ENCRYPTION_KEY`
- New 32-byte base64 `ENCRYPTION_KEY`

Generate a new production key:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Keep the previous and new keys in a password manager until the rotation is verified.

## User-Level Save Backup

Use this for moving or preserving one world save:

1. Log in as the save owner or GM.
2. Open the save.
3. Use `Export`.
4. Store the JSON file outside the repository.
5. To restore, use `Import JSON`.
6. Re-enter model API keys after import, because exports never include decrypted API keys.

## Database Backup Before Maintenance

Use a maintenance window for database backup, restore, or key rotation. Do not start new LLM jobs during the window.

Create a local backup directory:

```powershell
New-Item -ItemType Directory -Force .\backups
```

Create a custom-format Postgres backup:

```powershell
pg_dump --dbname "$env:DATABASE_URL" --format custom --file ".\backups\fantasyworld-pre-maintenance.dump"
```

Confirm the backup file exists and is non-empty:

```powershell
Get-Item ".\backups\fantasyworld-pre-maintenance.dump"
```

## Restore Rehearsal

Run rehearsal against a scratch database, not production.

```powershell
createdb fantasyworld_restore_rehearsal
```

```powershell
$env:RESTORE_DATABASE_URL="postgres://fantasyworld:fantasyworld@localhost:5432/fantasyworld_restore_rehearsal"
pg_restore --dbname "$env:RESTORE_DATABASE_URL" --clean --if-exists ".\backups\fantasyworld-pre-maintenance.dump"
```

Run migrations against the restored database:

```powershell
$env:DATABASE_URL=$env:RESTORE_DATABASE_URL
pnpm db:migrate
```

Validate encrypted model keys can be read with the current key by running a key-rotation dry run to a throwaway new key:

```powershell
$env:OLD_ENCRYPTION_KEY=$env:ENCRYPTION_KEY
$env:NEW_ENCRYPTION_KEY="replace-with-generated-32-byte-base64-key"
pnpm keys:rotate -- --dry-run
```

The command should print JSON with `dryRun: true` and the number of encrypted global/save model keys found.

## ENCRYPTION_KEY Rotation

Always run dry-run first:

```powershell
$env:OLD_ENCRYPTION_KEY="replace-with-current-key"
$env:NEW_ENCRYPTION_KEY="replace-with-new-32-byte-base64-key"
pnpm keys:rotate -- --dry-run
```

If dry-run fails, stop. The current key is wrong, the backup is from a different environment, or stored ciphertext is damaged.

Run the rotation:

```powershell
pnpm keys:rotate
```

Expected output:

```json
{
  "dryRun": false,
  "modelConfigs": 1,
  "saves": 2,
  "updated": 3,
  "modelConfigIds": ["global"],
  "saveIds": ["save_example"]
}
```

After the command succeeds:

1. Update Render `ENCRYPTION_KEY` to the new value.
2. Trigger or wait for a redeploy.
3. Log in and open global model settings.
4. Open a save with a save-level model override.
5. Run model probe or a mock-safe turn flow.
6. Keep the old key until this verification passes.

## Failure Recovery

If dry-run fails:

- Do not rotate.
- Verify `OLD_ENCRYPTION_KEY` is the exact current production key.
- Verify `DATABASE_URL` points to the intended database.
- Restore the maintenance backup into a scratch database and retry dry-run there.

If the app returns `secret_decryption_failed` after deployment:

- Restore the previous `ENCRYPTION_KEY` in Render and redeploy.
- If the database was already rotated and the previous key cannot read it, set Render to the new key and redeploy.
- If neither key works, restore the pre-maintenance Postgres backup, then retry the dry-run.

If production data must be restored from backup:

1. Stop new writes by entering a maintenance window.
2. Restore the selected Postgres backup through Render's database restore flow or `pg_restore`.
3. Set `ENCRYPTION_KEY` to the key that matches the restored backup time.
4. Run `pnpm db:migrate`.
5. Run `pnpm keys:rotate -- --dry-run` with the restored key and a newly generated target key.
6. Verify `/api/health`, login, model settings, and one save page.

## Acceptance Checklist

- A pre-maintenance database backup exists.
- Restore rehearsal completed against a scratch database.
- `pnpm keys:rotate -- --dry-run` succeeded.
- `pnpm keys:rotate` succeeded.
- Render `ENCRYPTION_KEY` was updated manually.
- Model config reads do not return `secret_decryption_failed`.
- Old and new keys remain archived until the next successful backup.
