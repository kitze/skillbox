import {
  canonicalSkillUri,
  parseSkillResourceUri,
} from "../skill-references";
import type {
  Principal,
  SkillExtensionEntry,
  SkillFile,
  SkillMetadata,
} from "../shared";
import { Problem, search, servedSkillRevision } from "./library";

/** SEP-2640 v1 (`skills/list`, `skills/get`); tools remain the stable Skillbox API. */
export const SKILLS_EXTENSION_ID = "io.modelcontextprotocol/skills";
export const SKILL_META_REVISION = "io.modelcontextprotocol.skills/revision";
export const SKILL_META_REFERENCE = "io.modelcontextprotocol.skills/referenceId";
export const SKILL_META_CHECKSUM = "io.modelcontextprotocol.skills/checksum";
const LIST_PAGE = 50;
const LIST_CAP = 500;

export { canonicalSkillUri, parseSkillResourceUri };

const MIME_BY_EXTENSION: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  ts: "text/plain",
  sh: "text/x-shellscript",
  bash: "text/x-shellscript",
  html: "text/html",
  css: "text/css",
  yml: "text/yaml",
  yaml: "text/yaml",
  xml: "application/xml",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  bin: "application/octet-stream",
};

export function mimeTypeForPath(path: string) {
  if (path === "SKILL.md") return "text/markdown";
  const ext = path.split(".").pop()?.toLowerCase();
  return (ext && MIME_BY_EXTENSION[ext]) || "application/octet-stream";
}

export function isBinaryFile(bytes: Buffer) {
  if (bytes.includes(0)) return true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return false;
  } catch {
    return true;
  }
}

function parseListCursor(cursor?: string) {
  if (!cursor) return 0;
  const match = /^offset:(\d+)$/.exec(cursor);
  if (!match) throw new Problem(400, "Invalid cursor");
  return Number(match[1]);
}

function fileDigest(file: SkillFile) {
  return `sha256:${file.sha256}`;
}

export function skillEntry(
  _principal: Principal,
  skill: { id: string; referenceId: string },
  revision: {
    id: string;
    checksum: string;
    metadata: SkillMetadata;
    files: SkillFile[];
  },
): SkillExtensionEntry {
  const header = revision.metadata.frontmatter ?? {};
  return {
    uri: canonicalSkillUri(skill.id, "SKILL.md"),
    frontmatter: {
      ...header,
      name: String(header.name ?? skill.id),
      description: String(header.description ?? revision.metadata.description),
    },
    resources: revision.files.map((file) => ({
      uri: canonicalSkillUri(skill.id, file.path),
      digest: fileDigest(file),
      size: file.size,
    })),
    _meta: {
      [SKILL_META_REVISION]: revision.id,
      [SKILL_META_REFERENCE]: skill.referenceId,
      [SKILL_META_CHECKSUM]: revision.checksum,
    },
  };
}

export async function listSkillEntries(
  principal: Principal,
  options: { cursor?: string; limit?: number } = {},
) {
  const offset = parseListCursor(options.cursor);
  const limit = Math.min(Math.max(options.limit ?? LIST_PAGE, 1), LIST_CAP);
  const page = await search(principal, "", limit, offset);
  const skills: SkillExtensionEntry[] = [];
  for (const item of page.items) {
    try {
      const served = await servedSkillRevision(principal, item.id);
      skills.push(
        skillEntry(principal, served.skill, served.revision),
      );
    } catch (error) {
      if (error instanceof Problem && error.status === 404) continue;
      throw error;
    }
  }
  return {
    resultType: "complete" as const,
    skills,
    ...(page.nextOffset != null
      ? { nextCursor: `offset:${page.nextOffset}` }
      : {}),
    ttlMs: 0,
    cacheScope: "private" as const,
  };
}

export async function getSkillEntry(principal: Principal, uri: string) {
  const parsed = parseSkillResourceUri(uri);
  if (!parsed || parsed.path !== "SKILL.md")
    throw new Problem(400, "Unknown skill");
  const served = await servedSkillRevision(principal, parsed.idOrReference);
  return {
    resultType: "complete" as const,
    skill: skillEntry(principal, served.skill, served.revision),
    ttlMs: 0,
    cacheScope: "private" as const,
  };
}

export async function readSkillResource(principal: Principal, uri: string) {
  const parsed = parseSkillResourceUri(uri);
  if (!parsed) throw new Problem(400, "Unknown skill");
  const served = await servedSkillRevision(principal, parsed.idOrReference);
  const file = served.revision.files.find((entry) => entry.path === parsed.path);
  if (!file) throw new Problem(404, "Unknown skill");
  const bytes = Buffer.from(file.content, "base64");
  return {
    uri: canonicalSkillUri(served.skill.id, file.path),
    mimeType: mimeTypeForPath(file.path),
    bytes,
    digest: fileDigest(file),
    size: file.size,
    binary: isBinaryFile(bytes),
  };
}
