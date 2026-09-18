import type { SkillIcon } from "./skill-icons";
export type JevProvider = "vercel" | "typesafe";
export type HarnessPolicy = {
  mode: "any" | "products";
  products: string[];
};
export type CompatibilityFilter = {
  harness: string;
  filtered: boolean;
  skipped: number;
  skippedIds?: string[];
};
export const HARNESS_SUGGESTIONS = [
  "cursor",
  "claude-code",
  "claude",
  "claude-desktop",
  "anthropic",
  "codex",
  "openai",
  "chatgpt",
  "vscode",
  "copilot",
  "gemini",
  "gemini-cli",
  "windsurf",
] as const;
const HARNESS_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  claude: "Claude Code",
  "claude-desktop": "Claude Code",
  anthropic: "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  openai: "Codex",
  chatgpt: "Codex",
  vscode: "VS Code",
  copilot: "VS Code",
  "github-copilot": "VS Code",
  gemini: "Gemini",
  "gemini-cli": "Gemini",
  windsurf: "Windsurf",
};
export function harnessBadgeLabel(
  policy?: HarnessPolicy | null,
): string | null {
  if (!policy || policy.mode !== "products" || !policy.products.length)
    return null;
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const product of policy.products) {
    const label = HARNESS_LABELS[product] ?? product;
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels.join(" · ");
}
export type SkillFile = {
  path: string;
  content: string;
  sha256: string;
  size: number;
  executable: boolean;
};
export type SkillMetadata = {
  executorIntegrations?: string[];
  icon?: SkillIcon | null;
  kind: "skill" | "bundle";
  members: string[];
  archived: boolean;
  disabled: boolean;
  replacement: string | null;
  name: string;
  title: string;
  description: string;
  tags: string[];
  requirements: Record<string, unknown>;
  frontmatter: Record<string, unknown>;
  compatibility?: string;
  harnessPolicy?: HarnessPolicy;
};
export type AccessContext = {
  source?: string;
  harness?: string;
  model?: string;
  task?: string;
  purpose?: string;
  revision?: string;
  path?: string;
  outcome?: string;
};
export type Permissions = {
  create: boolean;
  update: boolean;
  delete: boolean;
  propose: boolean;
};
export type Principal = {
  profileId?: string;
  permissions?: Permissions;
  context?: AccessContext;
  id: string;
  name: string;
  role: "admin" | "writer" | "reader";
  allSkills: boolean;
  skillIds: string[];
};
export type SkillSummary = {
  referenceId?: string;
  characters?: number;
  fileCount?: number;
  packageBytes?: number;
  entryCharacters?: number;
  lastUsedAt?: string | null;
  lastAgentReadAt?: string | null;
  lastAgentReadBy?: string | null;
  readCount?: number;
  usageCount?: number;
  lastAccessedAt?: string | null;
  lastAccessedBy?: string | null;
  icon?: SkillIcon | null;
  kind: "skill" | "bundle";
  members: string[];
  archived: boolean;
  disabled: boolean;
  replacement: string | null;
  id: string;
  title: string;
  description: string;
  tags: string[];
  revision: string;
  updatedAt: string;
  compatibility?: string;
  harnessPolicy?: HarnessPolicy;
};
