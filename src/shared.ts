import type { SkillIcon } from "./skill-icons";
export type JevProvider = "vercel" | "typesafe";
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
export type SkillResourceDescriptor = {
  uri: string;
  digest: string;
  size: number;
};
export type SkillExtensionMeta = {
  "io.modelcontextprotocol.skills/revision": string;
  "io.modelcontextprotocol.skills/referenceId": string;
  "io.modelcontextprotocol.skills/checksum": string;
};
export type SkillExtensionEntry = {
  uri: string;
  frontmatter: {
    name: string;
    description: string;
    [key: string]: unknown;
  };
  resources: SkillResourceDescriptor[];
  _meta: SkillExtensionMeta;
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
};
