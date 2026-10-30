# Skills over MCP

Skillbox serves the official [`io.modelcontextprotocol/skills`
extension](https://modelcontextprotocol.io/extensions/skills/overview) on MCP
protocol revision **2026-07-28**, alongside its existing tool-based API.
Standards compatibility is not affiliation with or endorsement by the MCP project.

The native discovery/resource design and MIME mapping integrate work contributed
by **Matt Van Horn (@mvanhorn)** in [PR #2](https://github.com/kitze/skillbox/pull/2),
combined with Skillbox's compatibility audit, canonical URI encoding, verified
reads and current authorization safeguards. The PR was closed for manual
integration, not discarded. No contributor evidence binaries are shipped.

## Endpoint and negotiation

Use the existing authenticated `/mcp` endpoint and client Bearer key. No new
credentials, database migration or content migration is required.

The server uses the stable `@modelcontextprotocol/server` **2.0.0** SDK. Its
modern HTTP handler validates the per-request envelope, answers `server/discover`,
and supplies wire result discriminators and server identity. Application handlers
do not hand-roll the base protocol or double-inject `resultType`.

The separate outbound Executor connector still uses SDK v1.30.0 for its existing
OAuth/client flow. Both SDKs coexist at wire/process boundaries; no SDK objects
cross between them. This avoids coupling the inbound server upgrade to an
unrelated OAuth migration.

A modern discovery response advertises:

```json
{
  "resources": {},
  "extensions": {
    "io.modelcontextprotocol/skills": {}
  }
}
```

- `skills/list` returns complete entries for compatible, authorized, active leaf
  skills, using `cursor` / `nextCursor` pagination.
- `skills/get` accepts a canonical `SKILL.md` URI independently of prior listing.
- `resources/read` serves each file in the manifest, including binaries as blobs.
- `resources/list` lists `SKILL.md` resources; `resources/templates/list` is empty.
- Optional `resources/directory/read` is not advertised or implemented. Complete
  manifests already enumerate supporting files.

Modern responses carry `resultType: "complete"` on the wire. Skills metadata
uses `ttlMs: 0` and `cacheScope: "private"`; SDK core responses use private,
zero-TTL defaults. Every request reauthenticates and applies current grants.
HTTP `Cache-Control: no-store` remains in place. Cached catalog data is not proof
of continuing access, and digests are not a substitute for authorization.

Each catalog page expands grants once and loads current skill/revision pairs in
one joined query, rather than repeating graph expansion and revision lookups
for every entry. Publication can change a later page; paging is not a global
catalog snapshot. An incompatible page can be empty with `nextCursor`; clients
must continue until no cursor is returned.

### Legacy compatibility

Requests using the 2025 `initialize` handshake still receive the same JSON-only
stateless transport and tool set (reader 5 / owner 9). The extension is not
advertised on legacy connections, and native Skills methods are not registered
there. Upgrading does not force old clients to understand the new envelope.

`search_skills`, `recommend_skills`, `load_skill`, `read_skill_file`, usage
reporting, publishing, proposals and archive tools remain available. Existing
bootstrap clients still use unqueried `search_skills` inventory and pinned
revision reads. Native hosts use their own skill-loading machinery.

The stdio CLI forwards both legacy messages and modern per-request envelopes
to the same endpoint. It returns full protocol error envelopes, including
modern HTTP 400 negotiation errors; it does not silently translate them into
internal errors. Human CLI commands continue using the HTTP API.

## Canonical identity and content

```text
skill://skillbox/<referenceId>/<name>/SKILL.md
skill://skillbox/<referenceId>/<name>/references/guide.md
```

The directory name matches frontmatter `name`; UUIDs preserve identity across
content revisions. File path segments are percent-encoded, including spaces,
`%`, `?` and `#`. Traversal, malformed escapes and non-canonical aliases are
rejected. The `skillbox` authority is a namespace, not a DNS destination.

Canonical URIs stay stable across publications. A new revision changes the
manifest's digests; hosts must reject stale reads, refresh metadata and obtain
any required approval again. Existing revision-pinned tools and CLI fetch remain
available when a caller needs an immutable package snapshot.

Entries preserve actual parsed `SKILL.md` frontmatter and include every file's
URI, raw byte size and `sha256:<hex>` digest. The server verifies stored bytes
before serving them. Text preserves UTF-8 bytes, including BOM/CRLF; binary or
non-UTF-8 files use base64. Scripts are delivered, never executed.

Legacy `skill://UUID` links remain supported by Skillbox tools. They are not
native resource aliases: introducing a UUID-only directory that disagrees with
`name`, or returning a different canonical skill identity, would confuse host
registries. Future copy-reference UI improvements should generate canonical
resource URIs without silently rewriting existing skill revisions.

Authorization, active lifecycle and current-revision data are checked when a
request is admitted. Each skill/revision pair is read from one database snapshot;
already admitted or downloaded content cannot be retroactively retracted.

## Compatibility audit and manifest preview

```sh
node cli/skillbox.mjs audit
node cli/skillbox.mjs manifest my-skill
```

- `GET /api/skill-compatibility?offset=0` is owner-only and paginated. It includes
  archived/disabled leaf skills for remediation, but not bundles.
- `audit` walks all pages, prints counts and per-skill issues, and exits 1 for
  incompatible packages. Warnings do not affect the exit status.
- `GET /api/skills/:id/manifest` requires read access to an active compatible
  skill. It returns `skill`, Skillbox `revision`, and `warnings`.
- Incompatible preview requests return 422. Native unknown, unauthorized,
  inactive or incompatible URIs return JSON-RPC `-32602`; internal failures
  return `-32603` without exposing internals.

The audit never repairs or republishes content. It checks names and lengths,
strict UTF-8/YAML, JSON-safe verbatim frontmatter, standard optional fields,
paths, digests, sizes and portability limits. Legacy malformed-YAML normalization
is not used. Unsupported packages remain available through existing tools,
and the owner can remediate them through explicit conflict-checked revisions.

Treat audit output as private inventory; never commit personal skill contents or
inventory to public source/issues. This is compatibility checking, not a
malicious-instruction or secret-safety certification.

Package admission limits remain 400 files / 8 MB / 2 MB per file. These lower
server-side limits do not violate the extension's recommended server maxima
(512 files / 16 MiB). Hosts, not servers, must accept packages up to those maxima.

## Verification and remaining boundaries

The isolated suite exercises released-protocol discovery, private cache hints,
metadata validation, complete paged manifests, direct lookup, live revision and
grant changes, resource byte verification, binary MIME types, script nonexecution,
the stdio bridge, and old tool behavior. A real official SDK v2 client negotiates
2026-07-28 and reads the server in-process; it is not a fabricated protocol mock.

The published `@modelcontextprotocol/conformance` 0.1.16 CLI was inspected:
its server scenario list targets 2025-06-18/2025-11-25 and contains no Skills or
2026-07-28 scenarios. No upstream native-suite pass is claimed; rerun against a
release that includes them. The released-wire checks here run through the SDK
v2 client and raw HTTP envelopes instead.

Passing these checks is not an official certification or a claim that every
agent host supports the extension. Client approval UI, origin-bound caches,
frontmatter verification and activation semantics are host responsibilities.
Skillbox authorizes delivery; publication approval does not authorize execution.
SHA-256 from the content server establishes consistency, not author trust.

Before advertising compatibility with a named host, run its actual verified
skill-loading path. Before claiming official conformance, run the relevant
released conformance scenarios and record their exact version and results.
Keep optional directory reads, nested auto-activation and server-side skill
execution out of scope. Hosted product work is tracked in
[the hosted roadmap](hosted-roadmap.md), not implemented by this transport change.

## Sources

- [Released Skills specification](https://github.com/modelcontextprotocol/ext-skills/blob/main/specification/stable/skills.mdx)
- [Agent Skills format](https://agentskills.io/specification)
- [SDK v2 protocol migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28.html)
- [Client support matrix](https://modelcontextprotocol.io/extensions/client-matrix)
- [Original contribution](https://github.com/kitze/skillbox/pull/2)
