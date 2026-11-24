import React, { useEffect, useState } from "react";
import {
  Users,
  ShieldCheck,
  Plus,
  KeyRound,
  Pause,
  Play,
  Search,
  FileText,
  Check,
  X,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { api, decoded, date } from "./api";
import { SkillIconView } from "./skill-icon";
import type { Permissions, SkillSummary, SkillFile } from "../shared";
import { HARNESS_SUGGESTIONS } from "../shared";
type Profile = {
  id: string;
  name: string;
  allSkills: boolean;
  skillIds: string[];
  permissions: Permissions;
  defaultHarness?: string | null;
  version: string;
};
type Client = {
  id: string;
  name: string;
  profileId: string;
  active: boolean;
  lastSeen: string | null;
};
const blank = () => ({
  name: "",
  allSkills: false,
  skillIds: [] as string[],
  permissions: { create: false, update: false, delete: false, propose: true },
  defaultHarness: "" as string,
});
const labels: Record<keyof Permissions, string> = {
  create: "Create skills",
  update: "Update skills",
  delete: "Delete skills",
  propose: "Propose updates",
};
function ErrorNote({ error }: { error: string }) {
  return error ? (
    <div className="error-note" role="alert">
      {error}
    </div>
  ) : null;
}
function useDialog(active: boolean, close: () => void) {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = document.querySelector<HTMLElement>(".access-dialog");
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ) ?? [],
      );
    if (!dialog?.contains(document.activeElement)) focusable()[0]?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
      if (e.key !== "Tab") return;
      const targets = focusable(),
        first = targets[0],
        last = targets.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [active]);
}
export function ProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]),
    [clients, setClients] = useState<Client[]>([]),
    [catalog, setCatalog] = useState<SkillSummary[]>([]),
    [draft, setDraft] = useState<
      (ReturnType<typeof blank> & { id?: string; version?: string }) | null
    >(null),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useDialog(Boolean(draft), () => setDraft(null));
  const refresh = async () => {
    const [p, c, s] = await Promise.all([
      api("/profiles"),
      api("/clients"),
      api("/skills?limit=500&includeDisabled=true"),
    ]);
    setProfiles(p);
    setClients(c);
    setCatalog(s.items);
  };
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  return (
    <main className="page">
      <header className="standard-heading">
        <h1>Profiles</h1>
        <Button
          onClick={() => {
            setDraft(blank());
            setQuery("");
          }}
        >
          <Plus size={16} />
          New profile
        </Button>
      </header>
      <ErrorNote error={error} />
      <div className="profile-grid">
        {profiles
          .filter(
            (p) =>
              clients.some((c) => c.profileId === p.id && c.active) ||
              !clients.some((c) => c.profileId === p.id),
          )
          .map((p) => (
            <section className="profile-card" key={p.id}>
              <header>
                <ShieldCheck size={20} />
                <h2>{p.name}</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${p.name}`}
                  onClick={() => {
                    setDraft({
                      ...p,
                      skillIds: [...p.skillIds],
                      permissions: { ...p.permissions },
                      defaultHarness: p.defaultHarness ?? "",
                    });
                    setQuery("");
                  }}
                >
                  <Pencil size={16} />
                </Button>
              </header>
              <p className="muted">
                {clients.filter((c) => c.profileId === p.id && c.active).length}{" "}
                {clients.filter((c) => c.profileId === p.id && c.active)
                  .length === 1
                  ? "client"
                  : "clients"}{" "}
                ·{" "}
                {p.allSkills
                  ? "All skills"
                  : `${p.skillIds.length} ${p.skillIds.length === 1 ? "grant" : "grants"}`}
                {p.defaultHarness ? ` · ${p.defaultHarness}` : ""}
              </p>
              <div className="bundle-members">
                {p.allSkills ? (
                  <span className="soft-tag">All skills</span>
                ) : (
                  p.skillIds.map((id) => (
                    <span className="soft-tag" key={id}>
                      {catalog.find((s) => s.id === id)?.title ?? id}
                    </span>
                  ))
                )}
              </div>
              <div className="permission-summary">
                {Object.entries(p.permissions)
                  .filter(([, v]) => v)
                  .map(([key]) => (
                    <span key={key}>
                      <Check size={12} />
                      {labels[key as keyof Permissions]}
                    </span>
                  ))}
                {!Object.values(p.permissions).some(Boolean) && (
                  <span>Read only</span>
                )}
              </div>
            </section>
          ))}
      </div>
      <details className="inactive-profiles">
        <summary>Profiles with only paused clients</summary>
        {profiles
          .filter(
            (p) =>
              clients.some((c) => c.profileId === p.id) &&
              !clients.some((c) => c.profileId === p.id && c.active),
          )
          .map((p) => (
            <Button
              key={p.id}
              variant="ghost"
              onClick={() =>
                setDraft({ ...p, defaultHarness: p.defaultHarness ?? "" })
              }
            >
              {p.name}
            </Button>
          ))}
      </details>
      {draft && (
        <div className="modal-backdrop" onClick={() => setDraft(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label={draft.id ? "Edit profile" : "New profile"}
            className="access-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  await api(draft.id ? `/profiles/${draft.id}` : "/profiles", {
                    method: draft.id ? "PUT" : "POST",
                    body: JSON.stringify(draft),
                  });
                  setDraft(null);
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <header>
                <h2>{draft.id ? "Edit profile" : "New profile"}</h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Close profile"
                  onClick={() => setDraft(null)}
                >
                  <X size={18} />
                </Button>
              </header>
              <ErrorNote error={error} />
              <label>
                Name
                <Input
                  autoFocus
                  required
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <fieldset className="permission-fields">
                <legend>Permissions</legend>
                {(Object.keys(labels) as (keyof Permissions)[]).map((key) => (
                  <label
                    key={key}
                    title={
                      key === "delete"
                        ? "Archives skills; revision history is preserved"
                        : undefined
                    }
                  >
                    <input
                      type="checkbox"
                      checked={draft.permissions[key]}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          permissions: {
                            ...draft.permissions,
                            [key]: e.target.checked,
                          },
                        })
                      }
                    />
                    {labels[key]}
                  </label>
                ))}
              </fieldset>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={draft.allSkills}
                  onChange={(e) =>
                    setDraft({ ...draft, allSkills: e.target.checked })
                  }
                />
                All skills
              </label>
              <label>
                Default harness
                <Input
                  list="harness-aliases"
                  value={draft.defaultHarness ?? ""}
                  placeholder="Optional — used when the client omits a harness"
                  onChange={(e) =>
                    setDraft({ ...draft, defaultHarness: e.target.value })
                  }
                />
                <datalist id="harness-aliases">
                  {HARNESS_SUGGESTIONS.map((name) => (
                    <option value={name} key={name} />
                  ))}
                </datalist>
              </label>
              <p className="muted">
                Live MCP/CLI harness headers still win. Empty keeps the full
                granted catalog when the client does not identify a product.
              </p>
              {!draft.allSkills && (
                <>
                  <div className="bundle-members">
                    {draft.skillIds.map((id) => (
                      <button
                        type="button"
                        className="soft-tag selected-grant"
                        key={id}
                        aria-label={`Remove ${catalog.find((s) => s.id === id)?.title ?? id}`}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            skillIds: draft.skillIds.filter(
                              (item) => item !== id,
                            ),
                          })
                        }
                      >
                        {catalog.find((s) => s.id === id)?.title ?? id}
                        <X size={12} />
                      </button>
                    ))}
                  </div>
                  <Input
                    aria-label="Find skills and bundles"
                    placeholder="Find skills and bundles…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <div className="profile-grants">
                    {catalog
                      .filter((s) =>
                        `${s.title} ${s.id}`
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      )
                      .map((s) => (
                        <label key={s.id}>
                          <input
                            type="checkbox"
                            checked={draft.skillIds.includes(s.id)}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                skillIds: e.target.checked
                                  ? [...draft.skillIds, s.id]
                                  : draft.skillIds.filter((id) => id !== s.id),
                              })
                            }
                          />
                          <SkillIconView icon={s.icon} />
                          <span>
                            {s.title}
                            <small>
                              {s.kind === "bundle"
                                ? `${s.members.length} members`
                                : "Skill"}
                              {s.disabled ? " · Paused" : ""}
                            </small>
                          </span>
                        </label>
                      ))}
                  </div>
                </>
              )}
              <footer>
                {draft.id && !clients.some((c) => c.profileId === draft.id) && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api(`/profiles/${draft.id}`, {
                          method: "DELETE",
                        });
                        setDraft(null);
                        await refresh();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Trash2 size={16} />
                    Delete
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </Button>
                <Button disabled={busy || !draft.name.trim()}>
                  Save profile
                </Button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
export function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]),
    [profiles, setProfiles] = useState<Profile[]>([]),
    [name, setName] = useState(""),
    [profileId, setProfileId] = useState(""),
    [key, setKey] = useState(""),
    [query, setQuery] = useState(""),
    [paused, setPaused] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<Client | null>(null);
  useDialog(Boolean(editing), () => setEditing(null));
  const refresh = async () => {
    const [c, p] = await Promise.all([api("/clients"), api("/profiles")]);
    setClients(c);
    setProfiles(p);
  };
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  const update = async (c: Client, body: Partial<Client>) => {
    setBusy(true);
    setError("");
    try {
      await api(`/clients/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await refresh();
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const visible = clients.filter(
    (c) =>
      (paused || c.active) &&
      `${c.name} ${profiles.find((p) => p.id === c.profileId)?.name}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <main className="page">
      <header className="standard-heading">
        <h1>Clients</h1>
      </header>
      <ErrorNote error={error} />
      {key && (
        <div className="secret-reveal">
          <strong>Client key</strong>
          <p>Copy it now. This key is shown once.</p>
          <code>{key}</code>
          <Button onClick={() => navigator.clipboard.writeText(key)}>
            Copy key
          </Button>
          <Button variant="ghost" onClick={() => setKey("")}>
            Dismiss
          </Button>
        </div>
      )}
      <div className="clients-layout">
        <section>
          <div className="access-filters">
            <Input
              aria-label="Find clients"
              placeholder="Find clients…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={paused}
                onChange={(e) => setPaused(e.target.checked)}
              />
              Show paused ({clients.filter((c) => !c.active).length})
            </label>
          </div>
          {visible.map((c) => (
            <div
              className={`client-row ${c.active ? "" : "is-paused"}`}
              key={c.id}
            >
              <div className="client-avatar">
                <Users size={20} />
              </div>
              <div className="client-identity">
                <strong>{c.name}</strong>
                <p>
                  {profiles.find((p) => p.id === c.profileId)?.name ??
                    "Unknown profile"}
                </p>
                <small
                  title={
                    c.lastSeen
                      ? new Date(c.lastSeen).toLocaleString()
                      : undefined
                  }
                >
                  {c.lastSeen
                    ? `Last request ${date(c.lastSeen)}`
                    : "No requests recorded"}
                </small>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Edit ${c.name}`}
                onClick={() => setEditing({ ...c })}
              >
                <Pencil size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="round-control"
                disabled={busy}
                aria-label={`${c.active ? "Pause" : "Resume"} ${c.name}`}
                onClick={() => update(c, { active: !c.active })}
              >
                {c.active ? <Pause size={16} /> : <Play size={16} />}
              </Button>
            </div>
          ))}
          {!visible.length && <p className="muted">No matching clients</p>}
        </section>
        <form
          className="client-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const c = await api("/clients", {
                method: "POST",
                body: JSON.stringify({ name, profileId }),
              });
              setKey(c.token);
              setName("");
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2>Add client</h2>
          <label>
            Name
            <Input
              required
              placeholder="Desktop assistant"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Profile
            <select
              required
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
            >
              <option value="">Choose profile</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={busy || !profileId || !name.trim()}>
            <KeyRound size={15} />
            Create key
          </Button>
        </form>
      </div>
      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <form
            className="access-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Edit client"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              update(editing, {
                name: editing.name,
                profileId: editing.profileId,
              });
            }}
          >
            <header>
              <h2>Edit client</h2>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close client"
                onClick={() => setEditing(null)}
              >
                <X size={18} />
              </Button>
            </header>
            <ErrorNote error={error} />
            <label>
              Name
              <Input
                required
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            <label>
              Profile
              <select
                value={editing.profileId}
                onChange={(e) =>
                  setEditing({ ...editing, profileId: e.target.value })
                }
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <footer>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
              <Button disabled={busy}>Save client</Button>
            </footer>
          </form>
        </div>
      )}
    </main>
  );
}
export function ProposalsPage() {
  const [items, setItems] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null),
    [error, setError] = useState(""),
    [history, setHistory] = useState(false),
    [busy, setBusy] = useState(false);
  const refresh = () => api("/proposals").then(setItems);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  const review = async (decision: string) => {
    setBusy(true);
    setError("");
    try {
      await api(`/proposals/${selected.id}/review`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      setSelected(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const base: SkillFile[] = selected?.baseFiles ?? [],
    next: SkillFile[] = selected?.files ?? [];
  const paths = [...new Set([...base, ...next].map((f) => f.path))].filter(
    (path) => {
      const a = base.find((f) => f.path === path),
        b = next.find((f) => f.path === path);
      return a?.sha256 !== b?.sha256 || a?.executable !== b?.executable;
    },
  );
  return (
    <main className="page">
      <header className="standard-heading">
        <h1>Proposals</h1>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={history}
            onChange={(e) => setHistory(e.target.checked)}
          />
          Show reviewed
        </label>
      </header>
      <ErrorNote error={error} />
      <div className="proposal-layout">
        <section>
          {items
            .filter((p) => history || p.status === "pending")
            .map((p) => (
              <button
                className={`proposal-row ${selected?.id === p.id ? "selected" : ""}`}
                key={p.id}
                onClick={async () => {
                  try {
                    setSelected(await api(`/proposals/${p.id}`));
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <FileText size={18} />
                <span>
                  <strong>{p.skillId}</strong>
                  <span>{p.message}</span>
                  <small>
                    {p.clientName} · {date(p.createdAt)} · {p.status}
                  </small>
                </span>
              </button>
            ))}
          {!items.some((p) => history || p.status === "pending") && (
            <p className="muted">No pending proposals</p>
          )}
        </section>
        {selected && (
          <section className="proposal-review">
            <header>
              <h2>{selected.skillId}</h2>
              {selected.status === "pending" && (
                <div>
                  <Button
                    disabled={busy}
                    variant="ghost"
                    onClick={() => review("reject")}
                  >
                    <X size={15} />
                    Reject
                  </Button>
                  <Button disabled={busy} onClick={() => review("approve")}>
                    <Check size={15} />
                    Approve
                  </Button>
                </div>
              )}
            </header>
            <p>{selected.message}</p>
            {paths.map((path) => (
              <details key={path} open={paths.length === 1}>
                <summary>
                  {path}{" "}
                  {!next.some((f) => f.path === path)
                    ? "· Removed"
                    : !base.some((f) => f.path === path)
                      ? "· Added"
                      : "· Changed"}
                </summary>
                <div className="proposal-diff">
                  {[base, next].map((files, i) => {
                    const file = files.find((f) => f.path === path);
                    return (
                      <div key={i}>
                        <small>
                          {i ? "Proposed" : "Original"}
                          {file?.executable ? " · Executable" : ""}
                        </small>
                        {file ? (
                          <pre>
                            {/\.(md|txt|json|ya?ml|toml|ts|tsx|js|mjs|py|sh|css|html|sql)$/.test(
                              path,
                            )
                              ? decoded(file.content)
                              : `${file.size} bytes · SHA-256 ${file.sha256}`}
                          </pre>
                        ) : (
                          <p>Not present</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
