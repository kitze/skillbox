import { evaluateJev, createRecommender } from "../src/server/recommendations";
import { candidates, cases } from "../tests/fixtures/recommendation-cases";

if (!process.argv.includes("--live"))
  throw new Error("Pass --live to send synthetic fixtures to Jev (billable).");
// This explicit developer benchmark is separate from app Settings; never auto-imports a key.
const providerIndex = process.argv.indexOf("--provider");
const provider = providerIndex < 0 ? "vercel" : process.argv[providerIndex + 1];
if (
  provider !== "vercel" &&
  provider !== "typesafe" &&
  provider !== "openrouter"
)
  throw new Error("Choose --provider vercel, typesafe or openrouter");
const apiKey =
  provider === "openrouter"
    ? process.env.OPENROUTER_API_KEY
    : provider === "typesafe"
      ? (process.env.TYPESAFE_API_KEY ?? process.env.JEV_KEY)
      : process.env.AI_GATEWAY_API_KEY;
if (!apiKey)
  throw new Error(
    provider === "openrouter"
      ? "OPENROUTER_API_KEY is required for this benchmark"
      : provider === "typesafe"
        ? "TYPESAFE_API_KEY or JEV_KEY is required for this benchmark"
        : "AI_GATEWAY_API_KEY is required for this benchmark",
  );
const observations: Array<{
  task: string;
  ms: number;
  matched: string[];
  expected: string[];
  exact: boolean;
}> = [];
let totalCost = 0,
  reportedCostResponses = 0,
  failures = 0,
  inputTokens = 0;
// Sequential requests, no retries. Small sample, not a production benchmark or SLA.
for (let run = 0; run < 3; run++) {
  for (const fixture of cases) {
    const started = performance.now();
    try {
      const result = await evaluateJev(
        fixture.task,
        candidates,
        AbortSignal.timeout(8000),
        apiKey,
        provider,
      );
      const matched = candidates
        .filter((_, i) => result.scores[i] >= 3)
        .map((s) => s.id)
        .sort();
      const expected = [...fixture.expected].sort();
      observations.push({
        task: fixture.task,
        ms: Math.round(performance.now() - started),
        matched,
        expected,
        exact: JSON.stringify(matched) === JSON.stringify(expected),
      });
      if (result.cost && Number.isFinite(Number(result.cost))) {
        totalCost += Number(result.cost);
        reportedCostResponses++;
      }
      inputTokens += result.usage?.inputTokens ?? 0;
    } catch {
      failures++;
    }
  }
}
const times = observations.map((o) => o.ms).sort((a, b) => a - b);
const percentile = (p: number) =>
  times.length ? times[Math.ceil(times.length * p) - 1] : null;
let evaluations = 0;
const recommend = createRecommender(async (...args) => {
  evaluations++;
  return evaluateJev(...args, apiKey, provider);
});
const deps = {
  catalog: async () => ({ scope: "synthetic-benchmark", candidates }),
  search: async () => ({ items: [], hasMore: false, nextOffset: null }),
};
await recommend(deps, { task: cases[0].task });
const cached = await recommend(deps, { task: cases[0].task });
console.log(
  JSON.stringify(
    {
      kind: "small-synthetic-relevance-check-not-production-SLA",
      provider,
      candidateCount: candidates.length,
      distinctTasks: cases.length,
      repetitions: 3,
      successfulRequests: observations.length,
      failures,
      exactMatches: observations.filter((o) => o.exact).length,
      requestLatencyMs: { p50: percentile(0.5), p95: percentile(0.95) },
      reportedCostUSD: reportedCostResponses ? totalCost : null,
      reportedCostResponses,
      reportedInputTokens: inputTokens,
      cacheCheck: {
        method: cached.method,
        cacheHit: cached.cacheHit,
        elapsedMs: cached.elapsedMs,
        evaluations,
      },
      observations,
    },
    null,
    2,
  ),
);
if (failures || observations.some((o) => !o.exact) || !cached.cacheHit)
  process.exitCode = 1;
