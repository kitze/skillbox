import { expect, test } from "bun:test";
import {
  HARNESS_FAMILIES,
  catalogFilter,
  declaredHarnesses,
  familyOf,
  matchingProductTokens,
  normalizeHarness,
  productsFromCompatibility,
  summarizeCompatibility,
  visibleToHarness,
} from "../src/server/compatibility";

const claudeOnly = {
  compatibility: "Designed for Claude Code",
};
const environmentOnly = {
  compatibility: "Requires git and docker",
};
const structuredCursor = {
  compatibility: "Designed for Claude Code",
  metadata: { skillbox: { harnesses: ["cursor"] } },
};

test("normalizeHarness strips versions and lowercases client identity", () => {
  expect(normalizeHarness("cursor/1.2")).toBe("cursor");
  expect(normalizeHarness("claude-code/1.2")).toBe("claude-code");
  expect(normalizeHarness("Claude Code")).toBe("claude code");
  expect(normalizeHarness("  ")).toBeNull();
  expect(normalizeHarness(undefined)).toBeNull();
});

test("alias table maps each product token and client alias to one family", () => {
  for (const family of HARNESS_FAMILIES) {
    expect(familyOf(family.id)?.id).toBe(family.id);
    for (const alias of family.aliases)
      expect(familyOf(alias)?.id).toBe(family.id);
    for (const token of family.tokens)
      expect(familyOf(token)?.id).toBe(family.id);
    expect(matchingProductTokens(family.aliases[0])!.length).toBeGreaterThan(0);
  }
  expect(familyOf(normalizeHarness("cursor/1.2"))?.id).toBe("cursor");
  expect(familyOf(normalizeHarness("claude-code/1.2"))?.id).toBe("claude-code");
  expect(familyOf("amp-cli")).toBeNull();
});

test("environment-only compatibility stays visible to every harness", () => {
  expect(productsFromCompatibility("Requires git and docker")).toEqual([]);
  expect(declaredHarnesses(environmentOnly)).toEqual({
    mode: "any",
    products: [],
  });
  for (const harness of ["cursor", "claude-code", "codex", "gemini"])
    expect(visibleToHarness(environmentOnly, harness)).toBe(true);
});

test("product-scoped compatibility hides Claude-only skills from Cursor", () => {
  expect(productsFromCompatibility("Designed for Claude Code")).toEqual([
    "claude-code",
  ]);
  expect(visibleToHarness(claudeOnly, "cursor")).toBe(false);
  expect(visibleToHarness(claudeOnly, "claude-code")).toBe(true);
  expect(visibleToHarness(claudeOnly, "claude-code/1.2")).toBe(true);
  expect(visibleToHarness(claudeOnly, "anthropic")).toBe(true);
});

test("structured harness list overrides a contradictory compatibility string", () => {
  expect(declaredHarnesses(structuredCursor)).toEqual({
    mode: "products",
    products: ["cursor"],
  });
  expect(visibleToHarness(structuredCursor, "cursor")).toBe(true);
  expect(visibleToHarness(structuredCursor, "claude-code")).toBe(false);
  expect(summarizeCompatibility(structuredCursor).label).toBe("Cursor");
});

test("empty harness stays visible for every policy", () => {
  expect(visibleToHarness(claudeOnly, null)).toBe(true);
  expect(visibleToHarness(structuredCursor, "")).toBe(true);
  expect(visibleToHarness(environmentOnly, undefined as unknown as null)).toBe(
    true,
  );
  expect(visibleToHarness({}, "cursor")).toBe(true);
});

test("unknown harness identity fails open", () => {
  expect(visibleToHarness(claudeOnly, "amp-cli")).toBe(true);
  expect(catalogFilter({ source: "mcp", harness: "amp-cli" })).toBeNull();
  expect(catalogFilter({ source: "web", harness: "cursor" })).toBeNull();
  expect(catalogFilter({ source: "mcp", harness: "cursor/1.2" })).toEqual({
    harness: "cursor",
    tokens: matchingProductTokens("cursor")!,
  });
});

test("product tokens do not match inside unrelated words", () => {
  expect(productsFromCompatibility("cursorily inspect the tree")).toEqual([]);
  expect(productsFromCompatibility("copilotage notes")).toEqual([]);
  expect(productsFromCompatibility("works in Cursor and Codex")).toEqual([
    "cursor",
    "codex",
  ]);
});
