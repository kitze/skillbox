import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, rename, rm, lstat } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
export const hash = (v) => createHash("sha256").update(v).digest("hex");
export function verifyBundle(bundle) {
  if (
    bundle?.format !== "skillbox/v1" ||
    !/^[a-z0-9][a-z0-9-]{0,79}$/.test(bundle.id) ||
    !/^[-a-zA-Z0-9]{1,100}$/.test(bundle.revision) ||
    !Array.isArray(bundle.files) ||
    bundle.files.length > 400
  )
    throw new Error("Invalid package");
  const seen = new Set();
  let total = 0;
  const files = bundle.files.map((f) => {
    if (
      typeof f.path !== "string" ||
      f.path.length > 240 ||
      f.path.startsWith("/") ||
      f.path.includes("\\") ||
      /[\x00-\x1f:]/.test(f.path) ||
      f.path.split("/").some((p) => !p || p === "." || p === "..")
    )
      throw new Error("Unsafe package path");
    const key = f.path.normalize("NFC").toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate package path");
    seen.add(key);
    const bytes = Buffer.from(f.content, "base64");
    if (
      bytes.toString("base64") !== f.content ||
      bytes.length !== f.size ||
      hash(bytes) !== f.sha256 ||
      bytes.length > 2_000_000 ||
      typeof f.executable !== "boolean"
    )
      throw new Error("Package integrity check failed");
    total += bytes.length;
    return { ...f, bytes };
  });
  if (total > 8_000_000 || !bundle.files.some((f) => f.path === "SKILL.md"))
    throw new Error("Invalid package size or missing SKILL.md");
  for (const p of seen)
    for (const q of seen)
      if (q.startsWith(p + "/")) throw new Error("Package path collision");
  const checksum = hash(
    JSON.stringify(
      [...bundle.files]
        .sort((a, b) => a.path.localeCompare(b.path, "en-US"))
        .map((f) => [f.path, f.sha256, f.executable]),
    ),
  );
  if (checksum !== bundle.checksum)
    throw new Error("Package checksum mismatch");
  return files;
}
export async function materialize(bundle, root) {
  const files = verifyBundle(bundle);
  root = resolve(root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink())
    throw new Error("Cache root cannot be a symlink");
  const target = join(root, `${bundle.id}-${bundle.revision}`),
    tmp = join(root, ".download-" + randomUUID());
  await mkdir(tmp, { mode: 0o700 });
  try {
    for (const f of files) {
      const dest = join(tmp, f.path);
      await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
      await writeFile(dest, f.bytes, {
        mode: f.executable ? 0o700 : 0o600,
        flag: "wx",
      });
    }
    try {
      await rename(tmp, target);
    } catch (e) {
      const collision = e.code === "ENOTEMPTY" || e.code === "EEXIST";
      let targetExists = false;
      if (e.code === "EPERM") {
        try {
          await lstat(target);
          targetExists = true;
        } catch {
          // EPERM without an existing target is a real rename failure.
        }
      }
      if (!collision && !targetExists) throw e;
      /* Never trust an existing mutable cache directory: return this freshly verified copy. */ const fresh =
        target + "-" + randomUUID();
      await rename(tmp, fresh);
      return fresh;
    }
    return target;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
