import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const POSTGRES_IMAGE =
  "postgres:16.15-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685";
export type UmbrelOptions = {
  image: string;
  sourceUrl: string;
  supportUrl?: string;
  version: string;
  storeId?: string;
  iconUrl?: string;
  maintainer?: string;
  port?: number;
};
export function pinnedImage(image: string) {
  if (
    !/^[a-zA-Z0-9._/:\-]+:[a-zA-Z0-9._\-]+@sha256:[a-f0-9]{64}$/.test(image) ||
    image.includes("://")
  )
    throw new Error(
      "Use a version-tagged image with its multi-arch @sha256 digest",
    );
  const tag = image.split("@")[0].split(":").at(-1)!;
  if (
    ["latest", "main", "master", "dev", "edge", "nightly", "stable"].includes(
      tag,
    )
  )
    throw new Error("Use an immutable version or commit tag, not a moving tag");
  return image;
}
function publicUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid public project URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use an HTTPS project URL without credentials, query or fragment",
    );
  return url.href.replace(/\/$/, "");
}
export function renderUmbrelPackage(
  options: UmbrelOptions,
): Record<string, string> {
  const image = pinnedImage(options.image);
  const source = publicUrl(options.sourceUrl);
  const support = publicUrl(options.supportUrl ?? source + "/issues");
  if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(options.version))
    throw new Error("Invalid release version");
  if (options.storeId && !/^[a-z][a-z0-9-]{0,39}$/.test(options.storeId))
    throw new Error("Invalid community store ID");
  if (options.storeId && !options.iconUrl)
    throw new Error(
      "Community stores require --icon-url pointing to your public app icon",
    );
  const icon = options.iconUrl ? publicUrl(options.iconUrl) : undefined;
  const id = options.storeId ? `${options.storeId}-skillbox` : "skillbox";
  const prefix = `APP_${id.replace(/-/g, "_").toUpperCase()}`;
  const port = options.port ?? 4791;
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 2000)
    throw new Error("Choose a non-reserved app port");
  const q = JSON.stringify;
  const files: Record<string, string> = {
    [`${id}/umbrel-app.yml`]: `manifestVersion: 1
id: ${id}
category: developer
${options.storeId ? `icon: ${q(icon)}\n` : ""}name: Skillbox
version: ${q(options.version)}
tagline: Versioned skills for AI agents
description: >-
  Sign in with the app password shown by Umbrel. Skillbox starts with an empty library.


  Create and share versioned agent skills, control client access, and connect agents through MCP or the CLI.
  Optional Jev recommendations require your own OpenRouter, TypeSafe AI, or Vercel AI Gateway key in Settings. No paid service is needed for normal search and loading.
releaseNotes: >-
  Versioned skills, scoped clients, encrypted optional integration settings and task-aware recommendations.
developer: ${q(options.maintainer ?? "Skillbox contributors")}
website: ${q(source)}
repo: ${q(source)}
support: ${q(support)}
submitter: ${q(options.maintainer ?? "Skillbox contributors")}
dependencies: []
permissions: []
port: ${port}
gallery: []
path: ""
defaultUsername: ""
defaultPassword: ""
deterministicPassword: true
`,
    [`${id}/exports.sh`]: `# Sourced by Umbrel. No random regeneration, logs or global shell-option changes.
export ${prefix}_DB_PASSWORD="$(derive_entropy "app-\${EXPORTS_APP_ID}-seed-postgres-password")"
`,
    [`${id}/docker-compose.yml`]: `services:
  app_proxy:
    environment:
      APP_HOST: ${id}_web_1
      APP_PORT: 4791
      # These routes still require Skillbox auth, except public bootstrap/CLI files and login.
      # Keep Umbrel authentication on the UI; allow bearer-token agents through.
      PROXY_AUTH_WHITELIST: "/api/*,/mcp,/cli/*,/bootstrap/*"
  web:
    image: ${image}
    user: "1000:1000"
    init: true
    restart: on-failure
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: "postgres://skillbox:\${${prefix}_DB_PASSWORD}@${id}_db_1:5432/skillbox"
      SKILLBOX_ADMIN_TOKEN: "\${APP_PASSWORD}"
      SKILLBOX_ORIGIN: "http://\${DEVICE_DOMAIN_NAME}:\${APP_PROXY_PORT}"
    volumes:
      - \${APP_DATA_DIR}/data/app:/app/data
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    mem_limit: 512m
    healthcheck:
      test: ["CMD", "bun", "-e", "fetch('http://127.0.0.1:4791/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 20s
      timeout: 5s
      start_period: 30s
      retries: 3
  db:
    image: ${POSTGRES_IMAGE}
    restart: on-failure
    # Official Postgres entrypoint owns/initializes its bind mount, then drops privileges.
    environment:
      POSTGRES_USER: skillbox
      POSTGRES_DB: skillbox
      POSTGRES_PASSWORD: "\${${prefix}_DB_PASSWORD}"
    volumes:
      - \${APP_DATA_DIR}/data/postgres:/var/lib/postgresql/data
    mem_limit: 512m
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U skillbox -d skillbox"]
      interval: 5s
      timeout: 3s
      retries: 15
`,
    [`${id}/data/app/.gitkeep`]: "",
    [`${id}/data/postgres/.gitkeep`]: "",
  };
  if (options.storeId)
    files["umbrel-app-store.yml"] = `id: ${options.storeId}\nname: Skillbox\n`;
  return files;
}

export async function verifyPublicMultiarch(image: string) {
  pinnedImage(image);
  // Empty temporary Docker auth config: a private logged-in registry must not pass this gate.
  const config = await mkdtemp(join(tmpdir(), "skillbox-registry-check-"));
  try {
    await writeFile(join(config, "config.json"), '{"auths":{}}', {
      mode: 0o600,
    });
    let manifest: {
      manifests?: Array<{ platform?: { os?: string; architecture?: string } }>;
    };
    try {
      manifest = JSON.parse(
        execFileSync(
          "docker",
          ["buildx", "imagetools", "inspect", image, "--raw"],
          {
            env: { ...process.env, DOCKER_CONFIG: config },
            encoding: "utf8",
            timeout: 60_000,
            stdio: ["ignore", "pipe", "pipe"],
          },
        ),
      );
    } catch {
      throw new Error(
        "Cannot anonymously inspect image; publish it publicly and install Docker Buildx first",
      );
    }
    const platforms = new Set(
      manifest.manifests?.map(
        (m) => `${m.platform?.os}/${m.platform?.architecture}`,
      ),
    );
    if (!platforms.has("linux/amd64") || !platforms.has("linux/arm64"))
      throw new Error(
        "Umbrel requires a multi-arch index with linux/amd64 and linux/arm64",
      );
  } finally {
    await rm(config, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const flags: Record<string, string> = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    if (
      ![
        "--image",
        "--source-url",
        "--support-url",
        "--version",
        "--out",
        "--store-id",
        "--icon-url",
        "--maintainer",
        "--port",
      ].includes(args[i]) ||
      !args[i + 1]
    )
      throw new Error(
        "Usage: package-umbrel.ts --image TAG@sha256:DIGEST --source-url HTTPS_URL --version VERSION --out NEW_DIRECTORY [--store-id ID] [--port PORT]",
      );
    flags[args[i]] = args[i + 1];
  }
  if (
    !flags["--image"] ||
    !flags["--source-url"] ||
    !flags["--version"] ||
    !flags["--out"]
  )
    throw new Error(
      "Image, source URL, version and output directory are required",
    );
  const files = renderUmbrelPackage({
    image: flags["--image"],
    sourceUrl: flags["--source-url"],
    supportUrl: flags["--support-url"],
    version: flags["--version"],
    storeId: flags["--store-id"],
    iconUrl: flags["--icon-url"],
    maintainer: flags["--maintainer"],
    port: flags["--port"] ? Number(flags["--port"]) : undefined,
  });
  await verifyPublicMultiarch(flags["--image"]);
  await verifyPublicMultiarch(POSTGRES_IMAGE);
  const response = await fetch(publicUrl(flags["--source-url"]), {
    signal: AbortSignal.timeout(15_000),
  });
  await response.body?.cancel();
  if (!response.ok)
    throw new Error("Project source URL is not publicly readable");
  const out = resolve(flags["--out"]);
  await mkdir(out); // Refuse an existing destination; never overwrite a store checkout.
  for (const [path, content] of Object.entries(files)) {
    const target = join(out, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, { flag: "wx" });
  }
  console.log(
    `Generated ${out}. Run the official Umbrel linter and a real Umbrel lifecycle test before submission; generation is not store acceptance.`,
  );
}
