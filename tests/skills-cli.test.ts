import { expect, test } from "bun:test";
import { resolve } from "node:path";

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
