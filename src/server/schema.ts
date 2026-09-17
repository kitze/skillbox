import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  jsonb,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import type { HarnessPolicy, SkillFile, SkillMetadata } from "../shared";
export const skills = pgTable("skills", {
  referenceId: text("reference_id")
    .notNull()
    .unique()
    .default(sql`gen_random_uuid()::text`),
  packageMetrics:
    jsonb("package_metrics").$type<
      ReturnType<typeof import("../package-metrics").packageMetrics>
    >(),
  icon: jsonb("icon").$type<import("../skill-icons").SkillIcon | null>(),
  id: text("id").primaryKey(),
  kind: text("kind").$type<"skill" | "bundle">().notNull().default("skill"),
  members: jsonb("members").$type<string[]>().notNull().default([]),
  archived: boolean("archived").notNull().default(false),
  disabled: boolean("disabled").notNull().default(false),
  replacement: text("replacement"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  compatibility: text("compatibility").notNull().default(""),
  harnessPolicy: jsonb("harness_policy")
    .$type<HarnessPolicy>()
    .notNull()
    .default({ mode: "any", products: [] }),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  revision: text("revision").notNull(),
  searchText: text("search_text").notNull(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const revisions = pgTable(
  "revisions",
  {
    id: text("id").primaryKey(),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id),
    metadata: jsonb("metadata").$type<SkillMetadata>().notNull(),
    files: jsonb("files").$type<SkillFile[]>().notNull(),
    checksum: text("checksum").notNull(),
    message: text("message").notNull(),
    author: text("author").notNull(),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("revisions_skill_idx").on(t.skillId)],
);
export const profiles = pgTable("profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  allSkills: boolean("all_skills").notNull().default(false),
  skillIds: jsonb("skill_ids").$type<string[]>().notNull().default([]),
  permissions: jsonb("permissions")
    .$type<import("../shared").Permissions>()
    .notNull(),
  defaultHarness: text("default_harness"),
  version: text("version")
    .notNull()
    .default(sql`gen_random_uuid()::text`),
});
export const proposals = pgTable("proposals", {
  id: text("id").primaryKey(),
  skillId: text("skill_id").notNull(),
  clientId: text("client_id").notNull(),
  clientName: text("client_name").notNull(),
  expectedRevision: text("expected_revision").notNull(),
  files: jsonb("files").$type<SkillFile[]>().notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
  reviewedAt: timestamp("reviewed_at", { mode: "string", withTimezone: true }),
  reviewer: text("reviewer"),
  publishedRevision: text("published_revision"),
});
export const clients = pgTable("clients", {
  profileId: text("profile_id")
    .notNull()
    .references(() => profiles.id),
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  role: text("role").notNull().default("reader"),
  allSkills: boolean("all_skills").notNull().default(false),
  skillIds: jsonb("skill_ids").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const sessions = pgTable("sessions", {
  hash: text("hash").primaryKey(),
  expiresAt: timestamp("expires_at", {
    mode: "string",
    withTimezone: true,
  }).notNull(),
});
export const events = pgTable("events", {
  context: jsonb("context")
    .$type<import("../shared").AccessContext>()
    .notNull()
    .default({}),
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  clientName: text("client_name").notNull(),
  operation: text("operation").notNull(),
  skillId: text("skill_id"),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
});
