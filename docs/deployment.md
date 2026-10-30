# Deployment and operations

## Configuration

Generate unique local credentials with `bun scripts/setup-env.ts`, or copy `.env.example` to `.env` and replace every placeholder. Keep `.env` mode 0600 and outside version control. Never use example values in production.

| Variable | Purpose |
| --- | --- |
| `POSTGRES_PASSWORD` | Required unique Compose database password. Use URL-safe random bytes. |
| `SKILLBOX_ADMIN_TOKEN` | Required owner login key, at least 32 random characters; also protects stored integration secrets. |
| `SKILLBOX_ORIGIN` | Canonical browser origin; default `http://127.0.0.1:4791`. Use your own HTTPS origin behind a reverse proxy. |
| `SKILLBOX_BIND_ADDRESS`, `SKILLBOX_PORT` | Compose host binding; defaults to loopback on 4791. Explicitly opt into LAN exposure. |
| `SKILLBOX_IMAGE` | Optional trusted prebuilt image reference for `start-image`; otherwise build locally. |
| `SKILLBOX_ADMIN_TOKEN_FILE`, `DATABASE_URL_FILE` | Optional mounted startup secrets for custom deployments; do not set alongside their direct counterparts. |
| `SKILLBOX_ALLOWED_ORIGINS` | Optional comma-separated additional browser origins. Empty by default; do not use wildcards. |
| `SKILLBOX_EXECUTOR_RESOURCE_ALIASES` | Optional JSON object mapping exact configured MCP endpoint URLs to trusted cross-origin OAuth resource URLs. Default `{}`; needed only for a deployment-specific compatibility alias. |
| `DATABASE_URL` | Required when running Bun directly with your own database; Compose supplies its internal URL. |
| `HOST`, `PORT` | Direct Bun bind settings; Compose binds the app internally and publishes only host loopback 4791. |

Jev requires the selected OpenRouter, TypeSafe AI or Vercel AI Gateway provider's key saved by the owner in **Settings → Jev recommendations**. Keys are independent; changing providers never transfers a key to another service. No application environment key fallback exists. Executor starts unconfigured; enter your own HTTPS MCP endpoint and authenticate in Settings. Integration keys are encrypted in `workspace_settings`, and status APIs never return them.

If migrating a previously personalized installation, explicitly configure any needed legacy browser origins and Executor resource aliases in your private deployment environment before upgrade. No private aliases are built into source. Existing stored Executor endpoint/credentials, client keys, profiles and revisions are retained; this update does not change them automatically.

For Docker-only setup, optional Caddy HTTPS, prebuilt images, helper commands and explicit restore, see [self-hosting](self-hosting.md). For store packaging and release gates, see [Umbrel](../deploy/umbrel/README.md).

## Start and upgrade

```sh
docker compose up -d --build
curl --fail http://127.0.0.1:4791/healthz
```

For remote access, configure a TLS reverse proxy you operate, then verify the exact HTTPS URL with certificate validation. Keep PostgreSQL unexposed. Database/application Compose services have memory limits; the application filesystem is read-only and capabilities are dropped.

Before upgrading:

1. Review source changes and environment requirements.
2. Back up the database and protect the matching owner token.
3. Build and test the new version without pointing tests at production.
4. Restart only the application deliberately; verify health, owner login and a scoped client.
5. Keep the prior image/source revision and verified backup for rollback.

Changing `SKILLBOX_ADMIN_TOKEN` may make stored integration credentials undecryptable. Restore the matching token or explicitly reset unreadable integration rows through your administrative database connection before re-entering credentials in Settings. It does not automatically revoke existing owner sessions or client keys: clear the `sessions` table through your administrative database connection when invalidating all owner sessions, and revoke/replace clients separately if needed. Do not silently rotate secrets during upgrades.

## Backups and exports

```sh
bash scripts/backup.sh
# Verify by restoring into a separate database, never directly over production.
# Native library export inside the running app:
docker compose exec -T app bun scripts/export.ts
docker compose cp app:/app/data/export ./private-library-export
```

The backup helper writes a PostgreSQL dump and, when available, a matching protected `.env` sidecar. That sidecar contains secrets. Backups include client/profile state, revisions and encrypted integration credentials. Folder exports include complete skill content, which may itself contain sensitive material. Do not put either in a public source repository. Choose a private backup destination and your own retention/scheduling policy; Skillbox installs no timers or GitHub workflows automatically.

`SKILLBOX_GIT_EXPORT_DIR=/path/to/dedicated-private-export bash scripts/export-github.sh` is optional. It only accepts a marked export checkout and can delete stale generated export files there; never point it at application source or unrelated work.

## Rollback

Restore backups into a separate database first and validate them. Switch application/database configuration only after checking the restored instance. UI Restore creates a new immutable skill revision without deleting history. Agent config/package backups are separate from server backups.

## Exposure limits

Owner login, client revocation and scoped grants do not make this a multi-tenant public service. Use a trusted network or your own authenticated ingress and quotas. Review proxy request limits, logging, backup access and OAuth endpoint trust before internet exposure. Server-side integrations necessarily make requests to administrator-selected services; do not give owner access to untrusted users.
