import type { AccessContext, HarnessPolicy } from "../shared";
import { harnessBadgeLabel } from "../shared";

export class CompatibilityError extends Error {}

export const HARNESS_ID = /^[a-z0-9][a-z0-9.-]{0,39}$/;
export const ANY_HARNESS_POLICY: HarnessPolicy = { mode: "any", products: [] };

export const HARNESS_FAMILIES = [
  {
    id: "claude-code",
    tokens: ["claude code", "claude-code", "claude"],
    aliases: ["claude-code", "claude", "claude-desktop", "anthropic"],
  },
  {
    id: "cursor",
    tokens: ["cursor"],
    aliases: ["cursor"],
  },
  {
    id: "codex",
    tokens: ["codex", "openai"],
    aliases: ["codex", "openai", "chatgpt"],
  },
  {
    id: "vscode",
    tokens: ["vscode", "github copilot", "copilot"],
    aliases: ["vscode", "copilot"],
  },
  {
    id: "gemini",
    tokens: ["gemini", "gemini-cli"],
    aliases: ["gemini", "gemini-cli"],
  },
  {
    id: "windsurf",
    tokens: ["windsurf"],
    aliases: ["windsurf"],
  },
] as const;

export type HarnessFamily = (typeof HARNESS_FAMILIES)[number];

export function normalizeHarness(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const base = trimmed.split("/")[0]!.trim();
  return base || null;
}

function unify(value: string) {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsToken(haystack: string, token: string) {
  const parts = token.split(/[\s-]+/).map(escapeRegExp);
  return new RegExp(
    `(?<![a-z0-9])${parts.join("[\\s-]+")}(?![a-z0-9])`,
  ).test(haystack);
}

export function familyOf(normalized: string | null): HarnessFamily | null {
  if (!normalized) return null;
  const key = unify(normalized);
  for (const family of HARNESS_FAMILIES) {
    if (unify(family.id) === key) return family;
    if (family.aliases.some((alias) => unify(alias) === key)) return family;
    if (family.tokens.some((token) => unify(token) === key)) return family;
  }
  return null;
}

export function matchingProductTokens(normalized: string): string[] | null {
  const family = familyOf(normalized);
  if (!family) return null;
  return [
    ...new Set([
      family.id,
      ...family.aliases,
      ...family.tokens.map((token) => unify(token)),
    ]),
  ];
}

export function compatibilityString(
  frontmatter: Record<string, unknown>,
): string {
  const value = frontmatter.compatibility;
  if (value == null) return "";
  if (typeof value !== "string")
    throw new CompatibilityError("Compatibility must be a string");
  const text = value.trim();
  if (text.length > 500)
    throw new CompatibilityError(
      "Compatibility must be at most 500 characters",
    );
  return text;
}

export function structuredHarnesses(
  frontmatter: Record<string, unknown>,
): string[] | null {
  const metadata = frontmatter.metadata;
  if (metadata == null) return null;
  if (typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const skillbox = (metadata as Record<string, unknown>).skillbox;
  if (skillbox == null) return null;
  if (typeof skillbox !== "object" || Array.isArray(skillbox)) return null;
  const harnesses = (skillbox as Record<string, unknown>).harnesses;
  if (harnesses === undefined) return null;
  if (!Array.isArray(harnesses))
    throw new CompatibilityError(
      "metadata.skillbox.harnesses must be an array of strings",
    );
  if (!harnesses.length) return null;
  if (harnesses.length > 20)
    throw new CompatibilityError(
      "metadata.skillbox.harnesses is limited to 20 entries",
    );
  if (
    harnesses.some(
      (value) => typeof value !== "string" || !HARNESS_ID.test(value),
    )
  )
    throw new CompatibilityError(
      "metadata.skillbox.harnesses entries must match ^[a-z0-9][a-z0-9.-]{0,39}$",
    );
  return [...new Set(harnesses as string[])];
}

export function productsFromCompatibility(text: string): string[] {
  if (!text.trim()) return [];
  const haystack = text.toLowerCase();
  const found: string[] = [];
  for (const family of HARNESS_FAMILIES) {
    const tokens = [...family.tokens].sort((a, b) => b.length - a.length);
    if (tokens.some((token) => containsToken(haystack, token)))
      found.push(family.id);
  }
  return found;
}

export function declaredHarnesses(
  frontmatter: Record<string, unknown>,
): HarnessPolicy {
  const structured = structuredHarnesses(frontmatter);
  if (structured?.length) return { mode: "products", products: structured };
  const products = productsFromCompatibility(compatibilityString(frontmatter));
  if (products.length) return { mode: "products", products };
  return { ...ANY_HARNESS_POLICY, products: [] };
}

export function visibleToHarness(
  frontmatter: Record<string, unknown>,
  harness: string | null,
): boolean {
  const normalized = normalizeHarness(harness ?? undefined);
  if (!normalized) return true;
  const tokens = matchingProductTokens(normalized);
  if (!tokens) return true;
  const policy = declaredHarnesses(frontmatter);
  if (policy.mode === "any") return true;
  const allowed = new Set(tokens);
  return policy.products.some((product) => {
    const family = familyOf(product);
    if (family) return family.id === familyOf(normalized)?.id;
    return allowed.has(unify(product));
  });
}

export function summarizeCompatibility(frontmatter: Record<string, unknown>) {
  const policy = declaredHarnesses(frontmatter);
  return {
    label: harnessBadgeLabel(policy),
    products: policy.mode === "products" ? policy.products : [],
  };
}

export function catalogFilter(
  context?: AccessContext,
): { harness: string; tokens: string[] } | null {
  if (!context || context.source === "web") return null;
  const harness = normalizeHarness(context.harness);
  if (!harness) return null;
  const tokens = matchingProductTokens(harness);
  if (!tokens) return null;
  return { harness, tokens };
}
