import { test, expect } from "bun:test";
import {
  extractSkillReferences,
  parseSkillResourceUri,
  referenceId,
  skillReferenceMarkdown,
} from "../src/skill-references";
const a = "7db2d630-923f-4457-bccf-7d1262311c64",
  b = "65bc6bd2-48ed-4d8d-bb23-e0d328b98021";
test("references use immutable UUIDs, not labels or slugs", () => {
  expect(referenceId(`skill://${a}`)).toBe(a);
  expect(referenceId("skill://android-engineering")).toBeNull();
  expect(referenceId(`https://${a}`)).toBeNull();
  expect(referenceId(`skill://${a}?x=1`)).toBeNull();
  expect(parseSkillResourceUri("skill://android-engineering")).toBeNull();
  expect(parseSkillResourceUri("skill://android-engineering/SKILL.md")).toEqual({
    idOrReference: "android-engineering",
    path: "SKILL.md",
  });
  expect(parseSkillResourceUri(`skill://${a}/references/guide.md`)).toEqual({
    idOrReference: a,
    path: "references/guide.md",
  });
  expect(parseSkillResourceUri("skill://android-engineering/SKILL.md?x=1")).toBeNull();
  expect(
    extractSkillReferences(skillReferenceMarkdown("[Brackets] & names", a)),
  ).toEqual([a]);
});
test("parse real Markdown links and definitions, skipping code and images", () => {
  const markdown = `[Target](skill://${a})\n[Again](skill://${a})\n[Other][next]\n\n[next]: skill://${b}\n\n![image](skill://00000000-0000-0000-0000-000000000000)\n\n\`[inline](skill://00000000-0000-0000-0000-000000000000)\`\n\n\`\`\`md\n[example](skill://00000000-0000-0000-0000-000000000000)\n\`\`\``;
  expect(extractSkillReferences(markdown)).toEqual([a, b]);
});
