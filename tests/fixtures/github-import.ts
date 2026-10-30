import { createHash } from "node:crypto";
export const IMPORT_COMMIT = "a".repeat(40);
export function githubFixture(
  id = "example",
  options: {
    prefix?: string;
    secret?: boolean;
    mode?: string;
    truncated?: boolean;
    oversized?: boolean;
  } = {},
) {
  const prefix = options.prefix ?? "skills/example/";
  const files = [
    {
      path: prefix + "SKILL.md",
      bytes: Buffer.from(
        `---\nname: ${id}\ndescription: Fixture skill\n---\nRead instructions.\n`,
      ),
      mode: "100644",
    },
    {
      path: prefix + "scripts/run.sh",
      bytes: Buffer.from(
        options.secret
          ? "ghp_" + "x".repeat(36)
          : "#!/bin/sh\nprintf never-run\n",
      ),
      mode: options.mode ?? "100755",
    },
    {
      path: prefix + "assets/data.bin",
      bytes: Buffer.from([0, 255, 2]),
      mode: "100644",
    },
    {
      path: prefix + ".env",
      bytes: Buffer.from("EXAMPLE=private"),
      mode: "100644",
    },
  ];
  const requests: string[] = [];
  const fetcher = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = new URL(String(input));
    requests.push(url.href);
    if (new Headers(init?.headers).has("Authorization"))
      throw new Error("Credential forwarded to public GitHub import");
    if (init?.redirect !== "error")
      throw new Error("Redirects must be rejected");
    if (url.hostname === "api.github.com") {
      if (url.pathname === "/repos/fixture/skills")
        return Response.json({ default_branch: "main" });
      if (url.pathname.includes("/commits/")) {
        const ref = decodeURIComponent(url.pathname.split("/commits/")[1]);
        return ["main", "feature/import", IMPORT_COMMIT].includes(ref)
          ? Response.json({
              sha: IMPORT_COMMIT,
              commit: { tree: { sha: "b".repeat(40) } },
            })
          : Response.json(
              { message: `No commit found for SHA: ${ref}` },
              { status: 422 },
            );
      }
      if (url.pathname.includes("/git/trees/"))
        return Response.json({
          truncated: options.truncated ?? false,
          tree: files.map((file) => ({
            path: file.path,
            mode: file.mode,
            type: "blob",
            size: options.oversized ? 2_000_001 : file.bytes.length,
            sha: createHash("sha1")
              .update(`blob ${file.bytes.length}\0`)
              .update(file.bytes)
              .digest("hex"),
          })),
        });
    }
    if (url.hostname === "raw.githubusercontent.com") {
      const path = url.pathname
        .split("/")
        .slice(4)
        .map(decodeURIComponent)
        .join("/");
      const file = files.find((file) => file.path === path);
      if (file) return new Response(file.bytes);
    }
    return new Response("Unexpected URL", { status: 404 });
  }) as typeof fetch;
  return { fetcher, requests, files };
}
