# Hosted Skillbox roadmap

This is a product direction and release-gate checklist, not a claim that the
current single-owner application is ready for untrusted multi-tenant hosting.
No billing, registration, public catalog, or hosted deployment is enabled here.

## Product boundary

MCP standardizes delivery, not the library-management product. Skillbox's
remaining value is editing and review, immutable versions and rollback,
profiles and access, curated bundles, task-aware recommendations, and usage
visibility. The same core should power self-hosted and managed deployments.

Keep standards-based reads and portable exports in the core. Charge for running
the service and collaboration rather than an incompatible wire format. Do not
promise MCP endorsement or call Skillbox an official MCP product.

## Sequence

### 1. Native provider readiness

Complete [MCP Skills release gates](mcp-skills.md). Keep old clients functional,
publish exact verified compatibility, and make remediation actionable before
adding unrelated platform features. No separate hosted fork.

### 2. Small managed pilot: isolated instances

Start with a bounded number of managed single-owner installations rather than
retrofitting every table for shared tenancy before demand exists. Each customer
gets an isolated application/database/config/backup boundary and independent
secrets. A subdomain or profile alone is not tenant isolation.

Before charging or accepting customer data:

- Automate provisioning, version-pinned upgrades, health checks and rollback.
- Verify encrypted backups, independent restore drills, export, cancellation,
  deletion, retention and recovery ownership.
- Separate operational credentials from customer client keys; define support
  access and incident procedures. Never log skill bodies or credentials.
- Enforce storage, request-body, request-rate and concurrency quotas. Account
  for private skills as potentially sensitive data and prompt-injection content.
- Add customer login/session lifecycle appropriate to hosting; do not turn the
  shared owner-token UI into a multi-user product by sharing that token.
- Resolve encryption key lifecycle: integration credentials currently derive
  their encryption key from the owner token. Hosting needs deliberate key
  custody/rotation/recovery, not silent token changes that lose credentials.
- Document service terms, privacy, subprocessors, data location and paid-provider
  behavior. Keep Jev BYOK initially; do not silently subsidize or forward data.
- Verify purchase/provisioning idempotency, billing webhook signatures,
  cancellation and entitlement behavior before switching billing live.
- Define operating costs and support capacity before promising uptime or pricing.

This pilot still requires a hosting control plane and operational work. It is
not safe to expose today's admin endpoint and call that a SaaS launch.

### 3. Collaboration after demonstrated demand

Add organizations, owner/admin/editor/reader roles, review policies, service
accounts, scoped audit logs and customer-visible usage. Existing profiles are
client permission sets inside one owner space, not organizations or accounts.

If moving to shared tenancy, require explicit workspace ownership throughout
skills, revisions, grants, profiles, tokens, proposals, events, settings,
secrets, caches, exports and backups. Enforce boundaries centrally and test
cross-tenant failures. Database policies and application checks must agree;
adding `workspace_id` to one table is insufficient. Plan migration and restores
before moving the managed pilot onto shared infrastructure.

## Commercial hypotheses to validate

- Personal: managed private library, sync across hosts, backups and revisions.
- Team: shared library, reviews, roles, audit history and deployment policies.
- Larger organizations: SSO, retention controls and private deployment/support.

These are hypotheses, not committed tiers or prices. Validate willingness to
pay with pilot customers and measured operating cost before implementing an
entitlement matrix. Public marketplace, arbitrary server-side script execution,
metered model resale and complex enterprise policy engines are out of scope.

## Go-to-market evidence

Publish a small empty-instance demo library with generic, explicitly licensed
skills, verifiable manifests and reproducible setup. Never export the operator's
personal library as demo content. Once interoperable, contribute an accurately
scoped implementation entry and public conformance evidence; upstream work
requires its own reviewed submission. Keep factual compatibility notes rather
than unsupported security, endorsement or adoption claims.
