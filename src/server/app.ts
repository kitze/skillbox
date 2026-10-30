import * as access from "./access";
import * as executor from "./executor";
import * as gateway from "./gateway";
import { appOrigin as origin, allowedOrigins } from "./config";
import { parseSkillIcon } from "../skill-icons";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { eq, desc, lt, and, sql } from "drizzle-orm";
import { db } from "./db";
import { clients, sessions, events, profiles, skills } from "./schema";
import {
  authenticate,
  isAdminToken,
  createClient,
  assertAdmin,
  token,
} from "./auth";
import * as lib from "./library";
import { handleMcp, fileSchema } from "./mcp";
import type { Principal } from "../shared";
import { recommendationInput } from "./recommendations";
import { compatibilityPage, manifestFor } from "./skill-resources";
import {
  githubImportInput,
  parseGitHubUrl,
  prepareGitHubImport,
} from "./github-import";
export const app = new Hono<{ Variables: { principal: Principal } }>();
const loginAttempts: number[] = [];
app.use("*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  c.header("Cache-Control", "no-store");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  await next();
});
app.use("*", bodyLimit({ maxSize: 12_000_000 }));
app.onError((e, c) => {
  if (e instanceof lib.Problem)
    return c.json({ error: e.message }, e.status as any);
  if (e instanceof z.ZodError)
    return c.json(
      {
        error: "Invalid request",
        issues: e.issues.map((i) => ({ path: i.path, message: i.message })),
      },
      400,
    );
  console.error("Request failed", e instanceof Error ? e.name : "unknown");
  return c.json({ error: "Internal service error" }, 500);
});
app.get("/healthz", async (c) => {
  await db.execute("select 1");
  return c.json({ ok: true, service: "skillbox" });
});
app.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const provided = c.req.header("Origin");
    if (provided && !allowedOrigins().has(provided))
      throw new lib.Problem(403, "Origin not allowed");
    if (
      !c.req.header("Authorization") &&
      (!provided || !allowedOrigins().has(provided))
    )
      throw new lib.Problem(403, "Origin is required");
  }
  await next();
});
app.post("/api/login", async (c) => {
  const { key } = z
    .object({ key: z.string().min(1).max(512) })
    .parse(await c.req.json());
  const now = Date.now();
  while (loginAttempts.length && loginAttempts[0] < now - 60000)
    loginAttempts.shift();
  if (loginAttempts.length >= 10)
    throw new lib.Problem(429, "Too many attempts. Try again in a minute.");
  if (!isAdminToken(key)) {
    loginAttempts.push(now);
    throw new lib.Problem(401, "Invalid access key");
  }
  const secret = token();
  await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date().toISOString()));
  await db.insert(sessions).values({
    hash: lib.sha256(secret),
    expiresAt: new Date(now + 86400000).toISOString(),
  });
  setCookie(c, "skillbox_session", secret, {
    httpOnly: true,
    secure: origin().startsWith("https:"),
    sameSite: "Strict",
    path: "/",
    maxAge: 86400,
  });
  return c.json({ ok: true });
});
app.post("/api/logout", async (c) => {
  const value = getCookie(c, "skillbox_session");
  if (value)
    await db.delete(sessions).where(eq(sessions.hash, lib.sha256(value)));
  deleteCookie(c, "skillbox_session", { path: "/" });
  return c.json({ ok: true });
});
app.use("/api/*", async (c, next) => {
  c.set("principal", await authenticate(c.req.raw, true));
  await next();
});
app.get("/api/settings/ai-gateway", async (c) => {
  assertAdmin(c.get("principal"));
  return c.json(await gateway.gatewaySettings());
});
app.put("/api/settings/ai-gateway", async (c) => {
  assertAdmin(c.get("principal"));
  return c.json(
    await gateway.configureGateway(
      gateway.gatewayInput.parse(await c.req.json()),
    ),
  );
});
app.get("/api/me", (c) =>
  c.json({ name: c.get("principal").name, role: c.get("principal").role }),
);
app.put("/api/bundles/:id", async (c) => {
  const b = z
    .object({
      title: z.string().min(1).max(160),
      description: z.string().min(1).max(3000),
      members: z.array(z.string()).max(200),
      expectedRevision: z.string().nullable(),
    })
    .parse(await c.req.json());
  return c.json(
    await lib.saveBundle(
      c.get("principal"),
      c.req.param("id"),
      b.title,
      b.description,
      b.members,
      b.expectedRevision,
    ),
  );
});
app.get("/api/skills", async (c) => {
  const q = z
    .object({
      query: z.string().max(300).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
      offset: z.coerce.number().int().nonnegative().optional(),
      includeArchived: z.enum(["true", "false"]).optional(),
      includeDisabled: z.enum(["true", "false"]).optional(),
      kind: z.enum(["skill", "bundle", "all"]).optional(),
      metrics: z.enum(["true", "false"]).optional(),
    })
    .parse(c.req.query());
  const kinds: ("skill" | "bundle")[] =
    q.kind === "skill"
      ? ["skill"]
      : q.kind === "bundle"
        ? ["bundle"]
        : ["skill", "bundle"];
  return c.json(
    await lib.search(
      c.get("principal"),
      q.query,
      q.limit,
      q.offset,
      q.includeArchived === "true",
      q.includeDisabled === "true",
      kinds,
      q.metrics === "true",
    ),
  );
});
app.post("/api/skill-recommendations", async (c) => {
  const input = recommendationInput.parse(await c.req.json());
  return c.json(
    await lib.recommendSkills(
      () => authenticate(c.req.raw, true),
      input,
      c.req.raw.signal,
    ),
  );
});
app.post("/api/imports/github/preview", async (c) => {
  const principal = c.get("principal");
  assertAdmin(principal);
  const prepared = await prepareGitHubImport(
    githubImportInput.parse(await c.req.json()),
    c.req.raw.signal,
  );
  if (prepared.kind === "catalog") return c.json(prepared);
  const [existing] = await db
    .select()
    .from(skills)
    .where(eq(skills.id, prepared.id));
  if (
    existing &&
    (existing.kind !== "skill" || existing.disabled || existing.archived)
  )
    throw new lib.Problem(
      409,
      "Existing entry is a bundle, disabled or archived; resolve that before importing",
    );
  return c.json({
    ...prepared,
    files: prepared.files.map(({ content, ...file }) => file),
    expectedRevision: existing?.revision ?? null,
  });
});
app.post("/api/imports/github/publish", async (c) => {
  const principal = c.get("principal");
  assertAdmin(principal);
  const input = z
    .object({
      url: z.string().max(2048),
      id: z.string().max(80),
      expectedRevision: z.string().nullable(),
    })
    .strict()
    .parse(await c.req.json());
  const target = parseGitHubUrl(input.url);
  if (
    target.kind !== "tree" ||
    !/^[0-9a-f]{40}$/.test(target.segments[0] ?? "")
  )
    throw new lib.Problem(
      400,
      "Preview first; publishing requires a commit-pinned GitHub URL",
    );
  const prepared = await prepareGitHubImport(
    { url: input.url },
    c.req.raw.signal,
  );
  if (prepared.kind !== "skill" || prepared.id !== input.id)
    throw new lib.Problem(400, "Preview and imported skill do not match");
  const [existing] = await db
    .select()
    .from(skills)
    .where(eq(skills.id, prepared.id));
  if (
    existing &&
    (existing.kind !== "skill" || existing.disabled || existing.archived)
  )
    throw new lib.Problem(
      409,
      "Existing entry is a bundle, disabled or archived; resolve that before importing",
    );
  return c.json(
    await lib.publish(
      principal,
      prepared.id,
      prepared.files,
      input.expectedRevision,
      `Import ${prepared.source.repository}@${prepared.source.commit.slice(0, 12)}`,
      undefined,
      { source: prepared.source },
    ),
  );
});
app.get("/api/skill-compatibility", async (c) => {
  const { offset } = z
    .object({
      offset: z.coerce.number().int().min(0).max(99_999_999).default(0),
    })
    .parse(c.req.query());
  return c.json(await compatibilityPage(c.get("principal"), offset));
});
app.get("/api/skills/:id/manifest", async (c) =>
  c.json(await manifestFor(c.get("principal"), c.req.param("id"))),
);
app.get("/api/skill-references/:referenceId", async (c) =>
  c.json(
    await lib.resolveSkillReference(
      c.get("principal"),
      c.req.param("referenceId"),
    ),
  ),
);
app.get("/api/skills/:id", async (c) =>
  c.json(
    await lib.load(
      c.get("principal"),
      c.req.param("id"),
      c.req.query("revision"),
    ),
  ),
);
app.get("/api/skills/:id/file", async (c) => {
  const { revision, path } = z
    .object({ revision: z.string(), path: z.string() })
    .parse(c.req.query());
  return c.json(
    await lib.readFile(c.get("principal"), c.req.param("id"), revision, path),
  );
});
app.get("/api/skills/:id/bundle", async (c) => {
  const r = await lib.revisionFor(
    c.get("principal"),
    c.req.param("id"),
    c.req.query("revision"),
  );
  await lib.record(c.get("principal"), "bundle", r.skillId, { revision: r.id });
  return c.json({
    format: "skillbox/v1",
    id: r.skillId,
    revision: r.id,
    checksum: r.checksum,
    files: r.files,
  });
});
app.get("/api/skills/:id/history", async (c) =>
  c.json(await lib.history(c.get("principal"), c.req.param("id"))),
);
app.patch("/api/skills/:id/icon", async (c) => {
  const body = z
    .object({ icon: z.unknown(), expectedRevision: z.string() })
    .parse(await c.req.json());
  let icon;
  try {
    icon = parseSkillIcon(body.icon);
  } catch (e) {
    throw new lib.Problem(400, (e as Error).message);
  }
  return c.json(
    await lib.setIcon(
      c.get("principal"),
      c.req.param("id"),
      icon,
      body.expectedRevision,
    ),
  );
});
app.patch("/api/skills/:id/status", async (c) => {
  const body = z
    .object({ disabled: z.boolean(), expectedRevision: z.string() })
    .parse(await c.req.json());
  return c.json(
    await lib.setDisabled(
      c.get("principal"),
      c.req.param("id"),
      body.disabled,
      body.expectedRevision,
    ),
  );
});
app.put("/api/skills/:id", async (c) => {
  const body = z
    .object({
      expectedRevision: z.string().nullable(),
      files: z.array(fileSchema).max(400),
      message: z.string().max(200).optional(),
    })
    .parse(await c.req.json());
  return c.json(
    await lib.publish(
      c.get("principal"),
      c.req.param("id"),
      body.files,
      body.expectedRevision,
      body.message,
    ),
  );
});
app.post("/api/skills/:id/restore", async (c) => {
  const body = z
    .object({ revision: z.string(), expectedRevision: z.string() })
    .parse(await c.req.json());
  const r = await lib.revisionFor(
    c.get("principal"),
    c.req.param("id"),
    body.revision,
  );
  return c.json(
    await lib.publish(
      c.get("principal"),
      r.skillId,
      r.files,
      body.expectedRevision,
      "Restore " + r.id.slice(0, 8),
      undefined,
      { source: r.source ?? undefined },
    ),
  );
});
app.get("/api/profiles", async (c) => {
  assertAdmin(c.get("principal"));
  return c.json(await db.select().from(profiles).orderBy(profiles.name));
});
app.post("/api/profiles", async (c) =>
  c.json(
    await access.saveProfile(
      c.get("principal"),
      access.profileSchema.parse(await c.req.json()),
    ),
  ),
);
app.put("/api/profiles/:id", async (c) => {
  const body = access.profileSchema
    .extend({ version: z.string() })
    .parse(await c.req.json());
  return c.json(
    await access.saveProfile(
      c.get("principal"),
      body,
      c.req.param("id"),
      body.version,
    ),
  );
});
app.delete("/api/profiles/:id", async (c) => {
  assertAdmin(c.get("principal"));
  const id = c.req.param("id");
  return c.json(
    await db.transaction(async (tx) => {
      await tx.select().from(profiles).where(eq(profiles.id, id)).for("update");
      if (
        (await tx.select().from(clients).where(eq(clients.profileId, id)))
          .length
      )
        throw new lib.Problem(
          409,
          "Reassign this profile’s clients before deleting it",
        );
      await tx.delete(profiles).where(eq(profiles.id, id));
      return { ok: true };
    }),
  );
});
app.get("/api/clients", async (c) => {
  assertAdmin(c.get("principal"));
  return c.json(
    await db
      .select({
        id: clients.id,
        name: clients.name,
        profileId: clients.profileId,
        active: clients.active,
        createdAt: clients.createdAt,
        lastSeen: sql<
          string | null
        >`(SELECT max(events.created_at) FROM events WHERE events.client_id=clients.id)`,
      })
      .from(clients)
      .orderBy(clients.name),
  );
});
app.post("/api/clients", async (c) => {
  assertAdmin(c.get("principal"));
  const b = z
    .object({
      name: z.string().trim().min(1).max(80),
      profileId: z.string().min(1),
    })
    .strict()
    .parse(await c.req.json());
  return c.json(await access.uniqueClient(b.name, b.profileId));
});
app.patch("/api/clients/:id", async (c) => {
  assertAdmin(c.get("principal"));
  const b = z
    .object({
      active: z.boolean().optional(),
      profileId: z.string().optional(),
      name: z.string().trim().min(1).max(80).optional(),
    })
    .strict()
    .parse(await c.req.json());
  if (
    b.profileId &&
    !(await db.select().from(profiles).where(eq(profiles.id, b.profileId)))
      .length
  )
    throw new lib.Problem(404, "Profile not found");
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('skillbox-client-names'))`,
    );
    const [current] = await tx
      .select()
      .from(clients)
      .where(eq(clients.id, c.req.param("id")));
    if (!current) throw new lib.Problem(404, "Client not found");
    if (b.active ?? current.active) {
      const name = b.name ?? current.name;
      if (
        (
          await tx
            .select()
            .from(clients)
            .where(
              sql`lower(trim(${clients.name}))=lower(${name}) AND ${clients.active}=true AND ${clients.id}<>${current.id}`,
            )
        ).length
      )
        throw new lib.Problem(409, "An active client already has this name");
    }
    await tx.update(clients).set(b).where(eq(clients.id, current.id));
  });
  return c.json({ ok: true });
});
app.post("/api/skills/:id/proposals", async (c) => {
  const b = z
    .object({
      files: z.array(fileSchema).max(400),
      expectedRevision: z.string(),
      message: z.string().trim().min(1).max(200),
    })
    .parse(await c.req.json());
  return c.json(
    await access.propose(
      c.get("principal"),
      c.req.param("id"),
      b.files,
      b.expectedRevision,
      b.message,
    ),
  );
});
app.get("/api/proposals", async (c) =>
  c.json(await access.listProposals(c.get("principal"))),
);
app.get("/api/proposals/:id", async (c) =>
  c.json(await access.proposalDetail(c.get("principal"), c.req.param("id"))),
);
app.post("/api/proposals/:id/review", async (c) => {
  const b = z
    .object({ decision: z.enum(["approve", "reject"]) })
    .parse(await c.req.json());
  return c.json(
    await access.reviewProposal(
      c.get("principal"),
      c.req.param("id"),
      b.decision,
    ),
  );
});
app.delete("/api/skills/:id", async (c) => {
  const b = z
    .object({ expectedRevision: z.string() })
    .parse(await c.req.json());
  return c.json(
    await lib.archiveSkill(
      c.get("principal"),
      c.req.param("id"),
      b.expectedRevision,
    ),
  );
});
app.get("/api/settings/executor", async (c) => {
  assertAdmin(c.get("principal"));
  return c.json(await executor.executorSettings());
});
app.put("/api/settings/executor", async (c) => {
  assertAdmin(c.get("principal"));
  const b = z
    .object({
      endpoint: z.string().url().max(2048),
      bearer: z.string().max(8192).optional(),
    })
    .parse(await c.req.json());
  return c.json(await executor.configureExecutor(b.endpoint, b.bearer));
});
app.post("/api/executor/connect", async (c) => {
  assertAdmin(c.get("principal"));
  return c.json(await executor.authorizeExecutor());
});
app.post("/api/executor/disconnect", async (c) => {
  assertAdmin(c.get("principal"));
  return c.json(await executor.disconnectExecutor());
});
app.get("/api/executor/callback", async (c) => {
  assertAdmin(c.get("principal"));
  const code = c.req.query("code"),
    state = c.req.query("state");
  if (!code || !state)
    throw new lib.Problem(400, "Authorization was not completed");
  await executor.authorizeExecutor(code, state);
  return c.redirect("/settings");
});
app.get("/api/executor/integrations", async (c) => {
  assertAdmin(c.get("principal"));
  return c.json(
    await executor.executorCatalog(c.req.query("refresh") === "true"),
  );
});
app.get("/api/events", async (c) => {
  assertAdmin(c.get("principal"));
  const q = z
    .object({
      skillId: z.string().optional(),
      operation: z.enum(["reads", "usage", "legacy", "web"]).optional(),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .parse(c.req.query());
  const filters = [];
  if (q.skillId) filters.push(eq(events.skillId, q.skillId));
  if (q.operation === "usage")
    filters.push(eq(events.operation, "reported_use"));
  if (q.operation === "reads")
    filters.push(
      sql`${events.operation} IN ('load','read_file','bundle') AND ${events.context}->>'source' IN ('mcp','cli')`,
    );
  if (q.operation === "legacy")
    filters.push(sql`COALESCE(${events.context}->>'source','legacy')='legacy'`);
  if (q.operation === "web")
    filters.push(sql`${events.context}->>'source'='web'`);
  return c.json(
    await db
      .select()
      .from(events)
      .where(and(...filters))
      .orderBy(desc(events.createdAt), events.id)
      .limit(100)
      .offset(q.offset),
  );
});
app.patch("/api/skills/:id/integrations", async (c) => {
  const body = z
    .object({
      integrations: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)).max(30),
      expectedRevision: z.string(),
    })
    .parse(await c.req.json());
  return c.json(
    await lib.setIntegrations(
      c.get("principal"),
      c.req.param("id"),
      body.integrations,
      body.expectedRevision,
    ),
  );
});
app.post("/mcp", async (c) => {
  const provided = c.req.header("Origin");
  if (provided && !allowedOrigins().has(provided))
    throw new lib.Problem(403, "Origin not allowed");
  return handleMcp(c.req.raw, await authenticate(c.req.raw));
});
app.on(["GET", "DELETE"], "/mcp", async (c) => {
  await authenticate(c.req.raw);
  return c.json({ error: "Use POST for stateless MCP" }, 405);
});
app.get("/bootstrap/SKILL.md", async (c) =>
  c.text(await Bun.file("bootstrap/SKILL.md").text()),
);
app.get("/cli/skillbox.mjs", async (c) => {
  c.header("Content-Type", "text/javascript");
  return c.body(await Bun.file("cli/skillbox.mjs").text());
});
app.get("/cli/package.mjs", async (c) => {
  c.header("Content-Type", "text/javascript");
  return c.body(await Bun.file("cli/package.mjs").text());
});
app.use("/assets/*", serveStatic({ root: "./dist" }));
app.get("/favicon.svg", async (c) => {
  const f = Bun.file("./dist/favicon.svg");
  if (!(await f.exists())) return c.notFound();
  c.header("Content-Type", "image/svg+xml");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(await f.text());
});
app.get("*", async (c) => {
  const f = Bun.file("./dist/index.html");
  return (await f.exists())
    ? c.html(await f.text())
    : c.text("Skillbox API is running. Build the web UI to open the library.");
});
