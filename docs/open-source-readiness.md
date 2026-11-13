# Source release checklist

## Portable application

- MIT license is included.
- New databases start empty: no skills, client credentials, provider keys or external MCP endpoint is seeded.
- Defaults target localhost. Browser-origin aliases and cross-origin OAuth compatibility are explicit deployment configuration, empty by default.
- Optional Jev requires an owner-saved OpenRouter, TypeSafe AI, or Vercel AI Gateway key in Settings, with separate credentials per provider. Optional Executor requires an owner-configured endpoint and authentication.
- Saved integration secrets use authenticated encryption and are never returned by status APIs.
- The setup helper generates unique credentials, writes mode 0600, prints no values and refuses to overwrite an existing environment.
- Docker build inputs are allowlisted. Local data, backups, environment files, agent logs and operational notes are excluded from build stages and the final image.
- Personal curation/migration tooling and deployment inventories do not belong in the reusable source distribution. Private skill libraries and database exports remain separate.

## Before making any repository public

1. Run typecheck and the isolated tests/build from the exact candidate commit. Verify a fresh instance and Settings with a synthetic key, not someone else's credential.
2. Scan the exact source archive and every Git ref/history you intend to expose for secrets. Review reported candidates without printing secret values.
3. Inspect historical operational notes and deleted files. A cleanup commit does not erase earlier versions. For a repository with personal history, publish a reviewed clean-history source snapshot instead of changing the original repository's visibility.
4. Keep the original private history, library content, credentials, backups and deployment environment private. Do not upload the whole working directory, Docker build cache, or `.git` directory as release assets.
5. Verify the selected source license, dependency licenses, private vulnerability-reporting channel and release contents.
6. Obtain explicit publication approval for the chosen repository. Preparing source does not itself change visibility, enable Actions, deploy services or migrate installed clients.

A source snapshot can be produced from a reviewed committed tree with `git archive --format=tar.gz --output=/path/outside/repository/skillbox-source.tar.gz HEAD`. That contains tracked files at one commit, not Git history; verify its extracted contents and secret scan before publishing. Do not publish an archive from an unreviewed commit or accidentally include private exports alongside it.

Secret-scanner success is evidence, not proof that no secret or personal detail ever existed. Record the scanner version, scope, tested commit and results in private release evidence. Any real exposed credential must be revoked/rotated at its issuer before public release; deleting its current file is not sufficient.

This is a single-owner self-hosted developer application, not an internet-ready multi-tenant SaaS. Incoming client OAuth, account recovery, hosted quotas and tenant isolation are separate projects. Static bearer headers and the stdio bridge are the supported client setup paths.
