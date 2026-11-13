import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadRuntimeSecrets } from "../src/server/runtime-env";
import {
  renderUmbrelPackage,
  pinnedImage,
  POSTGRES_IMAGE,
} from "../scripts/package-umbrel";

const options = {
  image: "registry.example.com/team/skillbox:0.1.0@sha256:" + "a".repeat(64),
  sourceUrl: "https://example.com/skillbox",
  version: "0.1.0",
};
test("Umbrel package uses scoped deterministic secrets, proxy auth, persistent data and pinned images", () => {
  const files = renderUmbrelPackage(options);
  const manifest = Bun.YAML.parse(files["skillbox/umbrel-app.yml"]) as any;
  const compose = Bun.YAML.parse(files["skillbox/docker-compose.yml"]) as any;
  expect(manifest.id).toBe("skillbox");
  expect(manifest.deterministicPassword).toBe(true);
  expect(manifest.defaultPassword).toBe("");
  expect(manifest.permissions).toEqual([]);
  expect(manifest.description).toContain("OpenRouter");
  expect(compose.services.web.image).toBe(options.image);
  expect(compose.services.db.image).toBe(POSTGRES_IMAGE);
  expect(compose.services.web).not.toHaveProperty("build");
  expect(compose.services.web).not.toHaveProperty("ports");
  expect(compose.services.db).not.toHaveProperty("ports");
  expect(compose.services.app_proxy.environment.APP_HOST).toBe(
    "skillbox_web_1",
  );
  expect(compose.services.app_proxy.environment).not.toHaveProperty(
    "PROXY_AUTH_ADD",
  );
  expect(compose.services.app_proxy.environment.PROXY_AUTH_WHITELIST).toBe(
    "/api/*,/mcp,/cli/*,/bootstrap/*",
  );
  expect(compose.services.web.environment.SKILLBOX_ADMIN_TOKEN).toBe(
    "${APP_PASSWORD}",
  );
  expect(compose.services.db.environment.POSTGRES_PASSWORD).toBe(
    "${APP_SKILLBOX_DB_PASSWORD}",
  );
  expect(compose.services.web.environment.DATABASE_URL).toContain(
    "@skillbox_db_1:",
  );
  expect(compose.services.web.environment).not.toHaveProperty(
    "AI_GATEWAY_API_KEY",
  );
  expect(compose.services.db.volumes).toEqual([
    "${APP_DATA_DIR}/data/postgres:/var/lib/postgresql/data",
  ]);
  expect(files["skillbox/exports.sh"]).toContain(
    "${EXPORTS_APP_ID}-seed-postgres-password",
  );
  expect(Object.hasOwn(files, "skillbox/data/app/.gitkeep")).toBe(true);
  expect(Object.hasOwn(files, "skillbox/data/postgres/.gitkeep")).toBe(true);
});
test("community store ID consistently scopes directory, proxy and secret exports", () => {
  const files = renderUmbrelPackage({
    ...options,
    storeId: "example",
    iconUrl: "https://example.com/icon.svg",
  });
  const manifest = Bun.YAML.parse(
    files["example-skillbox/umbrel-app.yml"],
  ) as any;
  const compose = Bun.YAML.parse(
    files["example-skillbox/docker-compose.yml"],
  ) as any;
  expect(manifest.id).toBe("example-skillbox");
  expect(manifest.icon).toBe("https://example.com/icon.svg");
  expect(compose.services.app_proxy.environment.APP_HOST).toBe(
    "example-skillbox_web_1",
  );
  expect(compose.services.db.environment.POSTGRES_PASSWORD).toBe(
    "${APP_EXAMPLE_SKILLBOX_DB_PASSWORD}",
  );
  expect(Bun.YAML.parse(files["umbrel-app-store.yml"])).toEqual({
    id: "example",
    name: "Skillbox",
  });
});
test("packaging refuses moving/unpinned images, unsafe metadata and missing community icons", () => {
  for (const image of [
    "skillbox:latest",
    "skillbox:latest@sha256:" + "a".repeat(64),
    "skillbox@sha256:" + "a".repeat(64),
    "https://registry.example/skillbox:1@sha256:" + "a".repeat(64),
  ])
    expect(() => pinnedImage(image)).toThrow();
  for (const patch of [
    { sourceUrl: "https://user:password@example.com/repo" },
    { sourceUrl: "https://example.com/repo?token=fixture" },
    { storeId: "../escape" },
    { storeId: "example" },
    { version: "bad\nversion" },
    { port: 80 },
  ])
    expect(() => renderUmbrelPackage({ ...options, ...patch })).toThrow();
});
test("mounted startup secrets are explicit, bounded and never included in errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skillbox-secret-test-"));
  try {
    const path = join(dir, "admin");
    await writeFile(path, "fixture-owner-token-at-least-32-characters\n", {
      mode: 0o600,
    });
    const env: NodeJS.ProcessEnv = { SKILLBOX_ADMIN_TOKEN_FILE: path };
    loadRuntimeSecrets(env);
    expect(env.SKILLBOX_ADMIN_TOKEN).toBe(
      "fixture-owner-token-at-least-32-characters",
    );
    expect(() =>
      loadRuntimeSecrets({
        SKILLBOX_ADMIN_TOKEN_FILE: path,
        SKILLBOX_ADMIN_TOKEN: "fixture",
      }),
    ).toThrow("not both");
    await writeFile(path, "x".repeat(4097));
    expect(() =>
      loadRuntimeSecrets({ SKILLBOX_ADMIN_TOKEN_FILE: path }),
    ).toThrow("Cannot read SKILLBOX_ADMIN_TOKEN_FILE");
    expect(() =>
      loadRuntimeSecrets({ DATABASE_URL_FILE: join(dir, "missing") }),
    ).toThrow("Cannot read DATABASE_URL_FILE");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("setup accepts custom host/origin and rejects unsafe input before creating credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skillbox-origin-test-"));
  const run = (args: string[]) =>
    Bun.spawn([process.execPath, resolve("scripts/setup-env.ts"), ...args], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
  try {
    const invalid = run([
      "--origin",
      "https://user:fixture-password@example.com",
    ]);
    expect(await invalid.exited).not.toBe(0);
    expect(await new Response(invalid.stderr).text()).not.toContain(
      "fixture-password",
    );
    expect(await Bun.file(join(dir, ".env")).exists()).toBe(false);
    const valid = run([
      "--origin",
      "https://skills.example.com",
      "--port",
      "8499",
      "--bind",
      "0.0.0.0",
    ]);
    expect(await valid.exited).toBe(0);
    const env = await readFile(join(dir, ".env"), "utf8");
    expect(env).toContain("SKILLBOX_ORIGIN=https://skills.example.com");
    expect(env).toContain("SKILLBOX_PORT=8499");
    expect(env).toContain("SKILLBOX_BIND_ADDRESS=0.0.0.0");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
