import { test, expect } from "bun:test";
import {
  parseGitHubUrl,
  prepareGitHubImport,
} from "../src/server/github-import";
import { githubFixture, IMPORT_COMMIT } from "./fixtures/github-import";

test("GitHub URL parser accepts repository/folder/file links and rejects remote/path tricks", () => {
  expect(parseGitHubUrl("https://github.com/fixture/skills.git")).toMatchObject(
    { repository: "fixture/skills", kind: "repo" },
  );
  expect(
    parseGitHubUrl(
      "https://github.com/fixture/skills/tree/feature/import/skills/example",
    ).segments,
  ).toEqual(["feature", "import", "skills", "example"]);
  expect(
    parseGitHubUrl("https://github.com/fixture/skills/blob/main/SKILL.md").kind,
  ).toBe("blob");
  for (const url of [
    "http://github.com/a/b",
    "https://github.com.evil.test/a/b",
    "https://user@github.com/a/b",
    "https://github.com:443/a/b",
    "https://127.0.0.1/a/b",
    "https://github.com/a/b/tree/main/%2e%2e",
    "https://github.com/a/b/tree/main/a%2fb",
    "https://github.com/a/b/blob/main/README.md",
    "https://github.com/a/b?token=secret",
  ])
    expect(() => parseGitHubUrl(url)).toThrow();
});

test("GitHub imports pin refs, preserve scripts/binaries and exclude runtime files", async () => {
  const previous = globalThis.fetch;
  try {
    for (const url of [
      "https://github.com/fixture/skills/tree/feature/import/skills/example",
      "https://github.com/fixture/skills/blob/main/skills/example/SKILL.md",
      "https://github.com/fixture/skills",
    ]) {
      const fixture = githubFixture();
      globalThis.fetch = fixture.fetcher;
      const result = await prepareGitHubImport({ url });
      expect(result.kind).toBe("skill");
      if (result.kind !== "skill") throw Error("Expected package");
      expect(result.id).toBe("example");
      expect(result.source.commit).toBe(IMPORT_COMMIT);
      expect(result.source.path).toBe("skills/example");
      expect(result.source.url).toContain(IMPORT_COMMIT);
      expect(result.files).toHaveLength(3);
      expect(result.skipped).toEqual([".env"]);
      expect(
        result.files.find((file) => file.path === "scripts/run.sh")?.executable,
      ).toBe(true);
      expect(
        Buffer.from(
          result.files.find((file) => file.path === "assets/data.bin")!.content,
          "base64",
        ),
      ).toEqual(Buffer.from([0, 255, 2]));
      expect(
        fixture.requests
          .filter((url) => url.includes("raw.githubusercontent.com"))
          .every((url) => url.includes(IMPORT_COMMIT)),
      ).toBe(true);
    }
  } finally {
    globalThis.fetch = previous;
  }
});

test("repository collections list skill directories before downloading packages", async () => {
  const previous = globalThis.fetch;
  const fixture = githubFixture();
  fixture.files.push({
    path: "skills/other/SKILL.md",
    bytes: Buffer.from("---\nname: other\ndescription: Other\n---\nBody"),
    mode: "100644",
  });
  globalThis.fetch = fixture.fetcher;
  try {
    const result = await prepareGitHubImport({
      url: "https://github.com/fixture/skills",
    });
    expect(result.kind).toBe("catalog");
    if (result.kind !== "catalog") throw Error("Expected selection");
    expect(result.candidates).toEqual(["skills/example", "skills/other"]);
    expect(result.url).toContain(IMPORT_COMMIT);
    expect(
      fixture.requests.some((url) => url.includes("raw.githubusercontent.com")),
    ).toBe(false);
  } finally {
    globalThis.fetch = previous;
  }
});

test("GitHub import fails closed on secrets, symlinks, truncation and oversized packages", async () => {
  const previous = globalThis.fetch;
  try {
    for (const [options, message] of [
      [{ secret: true }, "Possible embedded secret"],
      [{ mode: "120000" }, "Symlinks and submodules"],
      [{ truncated: true }, "tree is too large"],
      [{ oversized: true }, "File exceeds 2 MB"],
    ] as const) {
      const fixture = githubFixture("example", options);
      globalThis.fetch = fixture.fetcher;
      await expect(
        prepareGitHubImport({
          url: `https://github.com/fixture/skills/tree/${IMPORT_COMMIT}/skills/example`,
        }),
      ).rejects.toThrow(message);
      if (!("secret" in options))
        expect(
          fixture.requests.some((url) =>
            url.includes("raw.githubusercontent.com"),
          ),
        ).toBe(false);
    }
  } finally {
    globalThis.fetch = previous;
  }
});
