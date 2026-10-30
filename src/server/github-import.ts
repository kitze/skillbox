import { createHash } from "node:crypto";
import matter from "gray-matter";
import { z } from "zod";
import { inspectSkillPackage } from "../skill-manifest";
import { excludedImportPath, hasEmbeddedSecret } from "../skill-import-safety";
import type { SkillFile, GitHubSource } from "../shared";
import { Problem, safePath, validateFiles, metadata } from "./library";

export const githubImportInput = z
  .object({
    url: z.string().min(1).max(2048),
    path: z.string().max(1000).optional(),
  })
  .strict();
const SHA = /^[0-9a-f]{40}$/;
const API = "https://api.github.com";
const MAX_FILES = 400,
  MAX_BYTES = 8_000_000,
  MAX_FILE_BYTES = 2_000_000;
// Bounded per-process import work; there is only one owner per instance.
let active = 0;
let starts: number[] = [];
type Entry = {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
};
type Target = {
  repository: string;
  kind: "repo" | "tree" | "blob";
  segments: string[];
};

export function parseGitHubUrl(value: string): Target {
  const raw = /^https:\/\/github\.com\/([^?#]+)\/?$/.exec(value.trim());
  if (!raw)
    throw new Problem(
      400,
      "Use a public https://github.com repository, tree, or SKILL.md URL without query parameters",
    );
  let parts: string[];
  try {
    parts = raw[1].replace(/\/$/, "").split("/").map(decodeURIComponent);
  } catch {
    throw new Problem(400, "Invalid GitHub URL encoding");
  }
  if (
    parts.some(
      (part) =>
        !part || part === "." || part === ".." || /[\\/\x00-\x1f]/.test(part),
    )
  )
    throw new Problem(400, "Invalid GitHub URL path");
  const [owner, rawRepo, kind, ...segments] = parts;
  const repo = rawRepo?.replace(/\.git$/, "");
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(owner ?? "") ||
    !/^[a-zA-Z0-9_.-]{1,100}$/.test(repo ?? "") ||
    repo === "." ||
    repo === ".."
  )
    throw new Problem(400, "Invalid GitHub repository");
  if (!kind)
    return { repository: `${owner}/${repo}`, kind: "repo", segments: [] };
  if (
    (kind !== "tree" && kind !== "blob") ||
    !segments.length ||
    segments.length > 20
  )
    throw new Problem(
      400,
      "Use a repository, tree folder, or SKILL.md file URL",
    );
  if (kind === "blob" && segments.at(-1) !== "SKILL.md")
    throw new Problem(400, "File URLs must point to SKILL.md");
  return { repository: `${owner}/${repo}`, kind, segments };
}
async function boundedBytes(response: Response, limit: number) {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Problem(413, "GitHub response exceeds import limits");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Problem(502, "GitHub returned an empty response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit)
        throw new Problem(413, "GitHub response exceeds import limits");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
  }
}
async function githubJson(
  path: string,
  signal: AbortSignal,
  missing = false,
): Promise<any> {
  const response = await fetch(API + path, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Skillbox",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "error",
    signal,
  });
  // GitHub returns 422, not only 404, when a branch/path split is not a ref.
  if ((response.status === 404 || response.status === 422) && missing) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 403 || response.status === 429)
      throw new Problem(
        429,
        "GitHub public API limit reached; try again later",
      );
    if (response.status === 404)
      throw new Problem(
        404,
        "Public repository or ref not found; private repositories are not supported",
      );
    throw new Problem(502, "GitHub request failed");
  }
  return JSON.parse((await boundedBytes(response, 4_000_000)).toString("utf8"));
}
const encodePath = (path: string) =>
  path.split("/").map(encodeURIComponent).join("/");
const sourceUrl = (repository: string, commit: string, path: string) =>
  `https://github.com/${repository}/tree/${commit}${path ? "/" + encodePath(path) : ""}`;
async function resolveTarget(target: Target, signal: AbortSignal) {
  const base = `/repos/${target.repository}`;
  let commit: any,
    path = "";
  if (target.kind === "repo") {
    const repository = await githubJson(base, signal);
    if (typeof repository.default_branch !== "string")
      throw new Problem(400, "Repository has no default branch");
    commit = await githubJson(
      `${base}/commits/${encodeURIComponent(repository.default_branch)}?per_page=1`,
      signal,
    );
  } else {
    // GitHub tree URLs are ambiguous for slash-containing refs. Resolve longest
    // ref first, with a fixed request bound. SHA-pinned previews use one lookup.
    const max = SHA.test(target.segments[0])
      ? 1
      : Math.min(target.segments.length - (target.kind === "blob" ? 1 : 0), 12);
    for (let count = max; count >= 1; count--) {
      commit = await githubJson(
        `${base}/commits/${encodeURIComponent(target.segments.slice(0, count).join("/"))}?per_page=1`,
        signal,
        true,
      );
      if (commit) {
        path = target.segments.slice(count).join("/");
        break;
      }
    }
    if (!commit)
      throw new Problem(
        404,
        "Public repository or ref not found; use a full commit SHA for long branch names",
      );
    if (target.kind === "blob")
      path = path === "SKILL.md" ? "" : path.replace(/\/SKILL\.md$/, "");
  }
  if (!SHA.test(commit?.sha) || !SHA.test(commit?.commit?.tree?.sha))
    throw new Problem(502, "Invalid GitHub commit response");
  if (SHA.test(target.segments[0] ?? "") && commit.sha !== target.segments[0])
    throw new Problem(502, "GitHub returned a different commit than requested");
  const tree = await githubJson(
    `${base}/git/trees/${commit.commit.tree.sha}?recursive=1`,
    signal,
  );
  if (tree.truncated || !Array.isArray(tree.tree) || tree.tree.length > 10_000)
    throw new Problem(413, "Repository tree is too large for URL import");
  if (
    tree.tree.some(
      (entry: Entry) =>
        typeof entry.path !== "string" ||
        entry.path.length > 1000 ||
        /[\\\\\x00-\x1f]/.test(entry.path) ||
        entry.path
          .split("/")
          .some((part) => !part || part === "." || part === ".."),
    )
  )
    throw new Problem(400, "Repository contains an unsafe path");
  return { commit: commit.sha as string, path, entries: tree.tree as Entry[] };
}

export async function prepareGitHubImport(
  input: z.input<typeof githubImportInput>,
  signal?: AbortSignal,
) {
  const args = githubImportInput.parse(input);
  const target = parseGitHubUrl(args.url);
  const now = Date.now();
  starts = starts.filter((t) => now - t < 60_000);
  if (active >= 2 || starts.length >= 12)
    throw new Problem(429, "Import limit reached; try again shortly");
  active++;
  starts.push(now);
  const deadline = AbortSignal.timeout(30_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const resolved = await resolveTarget(target, combined);
    const under = (path: string, root: string) =>
      !root || path === root || path.startsWith(root + "/");
    const candidates = resolved.entries
      .filter(
        (e) =>
          e.type === "blob" &&
          e.path.split("/").at(-1) === "SKILL.md" &&
          under(e.path, resolved.path) &&
          !excludedImportPath(e.path),
      )
      .map((e) => (e.path === "SKILL.md" ? "" : e.path.slice(0, -9)))
      .sort();
    if (!candidates.length)
      throw new Problem(400, "No SKILL.md found in this repository or folder");
    if (candidates.length > 100)
      throw new Problem(413, "Too many skills; use a URL for a smaller folder");
    let selected = args.path;
    if (selected === undefined && candidates.includes(resolved.path))
      selected = resolved.path;
    if (selected === undefined && candidates.length === 1)
      selected = candidates[0];
    if (selected === undefined)
      return {
        kind: "catalog" as const,
        url: sourceUrl(target.repository, resolved.commit, resolved.path),
        commit: resolved.commit,
        candidates,
      };
    if (!candidates.includes(selected))
      throw new Problem(
        400,
        "Choose a skill directory from this repository or folder",
      );
    const skipped: string[] = [];
    const entries = resolved.entries.filter((e) => {
      if (!under(e.path, selected) || e.type === "tree") return false;
      const relative = selected ? e.path.slice(selected.length + 1) : e.path;
      if (excludedImportPath(relative)) {
        skipped.push(relative);
        return false;
      }
      safePath(relative);
      if (e.type !== "blob" || !["100644", "100755"].includes(e.mode))
        throw new Problem(
          400,
          `Symlinks and submodules are not supported: ${relative}`,
        );
      if (
        !SHA.test(e.sha) ||
        !Number.isSafeInteger(e.size) ||
        e.size! < 0 ||
        e.size! > MAX_FILE_BYTES
      )
        throw new Problem(
          413,
          `File exceeds 2 MB or has invalid metadata: ${relative}`,
        );
      return true;
    });
    if (
      !entries.length ||
      entries.length > MAX_FILES ||
      entries.reduce((n, e) => n + e.size!, 0) > MAX_BYTES
    )
      throw new Problem(
        413,
        "Imports are limited to 400 files and 8 MB per skill",
      );
    const files: SkillFile[] = new Array(entries.length);
    let next = 0;
    const cancel = new AbortController();
    const downloads = AbortSignal.any([combined, cancel.signal]);
    let failure: unknown;
    try {
      await Promise.all(
        Array.from({ length: Math.min(4, entries.length) }, async () => {
          for (;;) {
            downloads.throwIfAborted();
            const index = next++;
            if (index >= entries.length) return;
            try {
              const entry = entries[index];
              const response = await fetch(
                `https://raw.githubusercontent.com/${target.repository}/${resolved.commit}/${encodePath(entry.path)}`,
                { redirect: "error", signal: downloads },
              );
              if (!response.ok) {
                await response.body?.cancel();
                throw new Problem(
                  502,
                  "Could not download a pinned GitHub file",
                );
              }
              const bytes = await boundedBytes(response, MAX_FILE_BYTES);
              if (
                /^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?\n/.test(
                  bytes.subarray(0, 100).toString("utf8"),
                )
              )
                throw new Problem(400, "Git LFS files are not supported");
              const gitHash = createHash("sha1")
                .update(`blob ${bytes.length}\0`)
                .update(bytes)
                .digest("hex");
              if (bytes.length !== entry.size || gitHash !== entry.sha)
                throw new Problem(
                  502,
                  "GitHub file does not match its pinned tree; Git LFS files are not supported",
                );
              const path = selected
                ? entry.path.slice(selected.length + 1)
                : entry.path;
              if (hasEmbeddedSecret(bytes.toString("utf8")))
                throw new Problem(
                  400,
                  `Possible embedded secret; import blocked: ${path}`,
                );
              files[index] = {
                path,
                content: bytes.toString("base64"),
                sha256: createHash("sha256").update(bytes).digest("hex"),
                size: bytes.length,
                executable: entry.mode === "100755",
              };
            } catch (error) {
              failure ??= error;
              cancel.abort();
              throw error;
            }
          }
        }),
      );
    } catch (error) {
      throw failure ?? error;
    }
    validateFiles(files);
    const instructions = Buffer.from(
      files.find((f) => f.path === "SKILL.md")!.content,
      "base64",
    ).toString("utf8");
    let frontmatter;
    try {
      frontmatter = matter(instructions).data;
    } catch {
      throw new Problem(400, "Invalid SKILL.md YAML frontmatter");
    }
    const id = frontmatter?.name;
    if (typeof id !== "string")
      throw new Problem(400, "SKILL.md must declare a name");
    const audit = inspectSkillPackage(
      "00000000-0000-0000-0000-000000000000",
      id,
      files,
    );
    if (!audit.compatible)
      throw new Problem(
        400,
        "Invalid skill: " +
          audit.issues
            .filter((i) => i.severity === "error")
            .map((i) => i.message)
            .join(" "),
      );
    const meta = metadata(id, files);
    if (
      meta.kind !== "skill" ||
      meta.archived ||
      meta.disabled ||
      meta.replacement ||
      meta.members.length
    )
      throw new Problem(
        400,
        "Imported skills cannot declare bundles, lifecycle controls or replacement targets",
      );
    const source: GitHubSource = {
      type: "github",
      repository: target.repository,
      commit: resolved.commit,
      path: selected,
      url: sourceUrl(target.repository, resolved.commit, selected),
    };
    return {
      kind: "skill" as const,
      id,
      source,
      files,
      instructions,
      skipped,
      warnings: audit.issues,
    };
  } catch (error) {
    if (error instanceof Problem) throw error;
    if (combined.aborted)
      throw new Problem(408, "GitHub import timed out or was cancelled");
    throw new Problem(502, "GitHub import failed");
  } finally {
    active--;
  }
}
