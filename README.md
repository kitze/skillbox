# Skillbox

A self-hosted, versioned skills library for AI agents. React, Bun, Hono and PostgreSQL. MIT licensed.

## Features

- Markdown/file editor, immutable revisions, conflict detection and restore.
- Profiles with skill/bundle grants and independent create, update, archive and proposal permissions.
- Revocable client keys, usage reporting and owner-reviewed updates.
- HTTP MCP, a Node/Bun stdio bridge and checksum-verified CLI downloads.
- Optional task-aware Jev recommendations using **your own TypeSafe AI or Vercel AI Gateway key**.
- Optional Executor integration using **your own endpoint and authentication**.
- Native folder imports/exports, protected PostgreSQL/config backups and explicit restore tooling.
- Docker-only setup, optional Caddy HTTPS and Umbrel package generation.

A new instance starts empty. No personal skills, accounts, client keys, service endpoints or paid-provider credentials are seeded. Skillbox never executes uploaded skill code.

## Quick start

Requires Docker Engine/Desktop with Compose v2 and Bash (Linux, macOS or WSL). No host Bun/Node installation needed.

```sh
git clone https://github.com/kitze/skillbox.git
cd skillbox
bash scripts/skillbox.sh setup
# Creates .env with unique random credentials, mode 0600; refuses to overwrite.
bash scripts/skillbox.sh start
```

Already have Bun? `bun scripts/setup-env.ts` remains available. See [self-hosting](docs/self-hosting.md) for LAN ports, optional automatic HTTPS, prebuilt images, mounted secrets, backup/restore and upgrades. [Umbrel packaging](deploy/umbrel/README.md) supports official submissions and community stores; public images and real Umbrel lifecycle verification are release gates, not implied by having package files.

Open `http://127.0.0.1:4791`. Sign in with `SKILLBOX_ADMIN_TOKEN` from your local `.env`. The key is not printed by the setup script. Keep `.env` private. For a remote installation, set `SKILLBOX_ORIGIN` to your own HTTPS origin and configure a TLS reverse proxy; see [deployment](docs/deployment.md).

Create or import skills, create a profile with the required grants, then create a client connection. Client keys are shown once; only their hashes are stored. Use separate client keys rather than distributing the owner key.

For local development with your own PostgreSQL 16+ database:

```sh
bun install --frozen-lockfile
# Set DATABASE_URL, SKILLBOX_ADMIN_TOKEN (at least 32 random characters),
# and SKILLBOX_ORIGIN=http://127.0.0.1:4791 in your protected environment.
bun run build
bun run start
```

## Jev setup

Open **Settings → Jev recommendations**, select **Vercel AI Gateway** (default) or **TypeSafe AI**, and save that provider's API key. Keys are stored separately: selecting TypeSafe never sends your Gateway key to TypeSafe, and switching back retains your saved Gateway key. Removing the selected provider's key disables its model calls. Skillbox does not auto-import environment keys, fetch credentials from a skill library, or ship an application-wide provider account.

The key is encrypted server-side in PostgreSQL using AES-256-GCM with key material derived from your `SKILLBOX_ADMIN_TOKEN`. It is never returned by the settings API or included in browser bundles. Protect the owner token and database backups. Changing that token makes stored integration credentials unreadable. Follow the [rotation guidance](docs/deployment.md) before changing it.

Saving a key does not validate provider access or buy credits. Jev sends task text and authorized active skill descriptions to the selected provider; its charges and data handling apply to your account. Without that provider's saved key, or on failure, recommendations return deterministic search with an explicit fallback reason and attempted `provider`.

TypeSafe uses `POST https://api.typesafe.ai/v1/systemone`, Bearer authentication and `model: "jev-latest"`, without Gateway protocol headers. Gateway keeps its evaluation-model endpoint and existing headers. Both use the same bounded catalog and score rubric; TypeSafe's snake-case usage fields are normalized. Provider/key changes invalidate cached and in-flight results. The direct contract follows the [TypeSafe OpenAPI schema](https://api.typesafe.ai/openapi.json).

## Agents and CLI

Install `bootstrap/SKILL.md` as the agent's `skills-library` bootstrap. Configure your own instance's `/mcp` endpoint with `Authorization: Bearer <client-key>`. For clients needing stdio:

```json
{
  "mcpServers": {
    "skillbox": {
      "command": "node",
      "args": ["/absolute/path/to/skillbox/cli/skillbox.mjs", "mcp"],
      "env": {
        "SKILLBOX_URL": "https://skills.example.com",
        "SKILLBOX_CONFIG": "/absolute/path/to/protected-client-config.json"
      }
    }
  }
}
```

Client config: `{ "url": "https://skills.example.com", "token": "YOUR_CLIENT_KEY" }`, mode 0600. Default location: `~/.config/skillbox/config.json`. `SKILLBOX_URL` / `SKILLBOX_TOKEN` override config. Without a URL, the CLI targets localhost, never another person's service. Keep `cli/skillbox.mjs` and `cli/package.mjs` together.

```sh
node cli/skillbox.mjs list
node cli/skillbox.mjs search "database migration"
node cli/skillbox.mjs recommend "Fix choppy scrolling in an Expo app"
node cli/skillbox.mjs load my-skill
node cli/skillbox.mjs fetch my-skill@REVISION
node cli/skillbox.mjs publish ./my-skill my-skill EXPECTED_REVISION
```

Base MCP tools: `search_skills`, `recommend_skills`, `load_skill`, `read_skill_file`, `report_skill_use`. Write/proposal tools appear according to permissions. Recommendations are additive: unqueried `search_skills` remains the mandatory task-start inventory step. Load selected skills with returned revisions before applying them.

When a client identifies its product (`X-Skillbox-Harness`, MCP `initialize` `clientInfo.name`, or an optional profile default harness), Skillbox filters **discovery** to skills that either leave `compatibility` unspecified, describe only an environment (git, docker, …), or match that product. Prefer structured frontmatter `metadata.skillbox.harnesses: [cursor, claude-code]` when a skill should not be offered to every agent; the Agent Skills `compatibility` string is the fallback. Clients that omit a harness still receive the full granted catalog. Filtering never replaces grants: `load_skill` of an explicitly named, granted skill still succeeds. The owner library UI always shows every skill, with a muted product badge when a harness policy is set.

Fetching validates every path, file hash, size, executable flag and package checksum, then writes atomically. It never runs code or installs dependencies. Revoking a key blocks future access but cannot retract already downloaded files. Bundles expand grants into deduplicated current leaf skills; references never grant access by themselves.

`scripts/install-client.py` optionally configures Codex, Claude or Cursor from explicit per-client credentials on stdin, preserving existing settings and making local backups. Review any installer before running it.

## Recommendation contract

MCP: `recommend_skills({task, limit?, offset?})`. HTTP: `POST /api/skill-recommendations` with the same JSON and authentication.

- Full authorized, enabled, non-archived leaf catalog is considered without lexical prefiltering. Maximum 200 leaves / 120,000 serialized characters; larger catalogs explicitly fall back rather than ranking a hidden subset.
- Results return `id`, immutable `referenceId`, pinned `revision`, `description`, `relevance`, `method`, `noMatch`, `hasMore`, `nextOffset`, `cacheHit` and `rubricVersion`.
- Relevance is an **uncalibrated 0–4 rubric score**, not probability. Scores ≥3 are returned, descending by score then ID. `noMatch=true` means no evaluated candidate met that threshold.
- Missing key, eight-second deadline, provider errors, malformed responses, rate limits or capacity limits use existing PostgreSQL search. Fallback responses have `method=search`, `relevance=null`, `noMatch=null`, and `fallbackReason`; empty lexical results are not claimed as a semantic no-match.
- Process-local cache: task, authenticated scope, catalog descriptions/revisions, provider-settings revision and model/rubric version. Maximum 128 entries, five-minute TTL. Two concurrent evaluations; ten uncached requests per scope/minute. No automatic retries.
- Grants, lifecycle and revisions are checked before model calls and re-read afterward, including cache hits. Key replacement/removal resets model/cache state. Stale results are discarded. Tasks and descriptions are evidence, not executable instructions.

For an optional **billable developer benchmark**, use `bun scripts/benchmark-recommendations.ts --live --provider vercel` with your own `AI_GATEWAY_API_KEY`, or `--provider typesafe` with `TYPESAFE_API_KEY` / `JEV_KEY`. This separate script does not configure the app or save credentials. Missing provider-reported cost is shown as unknown, not zero. Its small synthetic sample is not a production latency SLA or probability calibration.

## Data portability

```sh
bun scripts/import.ts /path/to/skills
SKILLBOX_EXPORT_DIR=/path/to/empty-export bun scripts/export.ts
bash scripts/backup.sh
```

The database is the source of truth; folder exports do not change it until republished. Imports preserve file bytes and unknown frontmatter, skip runtime artifacts/symlinks, and quarantine recognizable secret patterns. This is a heuristic, not a comprehensive secret audit. Do not put passwords or tokens in skill packages.

Exports contain **your skill content** and may be private. Keep exports and backups separate from public application source. An optional `scripts/export-github.sh` requires an explicit dedicated private export checkout; it is not enabled automatically.

## Verification and security

```sh
bun run typecheck
bash scripts/test-isolated.sh
```

The isolated suite creates and removes its own Compose PostgreSQL instance without published ports. It covers authorization, revisions, API/MCP behavior, CLI, encrypted settings and recommendations; image creation also builds the frontend. Never run database tests against production.

See [SECURITY.md](SECURITY.md), [deployment notes](docs/deployment.md), and [release checklist](docs/open-source-readiness.md). Skillbox is a single-owner, self-hosted application with scoped clients—not a public multi-tenant SaaS. No analytics, hosted account, preloaded catalog or automatic paid-provider connection is required.
