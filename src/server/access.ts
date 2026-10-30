import { randomUUID } from "node:crypto";
import { and, eq, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { profiles, clients, proposals } from "./schema";
import { assertAdmin, createClient } from "./auth";
import * as lib from "./library";
import type { Principal, SkillFile } from "../shared";

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  allSkills: z.boolean(),
  skillIds: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/)).max(1000),
  permissions: z.object({
    create: z.boolean(),
    update: z.boolean(),
    delete: z.boolean(),
    propose: z.boolean(),
  }),
  defaultHarness: z
    .string()
    .trim()
    .max(160)
    .nullable()
    .optional()
    .transform((value) => (value ? value : null)),
});
export async function saveProfile(
  p: Principal,
  input: z.input<typeof profileSchema>,
  id: string = randomUUID(),
  version?: string,
) {
  assertAdmin(p);
  const body = profileSchema.parse(input);
  body.skillIds = [...new Set(body.skillIds)];
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('skillbox-profile-names'))`,
    );
    const collision = await tx
      .select()
      .from(profiles)
      .where(
        sql`lower(trim(${profiles.name}))=lower(${body.name}) AND ${profiles.id}<>${id}`,
      );
    if (collision.length)
      throw new lib.Problem(409, "A profile with this name already exists");
    if (version) {
      const rows = await tx
        .update(profiles)
        .set({ ...body, version: randomUUID() })
        .where(and(eq(profiles.id, id), eq(profiles.version, version)))
        .returning();
      if (!rows.length)
        throw new lib.Problem(409, "Profile changed. Reload before saving.");
      return rows[0];
    }
    return (
      await tx
        .insert(profiles)
        .values({ id, ...body })
        .returning()
    )[0];
  });
}
export async function uniqueClient(name: string, profileId: string) {
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, profileId));
  if (!profile) throw new lib.Problem(404, "Profile not found");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('skillbox-client-names'))`,
    );
    const existing = await tx
      .select()
      .from(clients)
      .where(
        sql`lower(trim(${clients.name}))=lower(${name.trim()}) AND ${clients.active}=true`,
      );
    if (existing.length)
      throw new lib.Problem(
        409,
        "An active client already has this name. Use its existing key or give this connection a distinct name.",
      );
    return createClient(name.trim(), "reader", false, [], profileId);
  });
}
export async function propose(
  p: Principal,
  id: string,
  files: SkillFile[],
  expectedRevision: string,
  message: string,
) {
  if (!lib.permits(p, "propose"))
    throw new lib.Problem(403, "Proposal permission required");
  const current = await lib.revisionFor(p, id);
  if (current.id !== expectedRevision)
    throw new lib.Problem(409, "Skill changed. Reload before proposing.");
  lib.validateFiles(files);
  const metadata = lib.metadata(id, files);
  for (const key of [
    "kind",
    "members",
    "disabled",
    "archived",
    "replacement",
  ] as const)
    if (JSON.stringify(metadata[key]) !== JSON.stringify(current.metadata[key]))
      throw new lib.Problem(
        403,
        "Proposals can change skill content, not access or lifecycle settings",
      );
  const [row] = await db
    .insert(proposals)
    .values({
      id: randomUUID(),
      skillId: id,
      clientId: p.id,
      clientName: p.name,
      files,
      expectedRevision,
      message,
    })
    .returning({ id: proposals.id, status: proposals.status });
  await lib.record(p, "propose", id, { revision: expectedRevision });
  return row;
}
export async function listProposals(p: Principal) {
  return db
    .select({
      id: proposals.id,
      skillId: proposals.skillId,
      clientId: proposals.clientId,
      clientName: proposals.clientName,
      message: proposals.message,
      status: proposals.status,
      createdAt: proposals.createdAt,
      reviewedAt: proposals.reviewedAt,
      publishedRevision: proposals.publishedRevision,
    })
    .from(proposals)
    .where(p.role === "admin" ? undefined : eq(proposals.clientId, p.id))
    .orderBy(desc(proposals.createdAt))
    .limit(200);
}
export async function proposalDetail(p: Principal, id: string) {
  const [proposal] = await db
    .select()
    .from(proposals)
    .where(eq(proposals.id, id));
  if (!proposal || (p.role !== "admin" && proposal.clientId !== p.id))
    throw new lib.Problem(404, "Proposal not found");
  const base = await lib.revisionFor(
    p,
    proposal.skillId,
    proposal.expectedRevision,
  );
  return { ...proposal, baseFiles: base.files };
}
export async function reviewProposal(
  p: Principal,
  id: string,
  decision: "approve" | "reject",
) {
  assertAdmin(p);
  return db.transaction(async (tx) => {
    const [proposal] = await tx
      .select()
      .from(proposals)
      .where(eq(proposals.id, id))
      .for("update");
    if (!proposal) throw new lib.Problem(404, "Proposal not found");
    if (proposal.status !== "pending")
      throw new lib.Problem(409, "Proposal already reviewed");
    const result =
      decision === "approve"
        ? await lib.publish(
            { ...p, name: `${p.name} (proposal by ${proposal.clientName})` },
            proposal.skillId,
            proposal.files,
            proposal.expectedRevision,
            proposal.message,
            undefined,
            { database: tx },
          )
        : null;
    await tx
      .update(proposals)
      .set({
        status: decision === "approve" ? "approved" : "rejected",
        reviewer: p.name,
        reviewedAt: new Date().toISOString(),
        publishedRevision: result?.revision ?? null,
      })
      .where(eq(proposals.id, id));
    return { ok: true, revision: result?.revision };
  });
}
