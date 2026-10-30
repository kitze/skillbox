import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { api } from "./api";
import type { GitHubImportPreview } from "../shared";

export function GitHubImportPage() {
  const nav = useNavigate();
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<GitHubImportPreview | null>(null);
  const [selected, setSelected] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inspect = async (selection?: string) => {
    setBusy(true);
    setError("");
    setOverwrite(false);
    try {
      const result = await api("/imports/github/preview", {
        method: "POST",
        body: JSON.stringify({
          url:
            selection !== undefined && preview?.kind === "catalog"
              ? preview.url
              : url.trim(),
          ...(selection !== undefined ? { path: selection } : {}),
        }),
      });
      setPreview(result);
      if (result.kind === "catalog") setSelected(result.candidates[0]);
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (preview?.kind !== "skill" || (preview.expectedRevision && !overwrite))
      return;
    setBusy(true);
    setError("");
    try {
      const result = await api("/imports/github/publish", {
        method: "POST",
        body: JSON.stringify({
          url: preview.source.url,
          id: preview.id,
          expectedRevision: preview.expectedRevision,
        }),
      });
      await nav({ to: "/skills/$id", params: { id: result.id } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="page github-import-page">
      <header className="page-heading">
        <h1>Import from GitHub</h1>
        <Button variant="outline" asChild>
          <Link to="/">Library</Link>
        </Button>
      </header>
      <form
        className="github-import-form"
        onSubmit={(e) => {
          e.preventDefault();
          void inspect();
        }}
      >
        <label htmlFor="github-import-url">Public GitHub URL</label>
        <div className="filters">
          <Input
            id="github-import-url"
            type="url"
            required
            placeholder="https://github.com/owner/repo/tree/main/skills/example"
            value={url}
            disabled={busy}
            onChange={(e) => {
              setUrl(e.target.value);
              setPreview(null);
              setOverwrite(false);
            }}
          />
          <Button type="submit" disabled={busy || !url.trim()}>
            {busy ? "Loading…" : "Preview"}
          </Button>
        </div>
      </form>
      {error && (
        <div className="error-note" role="alert">
          {error}
        </div>
      )}
      {preview?.kind === "catalog" && (
        <section className="github-import-preview">
          <label htmlFor="github-import-skill">Skill directory</label>
          <select
            id="github-import-skill"
            value={selected}
            disabled={busy}
            onChange={(e) => setSelected(e.target.value)}
          >
            {preview.candidates.map((path) => (
              <option key={path} value={path}>
                {path || "/"}
              </option>
            ))}
          </select>
          <Button disabled={busy} onClick={() => inspect(selected)}>
            Preview selected skill
          </Button>
        </section>
      )}
      {preview?.kind === "skill" && (
        <section className="github-import-preview">
          <h2>{preview.id}</h2>
          <a href={preview.source.url} target="_blank" rel="noreferrer">
            {preview.source.repository}@{preview.source.commit.slice(0, 12)}
            {preview.source.path && ` / ${preview.source.path}`}
          </a>
          <p>
            {preview.files.length} files ·{" "}
            {preview.files.reduce((sum, f) => sum + f.size, 0).toLocaleString()}{" "}
            bytes
          </p>
          <div className="github-import-files">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Bytes</th>
                  <th>Executable</th>
                </tr>
              </thead>
              <tbody>
                {preview.files.map((file) => (
                  <tr key={file.path}>
                    <td>
                      <code>{file.path}</code>
                    </td>
                    <td>{file.size.toLocaleString()}</td>
                    <td>{file.executable ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>SKILL.md</summary>
            <pre className="github-import-instructions">
              {preview.instructions}
            </pre>
          </details>
          {!!preview.skipped.length && (
            <details>
              <summary>Excluded artifacts ({preview.skipped.length})</summary>
              <ul>
                {preview.skipped.map((path) => (
                  <li key={path}>
                    <code>{path}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {preview.warnings.map((warning, i) => (
            <p key={i} role="status">
              {warning.message}
            </p>
          ))}
          <p>
            Review imported instructions before use. Importing never runs
            scripts.
          </p>
          {preview.expectedRevision && (
            <label className="check">
              <input
                type="checkbox"
                checked={overwrite}
                disabled={busy}
                onChange={(e) => setOverwrite(e.target.checked)}
              />
              Publish a new revision of existing “{preview.id}”
            </label>
          )}
          <Button
            disabled={busy || (!!preview.expectedRevision && !overwrite)}
            onClick={publish}
          >
            {busy
              ? "Importing…"
              : preview.expectedRevision
                ? "Publish new revision"
                : "Import skill"}
          </Button>
        </section>
      )}
    </main>
  );
}
