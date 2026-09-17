import { test, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { app } from "../src/server/app";
import { migrate, db } from "../src/server/db";
import {
  clients,
  skills,
  revisions,
  events,
  profiles,
} from "../src/server/schema";
import { eq, inArray } from "drizzle-orm";
import {
  ADMIN,
  load,
  makeFile,
  publish,
  saveBundle,
  setDisabled,
  sha256,
} from "../src/server/library";
import { createClient } from "../src/server/auth";
import { SKILLS_EXTENSION_ID } from "../src/server/skills-mcp";

const suffix = randomUUID().slice(0, 8);
const grantedId = `test-sep-granted-${suffix}`;
const hiddenId = `test-sep-hidden-${suffix}`;
const disabledId = `test-sep-disabled-${suffix}`;
const bundleId = `test-sep-bundle-${suffix}`;
const reviseId = `test-sep-revise-${suffix}`;
const ids = [grantedId, hiddenId, disabledId, bundleId, reviseId];
const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const skillMd = (id: string, body: string) =>
  `---\nname: ${id}\ndescription: Quality workflow for a fixture\n---\n\n${body}`;
const grantedFiles = (body = "Read the docs.") => [
  makeFile("SKILL.md", skillMd(grantedId, body)),
  makeFile("references/guide.md", "Reference content"),
  makeFile("scripts/run.sh", "#!/bin/sh\necho ran\n", true),
  {
    path: "assets/icon.bin",
    content: png.toString("base64"),
    sha256: sha256(png),
    size: png.length,
    executable: false,
  },
];
const reviseFiles = (body: string) => [
  makeFile("SKILL.md", skillMd(reviseId, body)),
];

let readerToken = "";
let readerClientId = "";
let readerProfileId = "";
let firstRevision = "";
let reviseRevision = "";
let grantedReferenceId = "";
const adminToken = process.env.SKILLBOX_ADMIN_TOKEN!;

const mcpHeaders = (token: string) => ({
  Authorization: "Bearer " + token,
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
});

async function rpc(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  id = 1,
) {
  const response = await app.request("/mcp", {
    method: "POST",
    headers: mcpHeaders(token),
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  expect(response.status).toBe(200);
  return response.json();
}

beforeAll(async () => {
  await migrate();
  const created = await publish(ADMIN, grantedId, grantedFiles(), null);
  firstRevision = created.revision;
  await publish(
    ADMIN,
    hiddenId,
    [makeFile("SKILL.md", skillMd(hiddenId, "Hidden from the reader."))],
    null,
  );
  const disabled = await publish(
    ADMIN,
    disabledId,
    [makeFile("SKILL.md", skillMd(disabledId, "Will be disabled."))],
    null,
  );
  await setDisabled(ADMIN, disabledId, true, disabled.revision);
  await saveBundle(
    ADMIN,
    bundleId,
    "Toolkit",
    "Fixture bundle",
    [grantedId],
    null,
  );
  const revised = await publish(
    ADMIN,
    reviseId,
    reviseFiles("First revision."),
    null,
  );
  reviseRevision = revised.revision;
  grantedReferenceId = (await load(ADMIN, grantedId)).referenceId;
  const client = await createClient("SEP reader", "reader", false, [
    grantedId,
    reviseId,
  ]);
  readerToken = client.token;
  readerClientId = client.id;
  const [row] = await db
    .select({ profileId: clients.profileId })
    .from(clients)
    .where(eq(clients.id, client.id));
  readerProfileId = row!.profileId;
});

afterAll(async () => {
  await db.delete(revisions).where(inArray(revisions.skillId, ids));
  await db.delete(skills).where(inArray(skills.id, ids));
  await db.delete(events).where(inArray(events.skillId, ids));
  if (readerClientId) {
    await db.delete(events).where(eq(events.clientId, readerClientId));
    await db.delete(clients).where(eq(clients.id, readerClientId));
  }
  if (readerProfileId)
    await db.delete(profiles).where(eq(profiles.id, readerProfileId));
});

test("initialize advertises Skills Over MCP and keeps reader/admin tool counts", async () => {
  for (const [token, count] of [
    [readerToken, 5],
    [adminToken, 9],
  ] as const) {
    const init = await rpc(token, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "mcp-skills-extension-test", version: "0.0.0" },
    });
    expect(init.result.capabilities.extensions[SKILLS_EXTENSION_ID]).toEqual(
      {},
    );
    expect(init.result.capabilities.resources).toBeTruthy();
    expect(init.result.instructions).toContain("skills/list");
    expect(init.result.instructions).toContain("search_skills");
    const tools = await rpc(token, "tools/list", {});
    expect(tools.result.tools.length).toBe(count);
  }
});

test("skills/list returns only granted leaves with verbatim frontmatter and digests", async () => {
  const listed = await rpc(readerToken, "skills/list", {});
  const uris = listed.result.skills.map((s: { uri: string }) => s.uri);
  expect(uris).toContain(`skill://${grantedId}/SKILL.md`);
  expect(uris).toContain(`skill://${reviseId}/SKILL.md`);
  expect(uris).not.toContain(`skill://${hiddenId}/SKILL.md`);
  expect(uris).not.toContain(`skill://${disabledId}/SKILL.md`);
  expect(uris).not.toContain(`skill://${bundleId}/SKILL.md`);
  const entry = listed.result.skills.find(
    (s: { uri: string }) => s.uri === `skill://${grantedId}/SKILL.md`,
  );
  expect(entry.frontmatter.name).toBe(grantedId);
  expect(entry.frontmatter.description).toBe("Quality workflow for a fixture");
  expect(entry.resources.map((r: { uri: string }) => r.uri).sort()).toEqual(
    [
      `skill://${grantedId}/SKILL.md`,
      `skill://${grantedId}/references/guide.md`,
      `skill://${grantedId}/scripts/run.sh`,
      `skill://${grantedId}/assets/icon.bin`,
    ].sort(),
  );
  const loaded = JSON.parse(
    (
      await rpc(readerToken, "tools/call", {
        name: "load_skill",
        arguments: { id: grantedId },
      })
    ).result.content[0].text,
  );
  for (const file of loaded.files) {
    expect(
      entry.resources.find(
        (r: { uri: string }) => r.uri === `skill://${grantedId}/${file.path}`,
      ).digest,
    ).toBe("sha256:" + file.sha256);
  }
  expect(entry._meta["io.modelcontextprotocol.skills/revision"]).toBe(
    firstRevision,
  );
  expect(entry._meta["io.modelcontextprotocol.skills/referenceId"]).toBe(
    grantedReferenceId,
  );
  expect(listed.result.cacheScope).toBe("private");
});

test("skills/get accepts slug and referenceId aliases and echoes the canonical URI", async () => {
  const bySlug = await rpc(readerToken, "skills/get", {
    uri: `skill://${grantedId}/SKILL.md`,
  });
  const byReference = await rpc(readerToken, "skills/get", {
    uri: `skill://${grantedReferenceId}/SKILL.md`,
  });
  expect(bySlug.result.skill.uri).toBe(`skill://${grantedId}/SKILL.md`);
  expect(byReference.result.skill.uri).toBe(bySlug.result.skill.uri);
  expect(byReference.result.skill.resources).toEqual(
    bySlug.result.skill.resources,
  );
});

test("skills/get and resources/read of another client's skill are invalid params", async () => {
  const get = await rpc(readerToken, "skills/get", {
    uri: `skill://${hiddenId}/SKILL.md`,
  });
  expect(get.error.code).toBe(-32602);
  const read = await rpc(readerToken, "resources/read", {
    uri: `skill://${hiddenId}/SKILL.md`,
  });
  expect(read.error.code).toBe(-32602);
});

test("resources/read returns published SKILL.md bytes and rejects paths outside the manifest", async () => {
  const listed = await rpc(readerToken, "skills/list", {});
  const entry = listed.result.skills.find(
    (s: { uri: string }) => s.uri === `skill://${grantedId}/SKILL.md`,
  );
  const read = await rpc(readerToken, "resources/read", {
    uri: `skill://${grantedId}/SKILL.md`,
  });
  const expected = grantedFiles()[0];
  expect(read.result.contents[0].text).toBe(
    Buffer.from(expected.content, "base64").toString("utf8"),
  );
  expect(read.result.contents[0].uri).toBe(`skill://${grantedId}/SKILL.md`);
  expect(sha256(read.result.contents[0].text)).toBe(expected.sha256);
  expect(
    entry.resources.find(
      (r: { uri: string }) => r.uri === `skill://${grantedId}/SKILL.md`,
    ).digest,
  ).toBe("sha256:" + expected.sha256);
  const missing = await rpc(readerToken, "resources/read", {
    uri: `skill://${grantedId}/missing.md`,
  });
  expect(missing.error.code).toBe(-32602);
  const binary = await rpc(readerToken, "resources/read", {
    uri: `skill://${grantedId}/assets/icon.bin`,
  });
  expect(binary.result.contents[0].blob).toBe(png.toString("base64"));
  expect(binary.result.contents[0].text).toBeUndefined();
});

test("publishing a new revision updates skills/get digests", async () => {
  const before = await rpc(readerToken, "skills/get", {
    uri: `skill://${reviseId}/SKILL.md`,
  });
  const nextFiles = reviseFiles("Second revision.");
  const published = await publish(
    ADMIN,
    reviseId,
    nextFiles,
    reviseRevision,
    "Revise fixture",
  );
  const after = await rpc(readerToken, "skills/get", {
    uri: `skill://${reviseId}/SKILL.md`,
  });
  const previousDigest = before.result.skill.resources.find(
    (r: { uri: string }) => r.uri === `skill://${reviseId}/SKILL.md`,
  ).digest;
  const nextDigest = after.result.skill.resources.find(
    (r: { uri: string }) => r.uri === `skill://${reviseId}/SKILL.md`,
  ).digest;
  expect(nextDigest).not.toBe(previousDigest);
  expect(nextDigest).toBe("sha256:" + nextFiles[0].sha256);
  expect(
    after.result.skill._meta["io.modelcontextprotocol.skills/revision"],
  ).toBe(published.revision);
});

test("search_skills and load_skill still work on the same server", async () => {
  const search = await rpc(readerToken, "tools/call", {
    name: "search_skills",
    arguments: {},
  });
  const payload = JSON.parse(search.result.content[0].text);
  expect(payload.items.map((s: { id: string }) => s.id)).toContain(grantedId);
  expect(payload.items.map((s: { id: string }) => s.id)).not.toContain(hiddenId);
  const loaded = await rpc(readerToken, "tools/call", {
    name: "load_skill",
    arguments: { id: grantedId },
  });
  const skill = JSON.parse(loaded.result.content[0].text);
  expect(skill.id).toBe(grantedId);
  expect(skill.instructions).toContain("Read the docs.");
});

test("executable skill scripts are returned as bytes and not executed", async () => {
  const marker = "/tmp/skillbox-sep-did-run-" + suffix;
  const script = await rpc(readerToken, "resources/read", {
    uri: `skill://${grantedId}/scripts/run.sh`,
  });
  expect(script.result.contents[0].text).toBe("#!/bin/sh\necho ran\n");
  expect(await Bun.file(marker).exists()).toBe(false);
});
