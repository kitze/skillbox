import { test, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { app } from "../src/server/app";
import { migrate, db, connection } from "../src/server/db";
import {
  clients,
  skills,
  revisions,
  events,
  profiles,
  proposals,
} from "../src/server/schema";
import { eq, inArray } from "drizzle-orm";
import {
  ADMIN,
  makeFile,
  publish,
  revisionFor,
  validateFiles,
  safePath,
  metadata,
  saveBundle,
  load,
  search,
  setDisabled,
  setIcon,
  recommendationCatalog,
  recommendSkills,
  archiveSkill,
  servedSkillRevision,
} from "../src/server/library";
import { createRecommender, EvaluationUnavailable } from "../src/server/recommendations";
import * as access from "../src/server/access";
import { authenticate, createClient } from "../src/server/auth";
import type { Principal } from "../src/shared";
const ids = [
  "test-a-" + randomUUID().slice(0, 8),
  "test-b-" + randomUUID().slice(0, 8),
];
let allowedToken = "",
  clientId = "",
  firstRevision = "";
const graphIds = Array.from(
  { length: 4 },
  (_, i) => `test-bundle-${i}-${randomUUID().slice(0, 8)}`,
);
const disabledIds = Array.from(
  { length: 4 },
  (_, i) => `test-disabled-${i}-${randomUUID().slice(0, 8)}`,
);
const files = (id: string, body = "Read the docs.") => [
  makeFile(
    "SKILL.md",
    `---\nname: ${id}\ndescription: Quality workflow for a fixture\n---\n\n${body}`,
  ),
  makeFile("references/guide.md", "Reference content"),
];
const headers = () => ({ Authorization: "Bearer " + allowedToken });
beforeAll(async () => {
  await migrate();
  // The isolated test database starts with no content or third-party configuration.
  expect((await search(ADMIN)).items).toEqual([]);
  expect(await (await import("../src/server/gateway")).gatewaySettings()).toMatchObject({ configured: false });
  expect(await (await import("../src/server/executor")).executorSettings()).toMatchObject({ endpoint: "", authenticated: false });
  for (const id of ids) {
    const r = await publish(ADMIN, id, files(id), null);
    if (id === ids[0]) firstRevision = r.revision;
  }
  const c = await createClient("Restriction test", "reader", false, [ids[0]]);
  allowedToken = c.token;
  clientId = c.id;
});
afterAll(async () => {
  await db
    .delete(revisions)
    .where(inArray(revisions.skillId, [...ids, ...graphIds, ...disabledIds]));
  await db
    .delete(skills)
    .where(inArray(skills.id, [...ids, ...graphIds, ...disabledIds]));
  await db.delete(clients).where(eq(clients.id, clientId));
  await db
    .delete(events)
    .where(inArray(events.skillId, [...ids, ...graphIds, ...disabledIds]));
  await db.delete(events).where(eq(events.clientId, clientId));
});
test("nested bundles deduplicate leaves, inherit grants and pin returned revisions", async () => {
  await saveBundle(
    ADMIN,
    graphIds[0],
    "Effect",
    "Fixture",
    [ids[0], ids[1]],
    null,
  );
  await saveBundle(ADMIN, graphIds[1], "React", "Fixture", [ids[0]], null);
  await saveBundle(
    ADMIN,
    graphIds[2],
    "Developer",
    "Fixture",
    [graphIds[0], graphIds[1]],
    null,
  );
  const p: Principal = {
    id: "bundle-test",
    name: "Test",
    role: "reader",
    allSkills: false,
    skillIds: [graphIds[2]],
  };
  const result = await load(p, graphIds[2]);
  expect(result.composition?.skills.map((s) => s.id)).toEqual(ids);
  expect(result.composition?.bundles.length).toBe(2);
  expect((await load(p, ids[0])).revision).toBe(
    result.composition!.skills[0].revision,
  );
  const scoped = await search(p);
  expect(scoped.items.map((s) => s.id).sort()).toEqual([...ids].sort());
  expect(scoped.items.every((s) => s.kind === "skill")).toBe(true);
  const bundlesOnly = await search(p, "", undefined, 0, false, false, [
    "bundle",
  ]);
  expect(bundlesOnly.items.map((s) => s.id).sort()).toEqual(
    graphIds.slice(0, 3).sort(),
  );
  expect(bundlesOnly.items.every((s) => s.kind === "bundle")).toBe(true);
  const skillsAndBundles = await search(p, "", undefined, 0, false, false, [
    "skill",
    "bundle",
  ]);
  expect(skillsAndBundles.items.map((s) => s.id).sort()).toEqual(
    [...ids, ...graphIds.slice(0, 3)].sort(),
  );
  expect((await search(ADMIN)).items.some((s) => s.kind === "bundle")).toBe(
    false,
  );
  const bundle = await revisionFor(ADMIN, graphIds[0]);
  await expect(
    saveBundle(
      ADMIN,
      graphIds[0],
      "Cycle",
      "Fixture",
      [graphIds[2]],
      bundle.id,
    ),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    saveBundle(
      ADMIN,
      graphIds[3],
      "Missing",
      "Fixture",
      ["absent-test-member"],
      null,
    ),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    publish(
      { ...p, role: "writer" },
      graphIds[0],
      files(graphIds[0]),
      bundle.id,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await saveBundle(
    ADMIN,
    graphIds[0],
    "Effect",
    "Fixture",
    [ids[0]],
    bundle.id,
  );
  await expect(load(p, ids[1])).rejects.toMatchObject({ status: 404 });
  const old = await load(p, graphIds[0], bundle.id);
  expect(old.composition?.skills.map((s) => s.id)).toEqual([ids[0]]);
});
test("concurrent reciprocal bundle edits cannot create a cycle", async () => {
  const a = await revisionFor(ADMIN, graphIds[0]),
    b = await revisionFor(ADMIN, graphIds[1]);
  const results = await Promise.allSettled([
    saveBundle(ADMIN, graphIds[0], "A", "Fixture", [graphIds[1]], a.id),
    saveBundle(ADMIN, graphIds[1], "B", "Fixture", [graphIds[0]], b.id),
  ]);
  expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
  expect(results.filter((r) => r.status === "rejected").length).toBe(1);
});
test("archives stay readable, leave default browse and retain reference search", async () => {
  const f = [
    ...files(graphIds[3]),
    makeFile("references/detail.md", "uniquequasar capability"),
  ];
  const r = await publish(ADMIN, graphIds[3], f, null);
  expect(
    (await search(ADMIN, "uniquequasar")).items.map((x) => x.id),
  ).toContain(graphIds[3]);
  const archived = [
    makeFile(
      "SKILL.md",
      `---\nname: ${graphIds[3]}\ndescription: Retired fixture\narchived: true\nreplacement: ${ids[0]}\n---\nRead the replacement.`,
    ),
    ...f.filter((x) => x.path !== "SKILL.md"),
  ];
  await publish(ADMIN, graphIds[3], archived, r.revision);
  expect((await search(ADMIN, graphIds[3])).items).toHaveLength(0);
  expect((await search(ADMIN, graphIds[3], 500, 0, true)).items).toHaveLength(
    1,
  );
  expect((await load(ADMIN, graphIds[3], r.revision)).revision).toBe(
    r.revision,
  );
});
test("disable blocks every agent content path including pinned history, and enable preserves files", async () => {
  const id = disabledIds[0];
  const original = await publish(ADMIN, id, files(id), null);
  const c = await createClient("Disabled paths fixture", "writer", true, []);
  const h = {
    Authorization: "Bearer " + c.token,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  try {
    const disabled = await setDisabled(ADMIN, id, true, original.revision);
    expect(disabled.revision).not.toBe(original.revision);
    for (const suffix of [
      "",
      "?revision=" + original.revision,
      "/history",
      "/bundle?revision=" + original.revision,
      "/file?revision=" + original.revision + "&path=references/guide.md",
    ]) {
      expect(
        (await app.request("/api/skills/" + id + suffix, { headers: h }))
          .status,
      ).toBe(404);
    }
    const browse = await (
      await app.request("/api/skills?includeDisabled=true&query=" + id, {
        headers: h,
      })
    ).json();
    expect(browse.items).toHaveLength(0);
    const rpc = await (
      await app.request("/mcp", {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "load_skill",
            arguments: { id, revision: original.revision },
          },
        }),
      })
    ).json();
    expect(rpc.result.isError).toBe(true);
    expect(
      (
        await app.request("/api/skills/" + id, {
          method: "PUT",
          headers: h,
          body: JSON.stringify({
            expectedRevision: disabled.revision,
            files: files(id),
          }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request("/api/skills/" + id + "/status", {
          method: "PATCH",
          headers: h,
          body: JSON.stringify({
            expectedRevision: disabled.revision,
            disabled: false,
          }),
        })
      ).status,
    ).toBe(403);
    expect((await search(ADMIN, id)).items).toHaveLength(0);
    expect((await search(ADMIN, id, 500, 0, false, true)).items).toHaveLength(
      1,
    );
    expect((await revisionFor(ADMIN, id, original.revision)).files).toEqual(
      files(id),
    );
    const current = await revisionFor(ADMIN, id);
    expect(current.files.find((f) => f.path === "references/guide.md")).toEqual(
      files(id)[1],
    );
    await expect(
      setDisabled(ADMIN, id, false, original.revision),
    ).rejects.toMatchObject({ status: 409 });
    const enabled = await setDisabled(ADMIN, id, false, disabled.revision);
    expect(
      (await app.request("/api/skills/" + id, { headers: h })).status,
    ).toBe(200);
    expect((await revisionFor(ADMIN, id)).id).toBe(enabled.revision);
  } finally {
    await db.delete(clients).where(eq(clients.id, c.id));
    await db.delete(events).where(eq(events.clientId, c.id));
  }
});
test("disabled nested bundles suspend inherited grants without losing membership or independent access", async () => {
  const [leaf, inner, outer, peer] = disabledIds;
  const innerRev = await saveBundle(
    ADMIN,
    inner,
    "Inner",
    "Fixture",
    [leaf],
    null,
  );
  await saveBundle(ADMIN, outer, "Outer", "Fixture", [inner], null);
  const p: Principal = {
    id: "disabled-bundles",
    name: "Test",
    role: "reader",
    allSkills: false,
    skillIds: [outer],
  };
  const hidden = await setDisabled(ADMIN, inner, true, innerRev.revision);
  expect((await load(p, outer)).composition?.skills).toHaveLength(0);
  expect((await load(p, outer)).composition?.members).toEqual([]);
  await expect(load(p, leaf)).rejects.toMatchObject({ status: 404 });
  await expect(load(p, inner, innerRev.revision)).rejects.toMatchObject({
    status: 404,
  });
  expect((await load({ ...p, skillIds: [outer, leaf] }, leaf)).id).toBe(leaf);
  expect((await load(ADMIN, inner)).metadata.members).toEqual([leaf]);
  const visible = await setDisabled(ADMIN, inner, false, hidden.revision);
  expect((await load(p, outer)).composition?.skills.map((s) => s.id)).toEqual([
    leaf,
  ]);
  const leafRev = await revisionFor(ADMIN, leaf);
  const disabledLeaf = await setDisabled(ADMIN, leaf, true, leafRev.id);
  expect((await load(p, outer)).composition?.skills).toHaveLength(0);
  const disabledInner = await setDisabled(ADMIN, inner, true, visible.revision);
  // Cycles remain invalid even if every node involved is disabled.
  await saveBundle(ADMIN, peer, "Peer", "Fixture", [inner], null);
  await expect(
    saveBundle(
      ADMIN,
      inner,
      "Inner",
      "Fixture",
      [peer],
      disabledInner.revision,
    ),
  ).rejects.toMatchObject({ status: 400 });
  await setDisabled(ADMIN, inner, false, disabledInner.revision);
  await setDisabled(ADMIN, leaf, false, disabledLeaf.revision);
  expect((await load(p, outer)).composition?.skills.map((s) => s.id)).toEqual([
    leaf,
  ]);
});
test("disabled flag is typed and writers cannot change it through frontmatter", async () => {
  const id = disabledIds[0];
  expect(() =>
    metadata(id, [
      makeFile(
        "SKILL.md",
        `---\nname: ${id}\ndescription: Fixture\ndisabled: yes\n---\nBody`,
      ),
    ]),
  ).toThrow("Disabled must be a boolean");
  const current = await revisionFor(ADMIN, id);
  await expect(
    publish(
      { ...ADMIN, role: "writer" },
      id,
      [
        makeFile(
          "SKILL.md",
          `---\nname: ${id}\ndescription: Fixture\ndisabled: true\n---\nBody`,
        ),
      ],
      current.id,
    ),
  ).rejects.toMatchObject({ status: 403 });
});
test("missing auth and invalid tokens fail closed", async () => {
  for (const h of [{}, { Authorization: "Bearer invalid" }] as HeadersInit[]) {
    const r = await app.request("/api/skills", { headers: h });
    expect(r.status).toBe(401);
  }
});
test("allowlist filters browse and blocks direct content, history and bundles", async () => {
  const list = await (
    await app.request("/api/skills", { headers: headers() })
  ).json();
  expect(list.items.map((x: any) => x.id)).toEqual([ids[0]]);
  for (const suffix of [
    "",
    "/history",
    "/bundle",
    "/file?revision=" + firstRevision + "&path=SKILL.md",
  ]) {
    const denied = await app.request("/api/skills/" + ids[1] + suffix, {
      headers: headers(),
    });
    const missing = await app.request("/api/skills/missing-" + suffix, {
      headers: headers(),
    });
    expect(denied.status).toBe(404);
    expect(missing.status).toBe(404);
  }
});
test("MCP-served leaves omit unauthorized, disabled, archived and bundle ids", async () => {
  const reader = await authenticate(
    new Request("http://test/mcp", { headers: headers() }),
  );
  const granted = await servedSkillRevision(reader, ids[0]);
  expect(granted.skill.id).toBe(ids[0]);
  expect(granted.skill.kind).toBe("skill");
  await expect(servedSkillRevision(reader, ids[1])).rejects.toMatchObject({
    status: 404,
  });
  await expect(servedSkillRevision(reader, graphIds[0])).rejects.toMatchObject({
    status: 404,
  });
  const archived = graphIds[3];
  await expect(servedSkillRevision(ADMIN, archived)).rejects.toMatchObject({
    status: 404,
  });
});
test("reader cannot publish or administer clients", async () => {
  expect(
    (
      await app.request("/api/skills/" + ids[0], {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({
          expectedRevision: firstRevision,
          files: files(ids[0]),
        }),
      })
    ).status,
  ).toBe(403);
  expect(
    (await app.request("/api/clients", { headers: headers() })).status,
  ).toBe(403);
});
test("MCP advertises usage reporting alongside reader and writer tools", async () => {
  for (const [key, count] of [
    [allowedToken, 5],
    [process.env.SKILLBOX_ADMIN_TOKEN!, 9],
  ] as const) {
    const r = await app.request("/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.result.tools.length).toBe(count);
    expect(body.result.tools.some((t: any) => t.name === "upsert_skill")).toBe(
      count === 9,
    );
  }
});
test("recommendations authorize full leaf catalog before scoring and invalidate grants/lifecycle/revisions", async () => {
  const names = Array.from(
    { length: 6 },
    (_, i) => `test-recommend-${i}-${randomUUID().slice(0, 8)}`,
  );
  const [leaf, hidden, archived, disabled, bundle, disabledBranch] = names;
  let credential: Awaited<ReturnType<typeof createClient>> | undefined;
  let profileId: string | undefined;
  try {
    for (const id of names.slice(0, 4)) {
      await publish(
        ADMIN,
        id,
        [
          makeFile(
            "SKILL.md",
            `---\nname: ${id}\ndescription: Prevent stuttering animations on handheld devices\narchived: false\ndisabled: ${id === disabled}\n---\nPrivate instructions must never reach evaluator.`,
          ),
        ],
        null,
      );
    }
    await saveBundle(
      ADMIN,
      disabledBranch,
      "Disabled branch",
      "Hidden branch",
      [hidden],
      null,
    );
    await setDisabled(
      ADMIN,
      disabledBranch,
      true,
      (await revisionFor(ADMIN, disabledBranch)).id,
    );
    await saveBundle(
      ADMIN,
      bundle,
      "Toolkit",
      "Grant fixture",
      [leaf, disabled, disabledBranch],
      null,
    );
    await archiveSkill(
      ADMIN,
      archived,
      (await revisionFor(ADMIN, archived)).id,
    );
    credential = await createClient("Recommendation fixture", "reader", false, [
      bundle,
      archived,
    ]);
    const req = new Request("http://localhost/api/skill-recommendations", {
      headers: { Authorization: `Bearer ${credential.token}` },
    });
    const principal = () => authenticate(req);
    profileId = (await principal()).profileId!;
    expect(
      (await recommendationCatalog(await principal())).candidates.map(
        (s) => s.id,
      ),
    ).toEqual([leaf]);
    let evaluations = 0;
    const rank = createRecommender(async (task, candidates) => {
      evaluations++;
      expect(task).toBe("Fix laggy phone transitions");
      expect(candidates.map((s) => s.id)).toEqual([leaf]);
      expect(Object.keys(candidates[0]).sort()).toEqual([
        "description",
        "id",
        "referenceId",
        "revision",
      ]);
      return { scores: [4] };
    });
    const input = { task: "Fix laggy phone transitions" };
    const first = await recommendSkills(principal, input, undefined, rank);
    expect(first.items[0].id).toBe(leaf);
    expect(
      (await recommendSkills(principal, input, undefined, rank)).cacheHit,
    ).toBe(true);
    const revision = await publish(
      ADMIN,
      leaf,
      files(leaf),
      first.items[0].revision,
    );
    expect(
      (await recommendSkills(principal, input, undefined, rank)).items[0]
        .revision,
    ).toBe(revision.revision);
    expect(evaluations).toBe(2);
    await db
      .update(profiles)
      .set({ skillIds: [] })
      .where(eq(profiles.id, profileId));
    expect(
      (await recommendSkills(principal, input, undefined, rank)).items,
    ).toEqual([]);
    await db
      .update(profiles)
      .set({ skillIds: [bundle] })
      .where(eq(profiles.id, profileId));
    const disableDuringEvaluation = createRecommender(async () => {
      await setDisabled(ADMIN, leaf, true, revision.revision);
      return { scores: [4] };
    });
    expect(
      await recommendSkills(
        principal,
        { task: "Quality" },
        undefined,
        disableDuringEvaluation,
      ),
    ).toMatchObject({
      method: "search",
      fallbackReason: "catalog_changed",
      items: [],
    });
    // HTTP and MCP agree on empty authorized catalogs, and expose no disabled entries.
    const http = await app.request("/api/skill-recommendations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
    expect(http.status).toBe(200);
    expect(await http.json()).toMatchObject({ items: [], noMatch: true });
    const mcp = await app.request("/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential.token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "recommend_skills", arguments: input },
      }),
    });
    const body = await mcp.json();
    expect(JSON.parse(body.result.content[0].text)).toMatchObject({
      items: [],
      noMatch: true,
    });
    await db
      .update(clients)
      .set({ active: false })
      .where(eq(clients.id, credential.id));
    await expect(
      recommendSkills(principal, input, undefined, rank),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      (
        await app.request("/api/skill-recommendations", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${credential.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(401);
  } finally {
    await db.delete(revisions).where(inArray(revisions.skillId, names));
    await db.delete(skills).where(inArray(skills.id, names));
    if (credential) {
      await db.delete(clients).where(eq(clients.id, credential.id));
      await db.delete(events).where(eq(events.clientId, credential.id));
    }
    if (profileId) await db.delete(profiles).where(eq(profiles.id, profileId));
    await db.delete(events).where(inArray(events.skillId, names));
  }
});
test("recommendation failures use unchanged deterministic search pagination", async () => {
  const p = () =>
    authenticate(new Request("http://localhost/", { headers: headers() }));
  const rank = createRecommender(async () => {
    throw new EvaluationUnavailable("rate_limited", 1000);
  });
  const normal = await search(await p(), "Quality", 1, 0);
  const result = await recommendSkills(
    p,
    { task: "Quality", limit: 1 },
    undefined,
    rank,
  );
  expect(result.method).toBe("search");
  expect(result.items.map((s) => s.id)).toEqual(normal.items.map((s) => s.id));
  expect(result.hasMore).toBe(normal.hasMore);
  expect(result.nextOffset).toBe(normal.nextOffset);
  expect(result.noMatch).toBeNull();
  const invalid = await app.request("/api/skill-recommendations", {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ task: " " }),
  });
  expect(invalid.status).toBe(400);
});
test("Gateway key requires owner Settings, stays encrypted and invalidates model/cache on replacement/removal", async () => {
  const { gatewaySettings, configureGateway, gatewayRecommender } = await import("../src/server/gateway");
  const previousFetch = globalThis.fetch;
  const previousEnv = process.env.AI_GATEWAY_API_KEY;
  const ownerHeaders = { Authorization: `Bearer ${process.env.SKILLBOX_ADMIN_TOKEN}`, "Content-Type": "application/json" };
  const principal = () => authenticate(new Request("http://localhost/", { headers: headers() }));
  let calls = 0;
  let seenKey = "";
  let removeDuringCall = false;
  globalThis.fetch = (async (_url, init) => {
    calls++;
    seenKey = new Headers(init?.headers).get("Authorization") ?? "";
    const body = JSON.parse(String(init?.body));
    if (removeDuringCall) await configureGateway({ apiKey: null });
    return Response.json({ answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id, { type: "score", score: 4 }])) });
  }) as typeof fetch;
  try {
    await configureGateway({ apiKey: null });
    process.env.AI_GATEWAY_API_KEY = "ignored-environment-fixture";
    const missing = await recommendSkills(principal, { task: "Quality" });
    expect(missing).toMatchObject({ method: "search", fallbackReason: "not_configured" });
    expect(calls).toBe(0);
    for (const method of ["GET", "PUT"]) {
      const denied = await app.request("/api/settings/ai-gateway", { method, headers: { ...headers(), "Content-Type": "application/json" }, ...(method === "PUT" ? { body: JSON.stringify({ apiKey: "fixture-key" }) } : {}) });
      expect(denied.status).toBe(403);
    }
    expect((await app.request("/api/settings/ai-gateway", { method: "PUT", headers: ownerHeaders, body: JSON.stringify({ apiKey: " " }) })).status).toBe(400);
    const saved = await app.request("/api/settings/ai-gateway", { method: "PUT", headers: ownerHeaders, body: JSON.stringify({ apiKey: "fixture-key-one" }) });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ configured: true });
    const status = await app.request("/api/settings/ai-gateway", { headers: ownerHeaders });
    expect(await status.json()).not.toHaveProperty("apiKey");
    const stored = await connection`SELECT value FROM workspace_settings WHERE id='ai_gateway'`;
    expect(JSON.stringify(stored)).not.toContain("fixture-key-one");
    const one = await recommendSkills(principal, { task: "Quality" });
    expect(one.method).toBe("jev");
    expect(seenKey).toBe("Bearer fixture-key-one");
    expect((await recommendSkills(principal, { task: "Quality" })).cacheHit).toBe(true);
    expect(calls).toBe(1);
    const firstVersion = (await gatewaySettings()).revision;
    await configureGateway({ apiKey: "fixture-key-two" });
    expect((await gatewaySettings()).revision).not.toBe(firstVersion);
    expect((await recommendSkills(principal, { task: "Quality" })).cacheHit).toBe(false);
    expect(seenKey).toBe("Bearer fixture-key-two");
    expect(calls).toBe(2);
    const oldEngine = await gatewayRecommender();
    await configureGateway({ apiKey: null });
    const stale = await oldEngine.rank({ catalog: async () => ({ scope: "fixture", candidates: [{ id: "fixture", referenceId: "uuid", revision: "revision", description: "Quality" }] }), search: async () => ({ items: [], hasMore: false, nextOffset: null }) }, { task: "Quality" });
    expect(stale).toMatchObject({ method: "search", fallbackReason: "configuration_changed" });
    expect(calls).toBe(2);
    expect((await recommendSkills(principal, { task: "Quality" })).method).toBe("search");
    await configureGateway({ apiKey: "fixture-key-three" });
    removeDuringCall = true;
    expect(await recommendSkills(principal, { task: "Quality" })).toMatchObject({ method: "search", fallbackReason: "catalog_changed" });
    expect((await gatewaySettings()).configured).toBe(false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnv === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previousEnv;
    await configureGateway({ apiKey: null });
  }
});
test("provider switching preserves separate encrypted keys, migrates Gateway settings and invalidates cache", async () => {
  const { gatewaySettings, configureGateway } = await import("../src/server/gateway");
  const { seal } = await import("../src/server/secret-storage");
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; auth: string | null }> = [];
  const principal = () => authenticate(new Request("http://localhost/", { headers: headers() }));
  globalThis.fetch = (async (url, init) => {
    const h = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body));
    const direct = String(url).includes("api.typesafe.ai");
    if (direct) {
      expect(h.has("ai-model-id")).toBe(false);
      expect(body.model).toBe("jev-latest");
    } else expect(body).not.toHaveProperty("model");
    requests.push({ url: String(url), auth: h.get("authorization") });
    return Response.json({ model: "jev-latest", answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id, { type: "score", score: 4, confidence: 0.95 }])), usage: direct ? { input_tokens: 100, output_tokens: 10 } : { inputTokens: 100, outputTokens: 10 } });
  }) as typeof fetch;
  try {
    await connection`UPDATE workspace_settings SET value=${JSON.stringify(seal({ revision: "legacy-gateway-fixture", apiKey: "fixture-vercel-key" }))}::jsonb WHERE id='ai_gateway'`;
    expect(await gatewaySettings()).toMatchObject({ provider: "vercel", configured: true, providers: { typesafe: { configured: false } } });
    expect((await recommendSkills(principal, { task: "Quality" })).provider).toBe("vercel");
    await configureGateway({ provider: "typesafe" });
    expect(await recommendSkills(principal, { task: "Quality" })).toMatchObject({ provider: "typesafe", method: "search", fallbackReason: "not_configured" });
    expect(requests.length).toBe(1); // Never send the saved Gateway key to TypeSafe.
    await configureGateway({ provider: "typesafe", apiKey: "fixture-typesafe-key" });
    expect(await recommendSkills(principal, { task: "Quality" })).toMatchObject({ provider: "typesafe", method: "jev", cacheHit: false });
    expect(requests.at(-1)).toEqual({ url: "https://api.typesafe.ai/v1/systemone", auth: "Bearer fixture-typesafe-key" });
    expect((await recommendSkills(principal, { task: "Quality" })).cacheHit).toBe(true);
    await configureGateway({ provider: "vercel" });
    expect((await recommendSkills(principal, { task: "Quality" })).cacheHit).toBe(false);
    expect(requests.at(-1)?.auth).toBe("Bearer fixture-vercel-key");
    await configureGateway({ provider: "typesafe", apiKey: null });
    expect(await gatewaySettings()).toMatchObject({ provider: "typesafe", configured: false, providers: { vercel: { configured: true }, typesafe: { configured: false } } });
    await Promise.all([configureGateway({ provider: "vercel", apiKey: "fixture-vercel-new" }), configureGateway({ provider: "typesafe", apiKey: "fixture-typesafe-new" })]);
    await configureGateway({ provider: "typesafe" });
    await configureGateway({ apiKey: "fixture-legacy-gateway" });
    const status = await gatewaySettings();
    expect(status.provider).toBe("vercel"); // Old Gateway-only clients never retarget keys to TypeSafe.
    expect(status.providers).toEqual({ vercel: { configured: true }, typesafe: { configured: true } });
    expect(JSON.stringify(status)).not.toContain("fixture-");
    const stored = await connection`SELECT value FROM workspace_settings WHERE id='ai_gateway'`;
    expect(JSON.stringify(stored)).not.toContain("fixture-");
    const invalid = await app.request("/api/settings/ai-gateway", { method: "PUT", headers: { Authorization: `Bearer ${process.env.SKILLBOX_ADMIN_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ provider: "unknown" }) });
    expect(invalid.status).toBe(400);
  } finally {
    globalThis.fetch = previousFetch;
    await configureGateway({ provider: "typesafe", apiKey: null });
    await configureGateway({ provider: "vercel", apiKey: null });
  }
});
test("concurrent save conflict protects old and new revisions", async () => {
  const result = await publish(
    ADMIN,
    ids[0],
    files(ids[0], "Updated"),
    firstRevision,
  );
  await expect(
    publish(ADMIN, ids[0], files(ids[0], "Stale"), firstRevision),
  ).rejects.toMatchObject({ status: 409 });
  expect((await revisionFor(ADMIN, ids[0])).id).toBe(result.revision);
  expect((await revisionFor(ADMIN, ids[0], firstRevision)).id).toBe(
    firstRevision,
  );
});
test("revoke immediately blocks an existing token", async () => {
  await db
    .update(clients)
    .set({ active: false })
    .where(eq(clients.id, clientId));
  expect(
    (
      await app.request("/api/skills/" + ids[0] + "/bundle", {
        headers: headers(),
      })
    ).status,
  ).toBe(401);
  await db
    .update(clients)
    .set({ active: true })
    .where(eq(clients.id, clientId));
});
test("only explicitly configured origins pass; cross-origin mutations fail", async () => {
  const oldOrigin = process.env.SKILLBOX_ORIGIN;
  const oldAliases = process.env.SKILLBOX_ALLOWED_ORIGINS;
  process.env.SKILLBOX_ORIGIN = "https://skills.example.com";
  process.env.SKILLBOX_ALLOWED_ORIGINS = "https://legacy-skills.example.com";
  try {
  for (const origin of [
    "https://skills.example.com",
    "https://legacy-skills.example.com",
  ]) {
    const response = await app.request("/api/login", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "invalid-key-for-origin-check" }),
    });
    expect(response.status).toBe(401);
  }
  const r = await app.request("/api/login", {
    method: "POST",
    headers: {
      Origin: "https://evil.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key: "test" }),
  });
  expect(r.status).toBe(403);
  } finally {
    if (oldOrigin === undefined) delete process.env.SKILLBOX_ORIGIN;
    else process.env.SKILLBOX_ORIGIN = oldOrigin;
    if (oldAliases === undefined) delete process.env.SKILLBOX_ALLOWED_ORIGINS;
    else process.env.SKILLBOX_ALLOWED_ORIGINS = oldAliases;
  }
});
test("package paths and checksums cannot escape or collide", () => {
  for (const p of ["../bad", "/bad", "a/../bad", "a\\bad", "a//bad", "C:bad"])
    expect(() => safePath(p)).toThrow();
  const f = files(ids[0]);
  expect(() =>
    validateFiles([...f, makeFile("skill.md", "collision")]),
  ).toThrow();
  expect(() =>
    validateFiles([...f, { ...makeFile("x", "ok"), sha256: "0".repeat(64) }]),
  ).toThrow();
  expect(() =>
    validateFiles([...f, makeFile("references", "collision")]),
  ).toThrow();
});
test("legacy unquoted description colons parse without modifying source", () => {
  const f = [
    makeFile(
      "SKILL.md",
      `---\nname: ${ids[0]}\ndescription: Trigger words: repo, quality\n---\nBody`,
    ),
  ];
  const original = f[0].content;
  expect(metadata(ids[0], f).description).toBe("Trigger words: repo, quality");
  expect(f[0].content).toBe(original);
});

test("icon revisions preserve files, survive catalog and reject stale or reader writes", async () => {
  const id = "test-icon-" + randomUUID().slice(0, 8);
  ids.push(id);
  const first = await publish(ADMIN, id, files(id), null);
  const icon = {
    kind: "icon" as const,
    name: "palette",
    background: "#526b91",
  };
  const next = await setIcon(ADMIN, id, icon, first.revision);
  expect((await revisionFor(ADMIN, id)).metadata.icon).toEqual(icon);
  expect(
    (await search(ADMIN, id)).items.find((i) => i.id === id)?.icon,
  ).toEqual(icon);
  expect(
    (await revisionFor(ADMIN, id)).files.find(
      (f) => f.path === "references/guide.md",
    )?.content,
  ).toBe(files(id)[1].content);
  await expect(setIcon(ADMIN, id, null, first.revision)).rejects.toThrow();
  await expect(
    setIcon({ ...ADMIN, role: "reader" }, id, null, next.revision),
  ).rejects.toThrow();
  const image = {
    kind: "image" as const,
    src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG6kAAAAASUVORK5CYII=",
  };
  await setIcon(ADMIN, id, image, next.revision);
  const saved = await revisionFor(ADMIN, id);
  expect(saved.metadata.icon).toEqual(image);
  expect(saved.files.some((f) => f.path === "assets/skillbox-icon.png")).toBe(
    true,
  );
  expect(
    Buffer.from(
      saved.files.find((f) => f.path === "SKILL.md")!.content,
      "base64",
    ).toString(),
  ).not.toContain("data:image");
});

test("owner package metrics exclude legacy and UI reads from agent usage", async () => {
  const id = ids[1];
  await db.delete(events).where(eq(events.skillId, id));
  const r = await revisionFor(ADMIN, id);
  const { packageMetrics } = await import("../src/package-metrics");
  const before = await search(ADMIN, id, 500, 0, false, false, ["skill"], true);
  expect(before.items[0]!.characters).toBe(packageMetrics(r.files).characters);
  await load(ADMIN, id);
  await load({ ...ADMIN, context: { source: "web" } }, id);
  const legacy = await search(ADMIN, id, 500, 0, false, false, ["skill"], true);
  expect(legacy.items[0]!.lastAgentReadAt).toBeNull();
  expect(legacy.items[0]!.usageCount).toBe(0);
  await load(
    {
      ...ADMIN,
      context: {
        source: "mcp",
        harness: "Test harness",
        model: "Self-reported model",
      },
    },
    id,
  );
  const accessed = await search(
    ADMIN,
    id,
    500,
    0,
    false,
    false,
    ["skill"],
    true,
  );
  expect(accessed.items[0]!.lastAgentReadAt).toBeTruthy();
  expect(accessed.items[0]!.readCount).toBe(1);
  expect(accessed.items[0]!.usageCount).toBe(0);
  const { record } = await import("../src/server/library");
  await record({ ...ADMIN, context: { source: "mcp" } }, "reported_use", id, {
    revision: r.id,
    outcome: "applied",
  });
  const used = await search(ADMIN, id, 500, 0, false, false, ["skill"], true);
  expect(used.items[0]!.usageCount).toBe(1);
  const compact = await search(ADMIN, id);
  expect(compact.items[0]).not.toHaveProperty("characters");
  const privateMetrics = await search(
    { ...ADMIN, role: "reader" },
    id,
    500,
    0,
    false,
    false,
    ["skill"],
    true,
  );
  expect(privateMetrics.items[0]).not.toHaveProperty("lastAgentReadBy");
});
test("Executor associations persist across revisions and reject stale writes", async () => {
  const { setIntegrations } = await import("../src/server/library");
  const id = ids[1],
    r = await revisionFor(ADMIN, id);
  const saved = await setIntegrations(
    ADMIN,
    id,
    ["google_gmail", "github_mcp"],
    r.id,
  );
  expect((await load(ADMIN, id)).metadata.executorIntegrations).toEqual([
    "google_gmail",
    "github_mcp",
  ]);
  expect((await revisionFor(ADMIN, id)).files.length).toBe(r.files.length);
  await expect(setIntegrations(ADMIN, id, [], r.id)).rejects.toThrow();
  await expect(
    setIntegrations({ ...ADMIN, role: "reader" }, id, [], saved.revision),
  ).rejects.toThrow();
});

test("Executor credentials stay encrypted and only owners can configure endpoints", async () => {
  const { configureExecutor, executorSettings, disconnectExecutor } =
    await import("../src/server/executor");
  await configureExecutor(
    "https://executor.example.com/mcp",
    "test-secret-not-for-production",
  );
  const stored =
    await connection`SELECT value FROM workspace_settings WHERE id='executor'`;
  expect(JSON.stringify(stored)).not.toContain(
    "test-secret-not-for-production",
  );
  expect(await executorSettings()).not.toHaveProperty("bearer");
  await expect(
    configureExecutor("http://executor.example.com/mcp"),
  ).rejects.toThrow();
  const reader = await createClient(
    "Executor settings test",
    "reader",
    false,
    [],
  );
  const denied = await app.request("/api/settings/executor", {
    headers: { Authorization: "Bearer " + reader.token },
  });
  await db.delete(clients).where(eq(clients.id, reader.id));
  expect(denied.status).toBe(403);
  await configureExecutor("https://changed.example.com/mcp");
  expect((await executorSettings()).authenticated).toBe(false);
  await disconnectExecutor();
});

test("Executor cross-origin resource aliases require explicit deployment configuration", async () => {
  const { validateExecutorResource } = await import("../src/server/executor");
  const previous = process.env.SKILLBOX_EXECUTOR_RESOURCE_ALIASES;
  delete process.env.SKILLBOX_EXECUTOR_RESOURCE_ALIASES;
  try {
    await expect(validateExecutorResource("https://executor.example.com/mcp", "https://legacy.example.com")).rejects.toThrow();
    process.env.SKILLBOX_EXECUTOR_RESOURCE_ALIASES = JSON.stringify({ "https://executor.example.com/mcp": "https://legacy.example.com/" });
    expect((await validateExecutorResource("https://executor.example.com/mcp", "https://legacy.example.com")).origin).toBe("https://legacy.example.com");
    await expect(validateExecutorResource("https://other.example.com/mcp", "https://legacy.example.com")).rejects.toThrow();
    await expect(validateExecutorResource("https://other.example.com/mcp", "https://other.example.com/wrong-resource")).rejects.toThrow();
  } finally {
    if (previous === undefined) delete process.env.SKILLBOX_EXECUTOR_RESOURCE_ALIASES;
    else process.env.SKILLBOX_EXECUTOR_RESOURCE_ALIASES = previous;
  }
});

test("skill references resolve stable IDs without granting access or eager reads", async () => {
  const { resolveSkillReference } = await import("../src/server/library");
  const owner = await load(ADMIN, ids[1]);
  const uuid = owner.referenceId;
  expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
  const before = await revisionFor(ADMIN, ids[1]);
  await publish(
    ADMIN,
    ids[1],
    files(ids[1], `Renamed content\n[Self](skill://${uuid})`),
    before.id,
  );
  const same = await load(ADMIN, uuid);
  expect(same.referenceId).toBe(uuid);
  expect(same.id).toBe(ids[1]);
  expect(same.skillReferences?.[0]?.referenceId).toBe(uuid);
  expect((await load(ADMIN, `skill://${uuid}`)).id).toBe(ids[1]);
  const source = await revisionFor(ADMIN, ids[0]);
  await publish(
    ADMIN,
    ids[0],
    files(ids[0], `[Follow target](skill://${uuid})`),
    source.id,
  );
  const restricted: Principal = {
    id: "reference-test",
    name: "Reference test",
    role: "reader",
    allSkills: false,
    skillIds: [ids[0]],
  };
  const r = await load(restricted, ids[0]);
  expect(r.skillReferences).toEqual([{ referenceId: uuid, available: false }]);
  await expect(load(restricted, uuid)).rejects.toThrow();
  await expect(resolveSkillReference(restricted, uuid)).rejects.toThrow();
  const current = await revisionFor(ADMIN, ids[1]);
  await setDisabled(ADMIN, ids[1], true, current.id);
  const allReader = { ...restricted, allSkills: true };
  expect((await load(allReader, ids[0])).skillReferences).toEqual([
    { referenceId: uuid, available: false },
  ]);
  await expect(load(allReader, uuid)).rejects.toThrow();
  const disabled = await revisionFor(ADMIN, ids[1]);
  await setDisabled(ADMIN, ids[1], false, disabled.id);
  const file = await import("../src/server/library").then((lib) =>
    lib.readFile(ADMIN, uuid, same.revision, "SKILL.md"),
  );
  expect(file.id).toBe(ids[1]);
});

test("native export import can restore an immutable reference ID", async () => {
  const id = "test-reference-import-" + randomUUID().slice(0, 8);
  ids.push(id);
  const referenceId = randomUUID();
  await publish(
    ADMIN,
    id,
    files(id),
    null,
    "Import reference identity",
    referenceId,
  );
  expect((await load(ADMIN, referenceId)).id).toBe(id);
  const current = await revisionFor(ADMIN, id);
  await expect(
    publish(ADMIN, id, files(id), current.id, "Cannot reassign", randomUUID()),
  ).rejects.toThrow();
  expect((await load(ADMIN, id)).referenceId).toBe(referenceId);
});

test("profiles apply immediately, clients cannot edit grants, and duplicate connections are rejected", async () => {
  const profile = await access.saveProfile(ADMIN, {
    name: "Access fixture " + randomUUID(),
    allSkills: false,
    skillIds: [ids[0]],
    permissions: { create: false, update: false, delete: false, propose: true },
  });
  const c = await access.uniqueClient(
    "Unique fixture " + randomUUID(),
    profile.id,
  );
  const auth = { Authorization: "Bearer " + c.token };
  try {
    expect(
      (await app.request("/api/skills/" + ids[0], { headers: auth })).status,
    ).toBe(200);
    expect(
      (await app.request("/api/skills/" + ids[1], { headers: auth })).status,
    ).toBe(404);
    expect((await app.request("/api/profiles", { headers: auth })).status).toBe(
      403,
    );
    expect(
      (
        await app.request("/api/clients/" + c.id, {
          method: "PATCH",
          headers: {
            Authorization: "Bearer " + process.env.SKILLBOX_ADMIN_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ allSkills: true }),
        })
      ).status,
    ).toBe(400);
    const listed = await app.request("/api/clients", {
      headers: { Authorization: "Bearer " + process.env.SKILLBOX_ADMIN_TOKEN },
    });
    expect(
      (await listed.json()).find((row: any) => row.id === c.id).lastSeen,
    ).not.toBeNull();
    const p = await authenticate(
      new Request("http://test/mcp", { headers: auth }),
    );
    await expect(
      publish(p, ids[0], files(ids[0]), (await revisionFor(ADMIN, ids[0])).id),
    ).rejects.toMatchObject({ status: 403 });
    await access.saveProfile(
      ADMIN,
      { ...profile, skillIds: [ids[1]] },
      profile.id,
      profile.version,
    );
    expect(
      (await app.request("/api/skills/" + ids[0], { headers: auth })).status,
    ).toBe(404);
    expect(
      (await app.request("/api/skills/" + ids[1], { headers: auth })).status,
    ).toBe(200);
    await expect(
      access.saveProfile(ADMIN, profile, profile.id, profile.version),
    ).rejects.toMatchObject({ status: 409 });
    const [existing] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, c.id));
    await expect(
      access.uniqueClient(existing.name.toUpperCase(), profile.id),
    ).rejects.toMatchObject({ status: 409 });
  } finally {
    await db.delete(clients).where(eq(clients.id, c.id));
    await db.delete(profiles).where(eq(profiles.id, profile.id));
  }
});
test("separate create/update/delete permissions and proposals preserve revision history", async () => {
  const id = "proposal-" + randomUUID().slice(0, 8),
    other = "created-" + randomUUID().slice(0, 8);
  const initial = await publish(ADMIN, id, files(id), null);
  const profile = await access.saveProfile(ADMIN, {
    name: "Proposal fixture " + randomUUID(),
    allSkills: false,
    skillIds: [id],
    permissions: { create: false, update: false, delete: false, propose: true },
  });
  const c = await access.uniqueClient("Proposer " + randomUUID(), profile.id);
  const principal = () =>
    authenticate(
      new Request("http://test/mcp", {
        headers: { Authorization: "Bearer " + c.token },
      }),
    );
  try {
    const p = await principal();
    await expect(
      access.propose(p, ids[1], files(ids[1]), firstRevision, "No access"),
    ).rejects.toMatchObject({ status: 404 });
    const proposed = await access.propose(
      p,
      id,
      files(id, "Proposed body"),
      initial.revision,
      "Improve instructions",
    );
    expect((await revisionFor(ADMIN, id)).id).toBe(initial.revision);
    await expect(
      access.reviewProposal(p, proposed.id, "approve"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      access.proposalDetail({ ...p, id: "different-client" }, proposed.id),
    ).rejects.toMatchObject({ status: 404 });
    const approval = await access.reviewProposal(ADMIN, proposed.id, "approve");
    expect((await revisionFor(ADMIN, id)).id).toBe(approval.revision!);
    await expect(
      access.reviewProposal(ADMIN, proposed.id, "approve"),
    ).rejects.toMatchObject({ status: 409 });
    const stale = await access.propose(
      p,
      id,
      files(id, "Stale proposal"),
      approval.revision!,
      "Stale",
    );
    const current = await publish(
      ADMIN,
      id,
      files(id, "Owner update"),
      approval.revision!,
    );
    await expect(
      access.reviewProposal(ADMIN, stale.id, "approve"),
    ).rejects.toMatchObject({ status: 409 });
    expect((await access.proposalDetail(ADMIN, stale.id)).status).toBe(
      "pending",
    );
    expect((await revisionFor(ADMIN, id)).id).toBe(current.revision);
    await access.reviewProposal(ADMIN, stale.id, "reject");
    await db
      .update(profiles)
      .set({
        permissions: {
          create: true,
          update: false,
          delete: false,
          propose: false,
        },
      })
      .where(eq(profiles.id, profile.id));
    const created = await publish(await principal(), other, files(other), null);
    expect((await revisionFor(await principal(), other)).id).toBe(
      created.revision,
    );
    await expect(
      publish(
        await principal(),
        other,
        files(other, "Denied"),
        created.revision,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await db
      .update(profiles)
      .set({
        permissions: {
          create: false,
          update: true,
          delete: false,
          propose: false,
        },
      })
      .where(eq(profiles.id, profile.id));
    const updated = await publish(
      await principal(),
      other,
      files(other, "Allowed"),
      created.revision,
    );
    await expect(
      publish(await principal(), "denied-new", files("denied-new"), null),
    ).rejects.toMatchObject({ status: 403 });
    const { archiveSkill } = await import("../src/server/library");
    await expect(
      archiveSkill(await principal(), other, updated.revision),
    ).rejects.toMatchObject({ status: 403 });
    await db
      .update(profiles)
      .set({
        permissions: {
          create: false,
          update: false,
          delete: true,
          propose: false,
        },
      })
      .where(eq(profiles.id, profile.id));
    await archiveSkill(await principal(), other, updated.revision);
    expect(
      (await search(await principal())).items.some((s) => s.id === other),
    ).toBe(false);
    expect((await revisionFor(ADMIN, other, created.revision)).id).toBe(
      created.revision,
    );
  } finally {
    await db.delete(proposals).where(eq(proposals.clientId, c.id));
    await db.delete(clients).where(eq(clients.id, c.id));
    await db.delete(profiles).where(eq(profiles.id, profile.id));
    await db.delete(revisions).where(inArray(revisions.skillId, [id, other]));
    await db.delete(skills).where(inArray(skills.id, [id, other]));
  }
});
test("legacy migration preserves key identity and exact grants, and is repeatable", async () => {
  const id = randomUUID(),
    secret = randomUUID(),
    { sha256 } = await import("../src/server/library");
  await connection`ALTER TABLE clients ALTER COLUMN profile_id DROP NOT NULL`;
  await connection`INSERT INTO clients(id,name,token_hash,role,all_skills,skill_ids) VALUES(${id},'Migration fixture',${sha256(secret)},'reader',false,${JSON.stringify([ids[0]])}::jsonb)`;
  try {
    await migrate();
    const p = await authenticate(
      new Request("http://test/mcp", {
        headers: { Authorization: "Bearer " + secret },
      }),
    );
    expect(p.id).toBe(id);
    expect(p.skillIds).toEqual([ids[0]]);
    expect(p.permissions).toEqual({
      create: false,
      update: false,
      delete: false,
      propose: false,
    });
    await migrate();
    expect(
      (
        await authenticate(
          new Request("http://test/mcp", {
            headers: { Authorization: "Bearer " + secret },
          }),
        )
      ).profileId,
    ).toBe(p.profileId);
  } finally {
    await db.delete(clients).where(eq(clients.id, id));
  }
});
