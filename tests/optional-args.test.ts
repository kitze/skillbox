import { test, expect } from "bun:test";
import { z } from "zod";
import { lenientArgs, optionalRevision } from "../src/server/optional-args";

const schema = z.object({
  id: z.string(),
  revision: z.string().optional(),
  kind: z.enum(["skill", "bundle"]).optional(),
  limit: z.number().int().min(1).default(10),
  expectedRevision: z.string().nullable().optional(),
  context: z
    .object({ model: z.string().optional(), task: z.string().optional() })
    .optional(),
});

test("placeholder values of optional arguments are treated as absent", () => {
  expect(
    lenientArgs(schema).parse({
      id: "a",
      revision: "",
      kind: " \t\n",
      limit: null,
      context: { model: "", task: "ship it" },
    }),
  ).toEqual({ id: "a", limit: 10, context: { task: "ship it" } });
  expect(lenientArgs(schema).parse({ id: "a", context: null })).toEqual({
    id: "a",
    limit: 10,
  });
});

test("required arguments and real values are left alone", () => {
  const lenient = lenientArgs(schema);
  expect(lenient.parse({ id: "", revision: " r1 ", kind: "bundle" })).toEqual({
    id: "",
    revision: " r1 ",
    kind: "bundle",
    limit: 10,
  });
  expect(lenient.safeParse({ id: null }).success).toBe(false);
  expect(lenient.safeParse({ revision: "" }).success).toBe(false);
  expect(lenient.safeParse({ id: "a", kind: "other" }).success).toBe(false);
  // null keeps its own meaning where the schema accepts it.
  expect(lenient.parse({ id: "a", expectedRevision: null })).toEqual({
    id: "a",
    limit: 10,
    expectedRevision: null,
  });
  expect(
    lenientArgs(z.object({ expectedRevision: z.string().nullable() })).parse({
      expectedRevision: null,
    }),
  ).toEqual({ expectedRevision: null });
});

test("the advertised input schema is unchanged", () => {
  const advertised: unknown = z.toJSONSchema(lenientArgs(schema), {
    io: "input",
  });
  expect(advertised).toEqual(z.toJSONSchema(schema, { io: "input" }));
});

test("blank and latest revision selectors mean the current revision", () => {
  for (const value of [undefined, null, "", "  ", "latest", " Latest "])
    expect(optionalRevision(value)).toBeUndefined();
  expect(optionalRevision(" 3f0c ")).toBe("3f0c");
});
