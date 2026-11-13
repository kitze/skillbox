# Umbrel packaging

Skillbox includes a release-gated package generator for the official Umbrel App Store and optional community stores. It does not install anything on an Umbrel device or submit a PR automatically.

## Current release gates

Before other people can install a store package, the release needs:

1. Reviewed public source/support URLs and MIT license. Do not publish old private operational history or library data with the application.
2. A publicly pullable, version-tagged Skillbox image with a multi-architecture **index digest**, containing both `linux/amd64` and `linux/arm64`.
3. Successful native/runtime testing for both architectures. Multi-arch base images alone do not prove the application runs on both.
4. Official repository lint, fresh install, restart, upgrade/persistence and browser/API testing through **Umbrel's lifecycle**, not merely raw Docker Compose.
5. Store review assets: screenshots with synthetic/demo data and the logo source (`public/app-icon.svg`). Official Umbrel maintainers host final gallery/icon assets; attach them to the PR rather than committing them into an official app package.
6. A reviewed submission PR or separately published community-store repository. Store acceptance is a separate maintainer decision.

No image URL or digest is guessed. The generator refuses moving/unpinned image references, images that cannot be inspected without registry credentials, images lacking either required architecture, a non-public project URL, or an existing output directory.

## Generate an official-store package

After publishing and testing the image, use its actual multi-arch digest:

```sh
bun scripts/package-umbrel.ts \
  --image registry/owner/skillbox:VERSION@sha256:INDEX_DIGEST \
  --source-url https://public-source.example/project \
  --support-url https://public-source.example/project/issues \
  --version VERSION \
  --out /path/to/new-submission-directory
```

Requires Bun and Docker Buildx on the packaging machine. Image inspection uses an empty temporary Docker auth config, not the maintainer's registry login. The output contains `skillbox/umbrel-app.yml`, `docker-compose.yml`, `exports.sh`, and empty persistent-data directories. Copy the `skillbox` directory into a working copy of the official `getumbrel/umbrel-apps` repository, then:

```sh
npm run lint:apps -- skillbox --check-images
```

The chosen default host port is 4791. Check it against the current store's port inventory; pass `--port` if reviewers assign another port. The container still listens internally on 4791.

Do not interpret successful generation or lint as a passing Umbrel install. The official test guide explicitly requires actual lifecycle verification. Describe any missing device/architecture test honestly in submission notes.

## Community store

Add a unique store prefix and a real publicly hosted icon URL:

```sh
bun scripts/package-umbrel.ts \
  --image registry/owner/skillbox:VERSION@sha256:INDEX_DIGEST \
  --source-url https://public-source.example/project \
  --version VERSION \
  --store-id example \
  --icon-url https://assets.example.com/skillbox.svg \
  --out /path/to/new-community-store
```

This produces root `umbrel-app-store.yml` and the consistently prefixed `example-skillbox/` app. Publish only this generated package tree to the intended public community-store repository. In Umbrel, add that repository URL through Community App Stores. Community distribution is independent of acceptance into the official store.

Publish the actual `public/app-icon.svg` as an accessible asset. Gallery screenshots can be added after capturing the tested app; do not use placeholder artwork or private user content.

## Runtime behavior

- `app_proxy` stays enabled for the UI. Only `/api/*`, `/mcp`, `/cli/*` and `/bootstrap/*` bypass **Umbrel proxy** auth so bearer-token clients and installers work. Skillbox still enforces its own authentication on protected API/MCP routes; login and static bootstrap/CLI files remain intentionally public.
- `APP_PASSWORD` becomes the Skillbox owner login key, surfaced by Umbrel's app-password UI through `deterministicPassword: true`. It is not logged, hardcoded or used as a provider API key.
- PostgreSQL gets a separate deterministic, purpose-specific secret from `derive_entropy`, scoped using `EXPORTS_APP_ID`. It is not regenerated on restart/update.
- No provider key is supplied by the package. Select OpenRouter, TypeSafe AI, or Vercel AI Gateway and add its own key in Skillbox Settings if you want Jev.
- Canonical browser origin uses `http://${DEVICE_DOMAIN_NAME}:${APP_PROXY_PORT}`. Use the Umbrel launch hostname. Custom IP, Tor or HTTPS ingress origins require deliberate app configuration; the package does not wildcard CSRF origins.
- App state and PostgreSQL live under `${APP_DATA_DIR}/data/...`. No database port, Docker socket, host network or special Umbrel permissions are exposed.
- Internal service hostnames include the app ID so a shared Umbrel network cannot accidentally resolve another app's database alias.
- The app runs as UID/GID 1000, read-only outside mounted state and `/tmp`. The official Postgres entrypoint initializes/owns its bind mount and drops privileges.

Umbrel LAN URLs are commonly HTTP. Prefer HTTPS or a trusted SSH tunnel for agent access. For a deliberately trusted LAN, the CLI supports explicit `allowInsecureHttp: true` in its protected config or `SKILLBOX_ALLOW_INSECURE_HTTP=1`. HTTP sends credentials and content unencrypted; never enable that for an untrusted/public network.

## Test checklist

Use a dedicated test Umbrel, or explicit owner approval for installing the isolated app on an existing device. Never overwrite someone else's app data or change network/proxy services to make a packaging test pass.

- Install from the actual store source; open through the Umbrel launcher.
- Log in with the displayed app password; verify the library and optional integrations start empty/unconfigured.
- Create a demo skill/profile/client; exercise unqueried browse, load, pinned file fetch and recommendations without a Gateway key.
- Verify API/MCP requests without Skillbox credentials fail, and a scoped bearer client works through the proxy whitelist.
- Save/remove a synthetic Gateway key in Settings; verify no secret is returned by status APIs. Do not send a synthetic key to the provider.
- Restart and perform a real version upgrade; verify revisions, clients and encrypted settings persist.
- Test backup/restore without changing the matching instance secrets. Moving a database to another device without its matching owner/encryption material can make saved integration credentials unreadable.
- Inspect logs for errors or secrets and confirm the API's exact published URL/certificate behavior.
- Report each tested architecture/device/version. Do not claim arm64, upgrade, Tor or store acceptance from an amd64 Compose smoke test.

## Official references

Requirements checked against the current official guides on 2026-09-17; re-check before submission:

- https://github.com/getumbrel/umbrel-apps
- https://github.com/getumbrel/umbrel-apps/blob/master/.claude/skills/umbrel-package-app/SKILL.md
- https://github.com/getumbrel/umbrel-apps/blob/master/.claude/skills/umbrel-test-app/SKILL.md
- https://github.com/getumbrel/umbrel-apps/blob/master/.claude/skills/umbrel-develop-app/SKILL.md
- https://github.com/getumbrel/umbrel-community-app-store
