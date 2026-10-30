import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import {
  inspectSkillPackage,
  parseSkillResourceUri,
  skillResourceUri,
  resourceContent,
  verifiedFileBytes,
} from "../src/skill-manifest";
import type { SkillFile } from "../src/shared";

const uuid = "7db2d630-923f-4457-bccf-7d1262311c64";
function file(path: string, text: string | Buffer): SkillFile {
  const bytes = Buffer.from(text);
  return {
    path,
    content: bytes.toString("base64"),
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    executable: false,
  };
}
const main = (
  header = "name: example\ndescription: A workflow",
  body = "# Example",
) => file("SKILL.md", `---\n${header}\n---\n${body}\n`);

test("manifest preserves frontmatter and all files without changing bytes", () => {
  const files = [
    main(
      "name: example\ndescription: A workflow\ncustom:\n  nested: [one, two]\nmetadata:\n  team: dev",
    ),
    file("assets/a b%.bin", Buffer.from([0, 255, 1])),
  ];
  const before = JSON.stringify(files);
  const result = inspectSkillPackage(uuid, "example", files);
  expect(result.compatible).toBe(true);
  expect(result.manifest!.frontmatter.custom).toEqual({
    nested: ["one", "two"],
  });
  expect(result.manifest!.resources).toHaveLength(2);
  for (const f of files) {
    expect(result.manifest!.resources).toContainEqual({
      uri: skillResourceUri(uuid, "example", f.path),
      digest: `sha256:${f.sha256}`,
      size: f.size,
    });
  }
  expect(JSON.stringify(files)).toBe(before);
});

test("canonical resource identities round-trip and reject aliases/traversal", () => {
  const uri = skillResourceUri(uuid, "example", "refs/a b%?.md");
  expect(parseSkillResourceUri(uri)).toEqual({
    referenceId: uuid,
    name: "example",
    path: "refs/a b%?.md",
  });
  for (const bad of [
    `skill://${uuid}`,
    `skill://example/SKILL.md`,
    uri + "?revision=x",
    uri + "#x",
    uri.replace("skillbox", "other"),
    `skill://skillbox/${uuid}/example/../SKILL.md`,
    `skill://skillbox/${uuid}/example/%2e%2e/SKILL.md`,
    `skill://skillbox/${uuid}/example/refs%2Fa.md`,
    `skill://skillbox/${uuid}/example/%ZZ`,
    `skill://skillbox/${uuid}/example/%53KILL.md`,
  ])
    expect(() => parseSkillResourceUri(bad)).toThrow();
});

test("legacy validation gaps are reported rather than repaired", () => {
  for (const [header, code] of [
    ["description: Missing name", "name"],
    ["name: example--bad\ndescription: Bad name", "name"],
    ["name: other\ndescription: Wrong ID", "name_mismatch"],
    ["name: example\ndescription: " + "x".repeat(1025), "description"],
    ["name: example\ndescription: invalid: YAML", "frontmatter_parse"],
    ["name: example\ndescription: OK\nmetadata:\n  count: 1", "metadata"],
    ["name: example\ndescription: OK\ncustom: 2026-01-01", "frontmatter_json"],
  ]) {
    const result = inspectSkillPackage(uuid, "example", [main(header)]);
    expect(result.compatible).toBe(false);
    expect(result.manifest).toBeNull();
    expect(result.issues.some((issue) => issue.code === code)).toBe(true);
  }
  const result = inspectSkillPackage(uuid, "example", [
    main(undefined, `[Other](skill://${uuid})`),
  ]);
  expect(result.compatible).toBe(true);
  expect(result.issues[0]).toMatchObject({
    code: "legacy_reference",
    severity: "warning",
  });
});

test("unencodable paths are audit issues rather than exceptions", () => {
  const result = inspectSkillPackage(uuid, "example", [
    main(),
    file("refs/\ud800.md", "text"),
  ]);
  expect(result.compatible).toBe(false);
  expect(result.issues.some((issue) => issue.code === "file_path")).toBe(true);
});

test("empty, null, scalar and sequence YAML roots fail closed without throwing", () => {
  for (const header of [
    "null",
    "~",
    "# comment only",
    "- one",
    "42",
    "true",
    "plain text",
  ]) {
    const result = inspectSkillPackage(uuid, "example", [main(header)]);
    expect(result.compatible).toBe(false);
    expect(result.manifest).toBeNull();
    expect(result.issues.length).toBeGreaterThan(0);
  }
});

test("resource reads preserve UTF-8 and binary bytes and fail on tampering", () => {
  for (const bytes of [
    Buffer.from("Zażółć 🌋\r\n"),
    Buffer.from([0xef, 0xbb, 0xbf, 65]),
    Buffer.from([255, 0, 1]),
  ]) {
    const f = file("refs/data", bytes);
    const content = resourceContent(
      skillResourceUri(uuid, "example", f.path),
      f,
    );
    const received =
      "text" in content
        ? Buffer.from(content.text!)
        : Buffer.from(content.blob!, "base64");
    expect(received).toEqual(bytes);
  }
  const f = file("refs/data", "original");
  expect(() => verifiedFileBytes({ ...f, size: f.size + 1 })).toThrow();
  expect(() =>
    resourceContent("skill://x", {
      ...f,
      content: Buffer.from("changed!").toString("base64"),
    }),
  ).toThrow();
  const corrupted = inspectSkillPackage(uuid, "example", [
    main(),
    { ...f, sha256: "0".repeat(64) },
  ]);
  expect(corrupted.compatible).toBe(false);
});
