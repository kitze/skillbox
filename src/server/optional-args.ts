import { z } from "zod";

// Some model families (notably GPT) fill every optional tool parameter with a
// placeholder instead of omitting it: "", whitespace or null. Treat those as
// absent. Required parameters are never touched.
const isPlaceholder = (value: unknown) =>
  value === null || (typeof value === "string" && value.trim() === "");
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const kind = (schema: z.ZodType) => schema._zod.def.type;

function dropPlaceholders(schema: z.ZodType, value: unknown): unknown {
  if (!(schema instanceof z.ZodObject) || !isRecord(value)) return value;
  const result: Record<string, unknown> = { ...value };
  for (const [key, field] of Object.entries(schema.shape) as [
    string,
    z.ZodType,
  ][]) {
    if (!(key in result)) continue;
    if (kind(field) !== "optional" && kind(field) !== "default") {
      result[key] = dropPlaceholders(field, result[key]);
      continue;
    }
    const inner = (field as z.ZodOptional<z.ZodType>).unwrap();
    // Keep null where the schema gives it a meaning of its own.
    if (
      isPlaceholder(result[key]) &&
      !(result[key] === null && inner.safeParse(null).success)
    )
      delete result[key];
    else result[key] = dropPlaceholders(inner, result[key]);
  }
  return result;
}

/** Validate `schema` after dropping placeholder values of optional fields. */
export function lenientArgs<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => dropPlaceholders(schema, value), schema);
}

/**
 * An optional revision selector. Revisions are UUIDs, so "latest" (which
 * models also send) can only mean the current revision, like omitting it.
 */
export function optionalRevision(revision?: string | null) {
  const value = revision?.trim();
  return !value || value.toLowerCase() === "latest" ? undefined : value;
}
