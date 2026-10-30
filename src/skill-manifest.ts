import { createHash } from "node:crypto";
import matter from "gray-matter";
import type { SkillFile } from "./shared";

export const SKILLS_EXTENSION = "io.modelcontextprotocol/skills";
export const SKILLS_SPEC_REVISION = "2026-07-28";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export type CompatibilityIssue = {
  code: string;
  path: string;
  message: string;
  severity: "error" | "warning";
};
export type SkillManifest = {
  uri: string;
  frontmatter: { name: string; description: string; [key: string]: unknown };
  resources: { uri: string; digest: string; size: number }[];
};

function validPath(path: string) {
  try {
    encodeURIComponent(path);
  } catch {
    return false;
  } // A lone surrogate cannot be a resource URI segment.
  return (
    path.length > 0 &&
    path.length <= 240 &&
    !/[\\\x00-\x1f:]/.test(path) &&
    path.split("/").every((s) => s && s !== "." && s !== "..")
  );
}
function validName(name: unknown): name is string {
  return typeof name === "string" && name.length <= 64 && NAME.test(name);
}
function jsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return false;
  seen.add(value);
  const valid = Object.values(value).every((v) => jsonValue(v, seen));
  seen.delete(value);
  return valid;
}
export function skillResourceUri(
  referenceId: string,
  name: string,
  path = "SKILL.md",
) {
  if (!UUID.test(referenceId) || !validName(name) || !validPath(path))
    throw new Error("Invalid skill resource identity");
  return `skill://skillbox/${referenceId}/${name}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

// Parse the raw string, not URL.pathname: URL normalization would hide traversal.
export function parseSkillResourceUri(uri: string) {
  const match = /^skill:\/\/skillbox\/([^/]+)\/([^/]+)\/(.+)$/.exec(uri);
  if (!match || /[?#]/.test(uri)) throw new Error("Invalid skill resource URI");
  const [, referenceId, name, encodedPath] = match;
  const path = encodedPath
    .split("/")
    .map((segment) => {
      const decoded = decodeURIComponent(segment);
      if (decoded.includes("/")) throw new Error("Invalid skill resource URI");
      return decoded;
    })
    .join("/");
  if (skillResourceUri(referenceId, name, path) !== uri)
    throw new Error("Non-canonical skill resource URI");
  return { referenceId, name, path };
}

export function verifiedFileBytes(file: SkillFile) {
  const bytes = Buffer.from(file.content, "base64");
  if (
    bytes.toString("base64") !== file.content ||
    bytes.length !== file.size ||
    createHash("sha256").update(bytes).digest("hex") !== file.sha256
  )
    throw new Error("Skill file integrity check failed");
  return bytes;
}

/** Read-only audit. Never normalizes YAML or changes stored package bytes. */
export function inspectSkillPackage(
  referenceId: string,
  id: string,
  files: SkillFile[],
) {
  const issues: CompatibilityIssue[] = [];
  const issue = (
    code: string,
    path: string,
    message: string,
    severity: CompatibilityIssue["severity"] = "error",
  ) => issues.push({ code, path, message, severity });
  if (!UUID.test(referenceId))
    issue("reference_id", "SKILL.md", "A stable UUID is required.");
  if (files.length > 512)
    issue("file_count", "", "Extension portability limit is 512 files.");
  if (files.reduce((sum, f) => sum + f.size, 0) > 16_777_216)
    issue("package_size", "", "Extension portability limit is 16 MiB.");
  const paths = new Set<string>();
  for (const file of files) {
    if (!validPath(file.path))
      issue("file_path", file.path, "Invalid relative file path.");
    const key = file.path.normalize("NFC").toLowerCase();
    if (paths.has(key))
      issue("duplicate_path", file.path, "Duplicate file path.");
    paths.add(key);
    try {
      verifiedFileBytes(file);
    } catch {
      issue(
        "integrity",
        file.path,
        "Stored bytes do not match file digest, size or encoding.",
      );
    }
  }
  for (const path of paths) {
    const parts = path.split("/");
    for (let n = 1; n < parts.length; n++) {
      if (paths.has(parts.slice(0, n).join("/"))) {
        issue("path_conflict", path, "A parent directory is also a file.");
        break;
      }
    }
  }
  const main = files.find((file) => file.path === "SKILL.md");
  let frontmatter: Record<string, unknown> = {};
  if (!main) issue("missing_skill", "SKILL.md", "SKILL.md is required.");
  else {
    try {
      const text = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(verifiedFileBytes(main));
      if (!/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(text))
        throw new Error("Missing YAML header");
      const parsed: unknown = matter(text).data;
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        Object.getPrototypeOf(parsed) !== Object.prototype
      ) {
        issue(
          "frontmatter_object",
          "SKILL.md",
          "Frontmatter must be a YAML mapping, not a scalar or sequence.",
        );
      } else {
        frontmatter = parsed as Record<string, unknown>;
        if (!jsonValue(frontmatter))
          issue(
            "frontmatter_json",
            "SKILL.md",
            "Frontmatter must be losslessly representable as JSON.",
          );
      }
      if (/skill:\/\/[0-9a-f-]{36}(?![0-9a-f/-])/i.test(text))
        issue(
          "legacy_reference",
          "SKILL.md",
          "Legacy UUID links require Skillbox tooling; native clients need canonical SKILL.md resource URIs.",
          "warning",
        );
    } catch {
      issue(
        "frontmatter_parse",
        "SKILL.md",
        "SKILL.md must be UTF-8 with valid YAML frontmatter; no legacy normalization is applied.",
      );
    }
  }
  if (!validName(frontmatter.name))
    issue(
      "name",
      "SKILL.md",
      "Name must be 1–64 lowercase alphanumeric/hyphen characters, without edge or consecutive hyphens.",
    );
  else if (frontmatter.name !== id)
    issue(
      "name_mismatch",
      "SKILL.md",
      "Frontmatter name must match the skill ID.",
    );
  if (
    typeof frontmatter.description !== "string" ||
    !frontmatter.description.trim() ||
    frontmatter.description.length > 1024
  )
    issue(
      "description",
      "SKILL.md",
      "Description must be a non-empty string of at most 1024 characters.",
    );
  if (
    frontmatter.compatibility !== undefined &&
    (typeof frontmatter.compatibility !== "string" ||
      !frontmatter.compatibility.length ||
      frontmatter.compatibility.length > 500)
  )
    issue(
      "compatibility",
      "SKILL.md",
      "Compatibility must be a string of 1–500 characters.",
    );
  if (
    frontmatter.license !== undefined &&
    typeof frontmatter.license !== "string"
  )
    issue("license", "SKILL.md", "License must be a string.");
  if (
    frontmatter["allowed-tools"] !== undefined &&
    typeof frontmatter["allowed-tools"] !== "string"
  )
    issue(
      "allowed_tools",
      "SKILL.md",
      "Allowed tools must be a space-separated string; publication never grants execution permission.",
    );
  const metadata = frontmatter.metadata;
  if (
    metadata !== undefined &&
    (metadata === null ||
      typeof metadata !== "object" ||
      Array.isArray(metadata) ||
      Object.values(metadata).some((value) => typeof value !== "string"))
  )
    issue(
      "metadata",
      "SKILL.md",
      "Metadata must be a map of string keys to string values.",
    );
  const compatible = !issues.some((entry) => entry.severity === "error");
  const manifest: SkillManifest | null = compatible
    ? {
        uri: skillResourceUri(referenceId, id),
        frontmatter: frontmatter as SkillManifest["frontmatter"],
        resources: [...files]
          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
          .map((file) => ({
            uri: skillResourceUri(referenceId, id, file.path),
            digest: `sha256:${file.sha256}`,
            size: file.size,
          })),
      }
    : null;
  return { compatible, issues, manifest };
}

// MIME mapping adapted from Matt Van Horn's contribution in kitze/skillbox#2.
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
  return (
    MIME_BY_EXTENSION[path.split(".").pop()?.toLowerCase() ?? ""] ??
    "application/octet-stream"
  );
}

export function resourceContent(uri: string, file: SkillFile) {
  const bytes = verifiedFileBytes(file);
  try {
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    if (text.includes("\0")) throw new Error("Binary content");
    return {
      uri,
      mimeType: mimeTypeForPath(file.path),
      text,
    };
  } catch {
    return {
      uri,
      mimeType: mimeTypeForPath(file.path),
      blob: bytes.toString("base64"),
    };
  }
}
