#!/usr/bin/env node
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  lstat,
  chmod,
} from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { hash, materialize } from "./package.mjs";
const configPath =
  process.env.SKILLBOX_CONFIG ??
  join(homedir(), ".config/skillbox/config.json");
let config = {};
try {
  config = JSON.parse(await readFile(configPath, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const base = (
  process.env.SKILLBOX_URL ??
  config.url ??
  "http://127.0.0.1:4791"
).replace(/\/$/, "");
const token = process.env.SKILLBOX_TOKEN ?? config.token;
const url = new URL(base);
if (
  url.protocol !== "https:" &&
  !(
    url.protocol === "http:" &&
    (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      process.env.SKILLBOX_ALLOW_INSECURE_HTTP === "1" ||
      config.allowInsecureHttp === true)
  )
)
  throw new Error(
    "Use HTTPS outside localhost. For a trusted LAN only, explicitly set SKILLBOX_ALLOW_INSECURE_HTTP=1.",
  );
let harness = "skillbox-cli";
// Mirror modern MCP body metadata into its required HTTP headers (SEP-2243).
// Keep this bridge dependency-free so installed Node/Bun clients need no SDK.
function mcpRequestHeaders(message) {
  const version =
    message.params?._meta?.["io.modelcontextprotocol/protocolVersion"];
  if (
    typeof version !== "string" ||
    typeof message.method !== "string" ||
    message.id === undefined
  )
    return {};
  const headers = {
    "MCP-Protocol-Version": version,
    "Mcp-Method": message.method,
  };
  const name =
    message.method === "resources/read"
      ? message.params?.uri
      : message.params?.name;
  if (typeof name === "string") {
    const encoded =
      !name ||
      name.trim() !== name ||
      /[^\x09\x20-\x7e]/.test(name) ||
      (name.startsWith("=?base64?") && name.endsWith("?="));
    headers["Mcp-Name"] = encoded
      ? `=?base64?${Buffer.from(name, "utf8").toString("base64")}?=`
      : name;
  }
  return headers;
}
async function request(path, options = {}, preserveProtocolErrors = false) {
  if (!token) throw new Error("Set SKILLBOX_TOKEN or configure the client");
  const r = await fetch(base + path, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: "Bearer " + token,
      "X-Skillbox-Source": "cli",
      "X-Skillbox-Harness": harness,
      ...(process.env.SKILLBOX_MODEL
        ? { "X-Skillbox-Model": process.env.SKILLBOX_MODEL }
        : {}),
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...options.headers,
    },
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    // Modern MCP uses HTTP 400 for negotiation/envelope errors. Preserve the
    // JSON-RPC envelope so a stdio client can select a supported protocol.
    if (
      preserveProtocolErrors &&
      d.jsonrpc === "2.0" &&
      typeof d.error?.code === "number" &&
      typeof d.error?.message === "string"
    )
      return d;
    throw new Error(
      typeof d.error === "string" ? d.error : `Library HTTP ${r.status}`,
    );
  }
  if (r.status === 202) return null;
  const declared = Number(r.headers.get("content-length") ?? 0);
  if (declared > 12_000_000) throw new Error("Response too large");
  const reader = r.body.getReader();
  let n = 0,
    chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > 12_000_000) {
      await reader.cancel();
      throw new Error("Response too large");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function main() {
  const [command, arg] = process.argv.slice(2);
  if (command === "mcp") {
    const lines = createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
        const clientInfo =
          msg.method === "initialize"
            ? msg.params?.clientInfo
            : msg.params?._meta?.["io.modelcontextprotocol/clientInfo"];
        if (typeof clientInfo?.name === "string")
          harness =
            clientInfo.name.slice(0, 100) +
            (clientInfo.version
              ? "/" + String(clientInfo.version).slice(0, 40)
              : "");
        const data = await request(
          "/mcp",
          {
            method: "POST",
            headers: mcpRequestHeaders(msg),
            body: JSON.stringify(msg),
          },
          true,
        );
        if (data) process.stdout.write(JSON.stringify(data) + "\n");
      } catch (e) {
        if (msg?.id !== undefined)
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              error: { code: -32603, message: e.message },
            }) + "\n",
          );
        else console.error("Skillbox bridge:", e.message);
      }
    }
    return;
  }
  if (command === "configure") {
    let raw = "";
    for await (const part of process.stdin) raw += part;
    if (raw.length > 4096) throw new Error("Configuration too large");
    const input = JSON.parse(raw);
    if (
      typeof input.token !== "string" ||
      !input.token ||
      typeof input.url !== "string"
    )
      throw new Error("Provide {url,token} as JSON on stdin");
    await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
    await writeFile(configPath, JSON.stringify(input, null, 2), {
      mode: 0o600,
    });
    await chmod(configPath, 0o600);
    console.log("Saved client configuration");
    return;
  }
  if (command === "search" || command === "list") {
    console.log(
      JSON.stringify(
        await request(
          "/api/skills?query=" +
            encodeURIComponent(
              command === "list" ? "" : process.argv.slice(3).join(" "),
            ),
        ),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "recommend") {
    const task = process.argv.slice(3).join(" ").trim();
    if (!task) throw new Error("Usage: skillbox recommend <task>");
    console.log(
      JSON.stringify(
        await request("/api/skill-recommendations", {
          method: "POST",
          body: JSON.stringify({ task }),
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "audit") {
    const items = [];
    let offset = 0;
    for (;;) {
      const page = await request("/api/skill-compatibility?offset=" + offset);
      items.push(...page.items);
      if (!page.hasMore) break;
      if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset)
        throw new Error("Invalid audit pagination");
      offset = page.nextOffset;
    }
    const incompatible = items.filter((item) => !item.compatible).length;
    console.log(
      JSON.stringify(
        {
          format: "skillbox/compatibility-v1",
          total: items.length,
          compatible: items.length - incompatible,
          incompatible,
          warningCount: items.reduce(
            (n, item) =>
              n +
              item.issues.filter((issue) => issue.severity === "warning")
                .length,
            0,
          ),
          items,
        },
        null,
        2,
      ),
    );
    if (incompatible) process.exitCode = 1;
    return;
  }
  if (command === "manifest") {
    if (!arg) throw new Error("Usage: skillbox manifest <id>");
    console.log(
      JSON.stringify(
        await request("/api/skills/" + encodeURIComponent(arg) + "/manifest"),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "load") {
    if (!arg) throw new Error("Supply a skill ID");
    console.log(
      JSON.stringify(
        await request("/api/skills/" + encodeURIComponent(arg)),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "resolve") {
    if (!arg) throw new Error("Usage: skillbox resolve <bundle-id>");
    const loaded = await request("/api/skills/" + encodeURIComponent(arg));
    if (!loaded.composition) throw new Error("This entry is not a bundle");
    console.log(
      JSON.stringify(
        { id: loaded.id, revision: loaded.revision, ...loaded.composition },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "fetch") {
    let [id, revision] = arg?.split("@") ?? [];
    if (!id) throw new Error("Usage: skillbox fetch id@revision");
    const uuid = id.replace(/^skill:\/\//i, "");
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        uuid,
      )
    )
      id = (await request("/api/skill-references/" + uuid.toLowerCase())).id;
    const b = await request(
      "/api/skills/" +
        encodeURIComponent(id) +
        "/bundle" +
        (revision ? "?revision=" + encodeURIComponent(revision) : ""),
    );
    if (b.id !== id || (revision && b.revision !== revision))
      throw new Error("Server returned a different package");
    const root = join(
      process.env.SKILLBOX_CACHE ?? join(homedir(), ".cache/skillbox"),
      hash(base + "\0" + token).slice(0, 24),
    );
    console.log(await materialize(b, root));
    return;
  }
  if (command === "publish") {
    const dir = resolve(arg ?? "."),
      id = process.argv[4];
    if (!id)
      throw new Error(
        "Usage: skillbox publish directory id expectedRevision (use new for creation)",
      );
    const expected = process.argv[5];
    if (!expected) throw new Error("Expected revision is required");
    const files = [];
    async function walk(folder, prefix = "") {
      for (const name of await readdir(folder)) {
        if (
          [".git", "node_modules", ".env"].includes(name) ||
          name.startsWith(".env.")
        )
          continue;
        const p = join(folder, name),
          s = await lstat(p),
          rel = prefix + name;
        if (s.isSymbolicLink()) throw new Error("Symlinks are not supported");
        if (s.isDirectory()) await walk(p, rel + "/");
        else if (s.isFile()) {
          if (s.size > 2_000_000) throw new Error("File exceeds 2 MB");
          const b = await readFile(p);
          files.push({
            path: rel,
            content: b.toString("base64"),
            sha256: hash(b),
            size: b.length,
            executable: !!(s.mode & 0o111),
          });
        }
      }
    }
    await walk(dir);
    console.log(
      JSON.stringify(
        await request("/api/skills/" + encodeURIComponent(id), {
          method: "PUT",
          body: JSON.stringify({
            expectedRevision: expected === "new" ? null : expected,
            files,
            message: "Update from skillbox CLI",
          }),
        }),
        null,
        2,
      ),
    );
    return;
  }
  console.log(
    "skillbox list | search <query> | recommend <task> | audit | manifest <id> | load <id> | resolve <bundle-id> | fetch <id>@<revision> | publish <directory> <id> <expectedRevision|new> | mcp | configure",
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
