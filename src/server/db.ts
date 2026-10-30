import { packageMetrics } from "../package-metrics";
import { compatibilityString, declaredHarnesses } from "./compatibility";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
export const connection = postgres(
  process.env.DATABASE_URL ?? "postgres://localhost/skillbox",
  { max: 8, onnotice: () => {} },
);
export const db = drizzle(connection, { schema });
export async function migrate() {
  await connection`CREATE TABLE IF NOT EXISTS skills (id text PRIMARY KEY,title text NOT NULL,description text NOT NULL,tags jsonb NOT NULL DEFAULT '[]',revision text NOT NULL,search_text text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())`;
  await connection`ALTER TABLE skills ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'skill', ADD COLUMN IF NOT EXISTS members jsonb NOT NULL DEFAULT '[]', ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS replacement text`;
  await connection`ALTER TABLE skills ADD COLUMN IF NOT EXISTS disabled boolean NOT NULL DEFAULT false`;
  await connection`ALTER TABLE skills ADD COLUMN IF NOT EXISTS icon jsonb`;
  await connection`CREATE TABLE IF NOT EXISTS revisions (id text PRIMARY KEY,skill_id text NOT NULL REFERENCES skills(id),metadata jsonb NOT NULL,files jsonb NOT NULL,checksum text NOT NULL,message text NOT NULL,author text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`;
  await connection`ALTER TABLE revisions ADD COLUMN IF NOT EXISTS source jsonb`;
  await connection`CREATE INDEX IF NOT EXISTS revisions_skill_idx ON revisions(skill_id)`;
  await connection`CREATE INDEX IF NOT EXISTS skills_search_idx ON skills USING gin(to_tsvector('english',search_text))`;
  await connection`CREATE TABLE IF NOT EXISTS clients (id text PRIMARY KEY,name text NOT NULL,token_hash text NOT NULL UNIQUE,role text NOT NULL DEFAULT 'reader',all_skills boolean NOT NULL DEFAULT false,skill_ids jsonb NOT NULL DEFAULT '[]',active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now())`;
  await connection`CREATE TABLE IF NOT EXISTS profiles (id text PRIMARY KEY,name text NOT NULL,all_skills boolean NOT NULL DEFAULT false,skill_ids jsonb NOT NULL DEFAULT '[]',permissions jsonb NOT NULL,version text NOT NULL DEFAULT gen_random_uuid()::text)`;
  await connection`ALTER TABLE clients ADD COLUMN IF NOT EXISTS profile_id text REFERENCES profiles(id)`;
  // Equivalent legacy grants share a profile. Tokens and client identity never change.
  await connection.begin(async (tx) => {
    const legacy =
      await tx`SELECT * FROM clients WHERE profile_id IS NULL ORDER BY created_at,id FOR UPDATE`;
    for (const c of legacy) {
      const permissions = {
        create: c.role === "writer",
        update: c.role === "writer",
        delete: false,
        propose: false,
      };
      const grants = [...c.skill_ids].sort();
      const id =
        "legacy-" +
        Bun.hash(JSON.stringify([c.all_skills, grants, permissions])).toString(
          16,
        );
      const name = c.all_skills
        ? c.role === "writer"
          ? "Library editors"
          : "Library readers"
        : c.name;
      await tx`INSERT INTO profiles (id,name,all_skills,skill_ids,permissions) VALUES (${id},${name},${c.all_skills},${JSON.stringify(grants)}::jsonb,${JSON.stringify(permissions)}::jsonb) ON CONFLICT (id) DO NOTHING`;
      await tx`UPDATE clients SET profile_id=${id} WHERE id=${c.id}`;
    }
  });
  await connection`ALTER TABLE clients ALTER COLUMN profile_id SET NOT NULL`;
  await connection`CREATE TABLE IF NOT EXISTS proposals (id text PRIMARY KEY,skill_id text NOT NULL,client_id text NOT NULL,client_name text NOT NULL,expected_revision text NOT NULL,files jsonb NOT NULL,message text NOT NULL,status text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz,reviewer text,published_revision text)`;
  await connection`CREATE TABLE IF NOT EXISTS sessions (hash text PRIMARY KEY,expires_at timestamptz NOT NULL)`;
  await connection`CREATE TABLE IF NOT EXISTS events (id text PRIMARY KEY,client_id text NOT NULL,client_name text NOT NULL,operation text NOT NULL,skill_id text,created_at timestamptz NOT NULL DEFAULT now())`;
  await connection`CREATE INDEX IF NOT EXISTS events_skill_access_idx ON events(skill_id, created_at DESC) WHERE operation IN ('load', 'read_file', 'bundle')`;
  await connection`ALTER TABLE events ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}'`;
  await connection`CREATE TABLE IF NOT EXISTS workspace_settings (id text PRIMARY KEY, value jsonb NOT NULL)`;
  await connection`ALTER TABLE skills ADD COLUMN IF NOT EXISTS package_metrics jsonb`;
  const unmeasured =
    await connection`SELECT s.id,s.revision,r.files FROM skills s JOIN revisions r ON r.id=s.revision WHERE s.package_metrics IS NULL`;
  for (const row of unmeasured)
    await connection`UPDATE skills SET package_metrics=${JSON.stringify(packageMetrics(row.files))}::jsonb WHERE id=${row.id} AND revision=${row.revision}`;
  await connection`ALTER TABLE skills ADD COLUMN IF NOT EXISTS reference_id text NOT NULL DEFAULT gen_random_uuid()::text`;
  await connection`CREATE UNIQUE INDEX IF NOT EXISTS skills_reference_id_idx ON skills(reference_id)`;
  await connection`ALTER TABLE skills ADD COLUMN IF NOT EXISTS compatibility text NOT NULL DEFAULT ''`;
  await connection`ALTER TABLE skills ADD COLUMN IF NOT EXISTS harness_policy jsonb NOT NULL DEFAULT '{"mode":"any","products":[]}'::jsonb`;
  await connection`CREATE INDEX IF NOT EXISTS events_client_connect_idx ON events(client_id, created_at DESC) WHERE operation = 'connect'`;
  await backfillHarnessPolicy();
  await connection`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS default_harness text`;
}

// Skills published before the compatibility columns existed keep the column
// defaults, so derive their policy once from the current revision's frontmatter.
export async function backfillHarnessPolicy() {
  const [done] =
    await connection`SELECT 1 FROM workspace_settings WHERE id='harness_policy_backfill'`;
  if (done) return;
  const rows =
    await connection`SELECT s.id,s.revision,r.metadata->'frontmatter' AS frontmatter FROM skills s JOIN revisions r ON r.id=s.revision WHERE s.compatibility='' AND s.harness_policy->>'mode'='any'`;
  for (const row of rows) {
    const frontmatter = row.frontmatter;
    if (!frontmatter || typeof frontmatter !== "object") continue;
    let compatibility = "";
    let policy;
    try {
      compatibility = compatibilityString(frontmatter);
      policy = declaredHarnesses(frontmatter);
    } catch {
      continue;
    }
    if (!compatibility && policy.mode === "any") continue;
    await connection`UPDATE skills SET compatibility=${compatibility},harness_policy=${JSON.stringify(policy)}::jsonb WHERE id=${row.id} AND revision=${row.revision}`;
  }
  await connection`INSERT INTO workspace_settings(id,value) VALUES ('harness_policy_backfill','true'::jsonb) ON CONFLICT(id) DO NOTHING`;
}
