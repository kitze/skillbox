import { useEffect, useState } from "react";
import { api } from "./api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import type { JevProvider } from "../shared";

const names: Record<JevProvider, string> = {
  vercel: "Vercel AI Gateway",
  typesafe: "TypeSafe AI",
  openrouter: "OpenRouter",
};
type Status = { provider: JevProvider; configured: boolean };
export function GatewaySettings() {
  const [config, setConfig] = useState<Status | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/settings/ai-gateway")
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, []);
  const update = async (provider: JevProvider, key?: string | null) => {
    setBusy(true);
    setError("");
    setApiKey("");
    try {
      setConfig(
        await api("/settings/ai-gateway", {
          method: "PUT",
          body: JSON.stringify({
            provider,
            ...(key !== undefined ? { apiKey: key } : {}),
          }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const provider = config?.provider ?? "vercel";
  return (
    <section className="executor-settings" aria-labelledby="gateway-heading">
      <h2 id="gateway-heading">Jev recommendations</h2>
      <label>
        Provider
        <select
          value={provider}
          disabled={busy || !config}
          onChange={(e) => update(e.target.value as JevProvider)}
        >
          <option value="vercel">Vercel AI Gateway</option>
          <option value="typesafe">TypeSafe AI</option>
          <option value="openrouter">OpenRouter</option>
        </select>
      </label>
      <p>
        Tasks and authorized skill descriptions are sent to {names[provider]};
        charges apply to your account. Keys are saved separately for each
        provider.
      </p>
      <p role="status">
        {!config
          ? "Loading…"
          : config.configured
            ? "Key saved"
            : "Not configured — deterministic search only"}
      </p>
      <label>
        {names[provider]} API key
        <Input
          type="password"
          autoComplete="new-password"
          value={apiKey}
          disabled={busy || !config}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </label>
      <div className="filters">
        <Button
          disabled={busy || !config || !apiKey.trim()}
          onClick={() => update(provider, apiKey.trim())}
        >
          Save key
        </Button>
        {config?.configured && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => update(provider, null)}
          >
            Remove key
          </Button>
        )}
      </div>
      {error && (
        <div className="error-note" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
