import { readdir, lstat, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { migrate, connection, db } from "../src/server/db";
import { skills } from "../src/server/schema";
import { eq } from "drizzle-orm";
import { ADMIN, publish, sha256 } from "../src/server/library";
import type { SkillFile } from "../src/shared";
import {
  hasEmbeddedSecret,
  excludedImportPath,
} from "../src/skill-import-safety";
await migrate();
const roots = process.argv.slice(2);
if (!roots.length)
  throw new Error(
    "Usage: bun scripts/import.ts canonical/skills [installed/skills]",
  );
const report: {
  imported: string[];
  skipped: unknown[];
  sources: Record<string, string>;
  conflicts: unknown[];
  portability: unknown[];
} = { imported: [], skipped: [], sources: {}, conflicts: [], portability: [] };
const seen = new Set<string>();
for (const root of roots) {
  let referenceIds = new Map<string, string>();
  try {
    const manifest = JSON.parse(
      await readFile(join(dirname(resolve(root)), "manifest.json"), "utf8"),
    );
    if (manifest.format === "skillbox-export/v1")
      referenceIds = new Map(
        manifest.skills
          .filter((s: any) => s.referenceId)
          .map((s: any) => [s.id, s.referenceId]),
      );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const id = entry.name,
      base = join(root, id);
    try {
      await lstat(join(base, "SKILL.md"));
    } catch {
      continue;
    }
    if (seen.has(id)) {
      report.conflicts.push({
        id,
        additionalSource: resolve(base),
        resolution:
          "First source retained; original alternate preserved on disk",
      });
      continue;
    }
    seen.add(id);
    report.sources[id] = resolve(base);
    const [existing] = await db.select().from(skills).where(eq(skills.id, id));
    if (existing) {
      report.skipped.push({
        id,
        reason: "Already exists; import never overwrites",
      });
      continue;
    }
    const files: SkillFile[] = [];
    let unsafe = false;
    async function walk(dir: string, prefix = "") {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const rel = prefix + e.name,
          path = join(dir, e.name);
        if (excludedImportPath(rel)) {
          report.skipped.push({
            id,
            path: rel,
            reason: "Runtime or sync artifact",
          });
          continue;
        }
        const stat = await lstat(path);
        if (stat.isSymbolicLink()) {
          report.skipped.push({ id, path: rel, reason: "Symlink unsupported" });
          continue;
        }
        if (stat.isDirectory()) {
          await walk(path, rel + "/");
          continue;
        }
        if (!stat.isFile()) continue;
        const bytes = await readFile(path);
        const text = bytes.toString("utf8");
        if (hasEmbeddedSecret(text)) {
          unsafe = true;
          report.skipped.push({
            id,
            path: rel,
            reason: "Possible embedded secret; entire skill quarantined",
          });
          continue;
        }
        if (/(?:~\/\.agents\/skills|\/home\/\w+\/|\/Users\/\w+\/)/.test(text))
          report.portability.push({
            id,
            path: rel,
            reason: "Historical machine paths require execution-host review",
          });
        files.push({
          path: rel,
          content: bytes.toString("base64"),
          sha256: sha256(bytes),
          size: bytes.length,
          executable: !!(stat.mode & 0o111),
        });
      }
    }
    try {
      await walk(base);
      if (!unsafe) {
        await publish(
          ADMIN,
          id,
          files,
          null,
          "Import from " + resolve(base),
          referenceIds.get(id),
        );
        report.imported.push(id);
        report.sources[id] = resolve(base);
      }
    } catch (e) {
      report.skipped.push({
        id,
        reason: e instanceof Error ? e.message : "Import failed",
      });
    }
  }
}
await mkdir("data", { recursive: true });
const reportText = JSON.stringify(report, null, 2);
await writeFile("data/import-report-" + Date.now() + ".json", reportText);
await writeFile("data/import-report.json", reportText);
console.log(
  JSON.stringify({
    imported: report.imported.length,
    skipped: report.skipped.length,
    alternateSources: report.conflicts.length,
    portability: report.portability.length,
    report: "data/import-report.json",
  }),
);
await connection.end();
