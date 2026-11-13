import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("audit CLI walks pages, reports failures and guards cursor progress", async () => {
  const requests: string[] = [];
  let brokenCursor = false;
  let incompatible = true;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      expect(request.headers.get("Authorization")).toBe("Bearer fixture-token");
      const url = new URL(request.url);
      requests.push(url.pathname + url.search);
      if (url.pathname.endsWith("/manifest"))
        return Response.json({
          skill: { uri: "skill://fixture/example/SKILL.md" },
          revision: "fixture",
        });
      const first = url.searchParams.get("offset") === "0";
      return Response.json({
        items: [
          {
            id: first ? "a" : "b",
            compatible: first || !incompatible,
            issues: first ? [{ severity: "warning" }] : [],
          },
        ],
        hasMore: first,
        nextOffset: first ? (brokenCursor ? 0 : 25) : null,
      });
    },
  });
  const run = async (...args: string[]) => {
    const child = Bun.spawn(
      [process.execPath, resolve("cli/skillbox.mjs"), ...args],
      {
        env: {
          ...process.env,
          SKILLBOX_CONFIG: "/tmp/skillbox-nonexistent-fixture-config",
          SKILLBOX_URL: `http://127.0.0.1:${server.port}`,
          SKILLBOX_TOKEN: "fixture-token",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, code };
  };
  try {
    const audit = await run("audit");
    expect(audit.code).toBe(1);
    expect(JSON.parse(audit.stdout)).toMatchObject({
      total: 2,
      compatible: 1,
      incompatible: 1,
      warningCount: 1,
    });
    expect(requests).toEqual([
      "/api/skill-compatibility?offset=0",
      "/api/skill-compatibility?offset=25",
    ]);
    incompatible = false;
    expect((await run("audit")).code).toBe(0);
    brokenCursor = true;
    const broken = await run("audit");
    expect(broken.code).toBe(1);
    expect(broken.stderr).toContain("Invalid audit pagination");
    const manifest = await run("manifest", "example");
    expect(manifest.code).toBe(0);
    expect(JSON.parse(manifest.stdout).revision).toBe("fixture");
    expect((await run("manifest")).stderr).toContain(
      "Usage: skillbox manifest <id>",
    );
  } finally {
    server.stop(true);
  }
});

test("CLI discovery sends a harness only when one is configured", async () => {
  const seen: (string | null)[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      seen.push(request.headers.get("X-Skillbox-Harness"));
      return Response.json({ items: [] });
    },
  });
  const run = async (env: Record<string, string>, ...args: string[]) => {
    const child = Bun.spawn(
      [process.execPath, resolve("cli/skillbox.mjs"), ...args],
      {
        env: {
          ...process.env,
          SKILLBOX_HARNESS: "",
          SKILLBOX_CONFIG: "/tmp/skillbox-nonexistent-fixture-config",
          SKILLBOX_URL: `http://127.0.0.1:${server.port}`,
          SKILLBOX_TOKEN: "fixture-token",
          ...env,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    return child.exited;
  };
  try {
    expect(await run({}, "list")).toBe(0);
    expect(await run({}, "search", "deploy")).toBe(0);
    expect(await run({ SKILLBOX_HARNESS: "cursor" }, "list")).toBe(0);
    expect(await run({ SKILLBOX_HARNESS: "some-new-agent" }, "search", "x")).toBe(0);
    const dir = await mkdtemp(join(tmpdir(), "skillbox-harness-"));
    const config = join(dir, "config.json");
    await writeFile(config, JSON.stringify({ harness: "cursor" }));
    expect(
      await run({ SKILLBOX_HARNESS: " ", SKILLBOX_CONFIG: config }, "list"),
    ).toBe(0);
    await rm(dir, { recursive: true, force: true });
    expect(seen).toEqual([null, null, "cursor", "some-new-agent", "cursor"]);
  } finally {
    server.stop(true);
  }
});
