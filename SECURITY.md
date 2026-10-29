# Security

Skillbox is a single-owner, self-hosted application with revocable scoped agent clients. Do not treat profiles as independently hosted tenants or expose the owner interface to untrusted users.

## Credentials and data

- Generate a unique database password and owner token for every installation. `.env`, data, backups and agent logs must remain private.
- Provider credentials are optional and supplied by each owner through Settings. They are encrypted in PostgreSQL using AES-256-GCM; encryption depends on the owner token. The status APIs expose no secret values.
- Database backups plus the owner token can reveal stored integration credentials. Keep them separate and protected. Rotation may require reconnecting integrations.
- Skill bodies and exported packages are user-managed content, not an appropriate secret store. Anyone granted a skill can read its package and historical revisions unless current access/lifecycle checks deny it. Downloads cannot be recalled by revocation.
- Jev sends task text and authorized active skill descriptions only to the selected provider (OpenRouter, TypeSafe AI, or Vercel AI Gateway), using that provider's separately saved key. Provider data policies and charges apply. Removing its key prevents new model requests; an already-sent request cannot be recalled.
- Owner-configured external MCP/OAuth endpoints are trusted administrative configuration. Do not configure unknown endpoints or arbitrary cross-origin OAuth aliases.

## Reporting

Do not put credentials, private skill content, database dumps or exploit details in a public issue. Use the repository's private vulnerability reporting channel if enabled, or contact its maintainer privately. If you discover an exposed key, revoke/rotate it at its issuer; deleting the file or making the repository private is not sufficient.

## Before publishing source

Scan both the proposed source snapshot and all history/refs you intend to publish. Exclude `.env`, data, backups, exports, local agent/session directories, build artifacts and operational notes. A clean working tree does not prove historical data is safe. Prefer a reviewed clean-history source export when the original repository contains personal operations history.

Secret scanners are heuristic and cannot prove absence of every secret. Review results and binary files manually, verify dependency licenses, and do not publish unreviewed container build caches or private database/library repositories alongside the application.
