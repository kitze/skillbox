import { test, expect } from "bun:test";
import {
  evaluateJev,
  OPENROUTER_BATCH_BYTES,
  OPENROUTER_BATCH_SIZE,
} from "../src/server/recommendations";
const candidates = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `candidate-${i}`,
    referenceId: `uuid-${i}`,
    revision: "fixture",
    description: "A synthetic test workflow",
  }));

test("OpenRouter evaluates every bounded batch in order and normalizes cost", async () => {
  const original = globalThis.fetch;
  const seen: string[] = [];
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    calls++;
    expect(String(url)).toBe("https://openrouter.ai/api/alpha/decisions");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer fixture-openrouter");
    expect(headers.has("ai-model-id")).toBe(false);
    expect(headers.has("ai-gateway-protocol-version")).toBe(false);
    const raw = String(init?.body),
      body = JSON.parse(raw);
    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(OPENROUTER_BATCH_BYTES);
    expect(body.model).toBe("typesafe/jev-1.13");
    expect(body.state.skills.length).toBeLessThanOrEqual(OPENROUTER_BATCH_SIZE);
    const answers = Object.fromEntries(
      body.state.skills.map((s: any) => {
        seen.push(s.id);
        return [
          s.candidate,
          { type: "score", score: Number(s.id.split("-").at(-1)) % 5 },
        ];
      }),
    );
    await Promise.resolve();
    return Response.json({
      answers,
      usage: { input_tokens: 10, output_tokens: 2, cost: 0.001 },
    });
  }) as typeof fetch;
  try {
    const result = await evaluateJev(
      "Synthetic task",
      candidates(70),
      new AbortController().signal,
      "fixture-openrouter",
      "openrouter",
    );
    expect(calls).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(70);
    expect(result.scores).toEqual(Array.from({ length: 70 }, (_, i) => i % 5));
    expect(result.usage).toEqual({
      inputTokens: calls * 10,
      outputTokens: calls * 2,
    });
    expect(Number(result.cost)).toBeCloseTo(calls * 0.001);
  } finally {
    globalThis.fetch = original;
  }
});

test("OpenRouter fails the whole evaluation on one failed batch; oversized items never get sent", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (
    _url: string | URL | Request,
    _init?: RequestInit,
  ) => {
    calls++;
    return new Response("Provider body must not be exposed", {
      status: 429,
      headers: { "retry-after": "2" },
    });
  }) as typeof fetch;
  try {
    await expect(
      evaluateJev(
        "Synthetic",
        candidates(70),
        new AbortController().signal,
        "fixture",
        "openrouter",
      ),
    ).rejects.toMatchObject({ reason: "rate_limited", retryAfterMs: 2000 });
    expect(calls).toBeLessThanOrEqual(2);
    calls = 0;
    await expect(
      evaluateJev(
        "Synthetic",
        [
          {
            ...candidates(1)[0],
            description: "x".repeat(OPENROUTER_BATCH_BYTES),
          },
        ],
        new AbortController().signal,
        "fixture",
        "openrouter",
      ),
    ).rejects.toMatchObject({ reason: "catalog_limit" });
    expect(calls).toBe(0);
  } finally {
    globalThis.fetch = original;
  }
});
