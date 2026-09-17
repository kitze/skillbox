import { ClientsPage, ProfilesPage, ProposalsPage } from "./access-pages";
import { referenceId, skillReferenceMarkdown } from "../skill-references";
import { SkillReference, ReferencePicker } from "./skill-reference";
import { ExecutorSettings, SkillIntegrations } from "./executor-settings";
import { isIconAsset } from "../package-metrics";
import { SkillMetrics, HarnessBadge, LENGTH_BANDS, lengthBand } from "./skill-metrics";
import { SkillIconView, SkillIconEditor } from "./skill-icon";
import React, {
  useEffect,
  useState,
  createContext,
  useContext,
  useRef,
} from "react";
import { createRoot } from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
  Link,
  useNavigate,
  useBlocker,
  useRouterState,
} from "@tanstack/react-router";
import {
  Library,
  Search,
  Plus,
  ArrowUpRight,
  ArrowLeft,
  FileText,
  Code2,
  Folder,
  Users,
  Activity,
  Plug,
  ChevronRight,
  Check,
  Copy,
  KeyRound,
  LogOut,
  Clock,
  Save,
  RotateCcw,
  Terminal,
  BookOpen,
  PanelLeftClose,
  LoaderCircle,
  X,
  ShieldCheck,
  Download,
  Trash2,
  Layers,
  PauseCircle,
  PlayCircle,
} from "lucide-react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { api, date, encodedFile, decoded } from "./api";
import type { SkillSummary, SkillFile } from "../shared";
import { harnessBadgeLabel } from "../shared";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./styles.css";
const Auth = createContext<{ name: string; role: string }>({
  name: "",
  role: "reader",
});
function ErrorNote({ error }: { error: string }) {
  return error ? (
    <div className="error-note" role="alert">
      {error}
    </div>
  ) : null;
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="empty">
      <Library size={26} />
      <p>{children}</p>
    </div>
  );
}
function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, set] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        set(true);
        setTimeout(() => set(false), 1800);
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
      {copied ? "Copied" : label}
    </Button>
  );
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [key, setKey] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login-page">
      <div className="login-card">
        <div className="brand-mark">
          <Library size={28} />
        </div>
        <h1>Sign in to Skillbox</h1>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api("/login", {
                method: "POST",
                body: JSON.stringify({ key }),
              });
              setKey("");
              onLogin();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="access-key">Workspace access key</label>
          <Input
            id="access-key"
            type="password"
            autoComplete="current-password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
          />
          <ErrorNote error={error} />
          <Button className="w-full" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <KeyRound size={16} />
            )}{" "}
            Open workspace
          </Button>
        </form>
      </div>
    </main>
  );
}
function Shell() {
  const [user, setUser] = useState<{ name: string; role: string } | null>(null),
    [loading, setLoading] = useState(true);
  const refresh = () =>
    api("/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  useEffect(() => {
    refresh();
  }, []);
  if (loading)
    return (
      <div className="boot">
        <LoaderCircle className="spin" />
      </div>
    );
  if (!user) return <Login onLogin={refresh} />;
  return (
    <Auth.Provider value={user}>
      <div className="app-shell">
        <aside className="sidebar">
          <Link to="/" className="brand">
            <div className="brand-mark">
              <Library size={22} />
            </div>
            <strong>skillbox</strong>
          </Link>
          <nav>
            <Link to="/" activeOptions={{ exact: true }}>
              <Library size={17} />
              Library
            </Link>
            <Link to="/bundles">
              <Layers size={17} />
              Bundles
            </Link>
            <SidebarBundles />
            <Link to="/profiles">
              <ShieldCheck size={17} />
              Profiles
            </Link>
            <Link to="/proposals">
              <FileText size={17} />
              Proposals
            </Link>
            <Link to="/clients">
              <Users size={17} />
              Clients
            </Link>
            <Link to="/activity">
              <Activity size={17} />
              Activity
            </Link>
            <Link to="/settings">
              <Plug size={17} /> Settings
            </Link>
            <Link to="/connect">
              <Plug size={17} />
              Connect an agent
            </Link>
          </nav>
          <div className="sidebar-bottom">
            <div className="avatar">K</div>
            <div>
              <strong>{user.name}</strong>
              <small>Workspace owner</small>
            </div>
            <Button
              aria-label="Sign out"
              title="Sign out"
              variant="ghost"
              size="icon"
              onClick={async () => {
                await api("/logout", { method: "POST" });
                setUser(null);
              }}
            >
              <LogOut size={15} />
            </Button>
          </div>
        </aside>
        <div className="workspace">
          <Outlet />
        </div>
      </div>
    </Auth.Provider>
  );
}
function SidebarBundles() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [bundles, setBundles] = useState<SkillSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    api("/skills?limit=500")
      .then((r) => {
        if (!cancelled)
          setBundles(r.items.filter((s: SkillSummary) => s.kind === "bundle"));
      })
      .catch(() => {
        if (!cancelled) setBundles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);
  const nested = new Set(bundles.flatMap((b) => b.members));
  return (
    <div className="sidebar-bundles">
      {bundles
        .filter((b) => !nested.has(b.id))
        .map((b) => (
          <Link key={b.id} to="/skills/$id" params={{ id: b.id }}>
            {b.title}
          </Link>
        ))}
    </div>
  );
}
function BundlesPage() {
  const [catalog, setCatalog] = useState<SkillSummary[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api("/skills?limit=500")
      .then((r) => setCatalog(r.items))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  const bundles = catalog.filter((s) => s.kind === "bundle");
  const nested = new Set(bundles.flatMap((b) => b.members));
  const matches = bundles
    .filter((b) =>
      [b.title, b.description, ...b.members]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(nested.has(a.id)) - Number(nested.has(b.id)) ||
        a.title.localeCompare(b.title),
    );
  return (
    <main className="page">
      <header className="page-heading">
        <div>
          <h1>Bundles</h1>
        </div>
        <Button asChild>
          <Link to="/bundles/new">
            <Plus size={16} /> New bundle
          </Link>
        </Button>
      </header>
      <div className="library-toolbar">
        <div className="search-field">
          <Search size={19} />
          <input
            aria-label="Search bundles"
            placeholder="Search bundles…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="total-count">
          <b>{bundles.length}</b> bundles
        </span>
      </div>
      <ErrorNote error={error} />
      {loading ? (
        <Empty>Loading bundles…</Empty>
      ) : !matches.length ? (
        <Empty>No bundles match your search.</Empty>
      ) : (
        <div className="bundle-grid">
          {matches.map((b) => {
            const members = b.members
              .map((id) => catalog.find((s) => s.id === id))
              .filter((s): s is SkillSummary => !!s);
            const childBundles = members.filter((s) => s.kind === "bundle");
            const skillCount = members.length - childBundles.length;
            return (
              <article className="bundle-card" key={b.id}>
                <Link
                  to="/skills/$id"
                  params={{ id: b.id }}
                  className="bundle-card-heading"
                >
                  <Layers size={21} />
                  <h2>{b.title}</h2>
                </Link>
                <p>{b.description}</p>
                <div className="bundle-card-count">
                  {skillCount} direct {skillCount === 1 ? "skill" : "skills"}
                  {childBundles.length
                    ? ` · ${childBundles.length} nested ${childBundles.length === 1 ? "bundle" : "bundles"}`
                    : ""}
                </div>
                <div className="bundle-members">
                  {members.map((m) => (
                    <Link to="/skills/$id" params={{ id: m.id }} key={m.id}>
                      {m.kind === "bundle" && <Layers size={12} />}
                      {m.title}
                    </Link>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
function LibraryPage() {
  const auth = useContext(Auth);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cleanup, setCleanup] = useState("all");
  const toggleStatus = async (s: SkillSummary) => {
    setBusyId(s.id);
    setError("");
    try {
      await api(`/skills/${s.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          disabled: !s.disabled,
          expectedRevision: s.revision,
        }),
      });
      const r = await api(
        "/skills?metrics=true&includeArchived=true&includeDisabled=true",
      );
      setSkills(r.items);
      setMatches((previous) =>
        previous
          ? previous.map(
              (item) =>
                r.items.find((fresh: SkillSummary) => fresh.id === item.id) ??
                item,
            )
          : null,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };
  const [groupBy, setGroupBy] = useState(() =>
    localStorage.getItem("skillbox-group-by") === "none" ? "none" : "length",
  );
  const [skills, setSkills] = useState<SkillSummary[]>([]),
    [matches, setMatches] = useState<SkillSummary[] | null>(null),
    [query, setQuery] = useState(""),
    [tag, setTag] = useState("All skills"),
    [kind, setKind] = useState("all"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api("/skills?metrics=true&includeArchived=true&includeDisabled=true")
      .then((r) => setSkills(r.items))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (!query.trim()) {
      setMatches(null);
      return;
    }
    let cancelled = false;
    const timeout = setTimeout(() => {
      api(
        "/skills?metrics=true&includeArchived=true&includeDisabled=true&limit=500&query=" +
          encodeURIComponent(query),
      )
        .then((r) => {
          if (!cancelled) setMatches(r.items);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query]);
  const tags = [...new Set(skills.flatMap((s) => s.tags))].sort();
  const results = (matches ?? skills).filter(
    (s) =>
      (kind === "archived"
        ? s.archived
        : kind === "disabled"
          ? s.disabled && !s.archived
          : !s.archived &&
            (kind === "all" || !s.disabled) &&
            (kind === "all" || kind === "active" || s.kind === kind)) &&
      (tag === "All skills" || s.tags.includes(tag)) &&
      (cleanup === "all" ||
        (cleanup === "heavy" && lengthBand(s) >= 3) ||
        (cleanup === "unreported" && !s.usageCount)),
  );
  const groups =
    groupBy === "length"
      ? [
          ...LENGTH_BANDS.map((b, i) => ({
            label: b.label,
            range: b.range,
            items: results.filter(
              (s) => s.characters !== undefined && lengthBand(s) === i,
            ),
          })),
          {
            label: "Length unavailable",
            range: "",
            items: results.filter((s) => s.characters === undefined),
          },
        ].filter((g) => g.items.length)
      : [{ label: "", range: "", items: results }];
  return (
    <main className="page">
      <header className="page-heading">
        <div>
          <h1>Library</h1>
        </div>
        <Button asChild>
          <Link to="/new">
            <Plus size={16} /> New skill or bundle
          </Link>
        </Button>
      </header>
      <div className="library-toolbar">
        <div className="search-field">
          <Search size={19} />
          <input
            ref={input}
            aria-label="Search library"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills…"
          />
          <kbd>⌘ K</kbd>
        </div>
        <span className="total-count">
          <b>{skills.filter((s) => !s.archived && !s.disabled).length}</b>{" "}
          active entries
        </span>
      </div>
      <div className="filters">
        <select
          aria-label="Group by"
          value={groupBy}
          onChange={(e) => {
            setGroupBy(e.target.value);
            localStorage.setItem("skillbox-group-by", e.target.value);
          }}
        >
          <option value="length">Group by length</option>
          <option value="none">None</option>
        </select>
        <select
          aria-label="Library view"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="all">All entries</option>
          <option value="active">Active library</option>
          <option value="skill">Skills</option>
          <option value="bundle">Bundles</option>
          <option value="disabled">Disabled</option>
          <option value="archived">Archived</option>
        </select>
        <button
          className={tag === "All skills" ? "selected" : ""}
          onClick={() => setTag("All skills")}
        >
          All skills{" "}
          <span>{skills.filter((s) => !s.archived && !s.disabled).length}</span>
        </button>
        {tags.slice(0, 5).map((t) => (
          <button
            key={t}
            className={tag === t ? "selected" : ""}
            onClick={() => setTag(t)}
          >
            {t.replaceAll("-", " ")}
          </button>
        ))}
        <select
          aria-label="More categories"
          value={
            tags.slice(0, 5).includes(tag) || tag === "All skills" ? "" : tag
          }
          onChange={(e) => setTag(e.target.value || "All skills")}
        >
          <option value="">More categories</option>
          {tags.slice(5).map((t) => (
            <option key={t} value={t}>
              {t.replaceAll("-", " ")}
            </option>
          ))}
        </select>
      </div>
      <div className="cleanup-controls">
        <select
          aria-label="Review filter"
          value={cleanup}
          onChange={(e) => setCleanup(e.target.value)}
        >
          <option value="all">All sizes and activity</option>
          <option value="heavy">Heavy packages</option>
          <option value="unreported">No usage reports</option>
        </select>
        <Link to="/activity">Inspect access logs</Link>
      </div>
      <ErrorNote error={error} />
      <div className="collection-heading">
        <span>
          {query
            ? `RESULTS FOR “${query}”`
            : tag === "All skills"
              ? "ALL SKILLS"
              : tag.toUpperCase()}
        </span>
        <span>{results.length} workflows</span>
      </div>
      {loading ? (
        <Empty>Loading your library…</Empty>
      ) : results.length ? (
        <div>
          {groups.map((group) => (
            <section key={group.label} className="length-group">
              {group.label && (
                <h2 className="length-group-heading">
                  <span>
                    {group.label} <small>{group.items.length}</small>
                  </span>
                  <small>{group.range}</small>
                </h2>
              )}
              <div className="skill-table">
                {group.items.map((s) => (
                  <div
                    key={s.id}
                    className={`skill-row ${s.disabled ? "is-disabled" : ""}`}
                  >
                    <Link
                      to="/skills/$id"
                      params={{ id: s.id }}
                      className="skill-row-link"
                    >
                      <SkillIconView icon={s.icon} />
                      <div className="skill-description">
                        <strong>{s.title === s.id ? s.id : s.title}</strong>
                        <HarnessBadge skill={s} />
                        <p>{s.description}</p>
                      </div>
                      <span className="tag">
                        {s.archived
                          ? "archived"
                          : s.disabled
                            ? "disabled"
                            : s.kind === "bundle"
                              ? "bundle"
                              : (s.tags[0]?.replaceAll("-", " ") ?? "general")}
                      </span>
                      <SkillMetrics skill={s} />
                    </Link>
                    {auth.role === "admin" && (
                      <button
                        className="status-toggle"
                        aria-label={`${s.disabled ? "Enable" : "Pause"} ${s.title}`}
                        title={s.disabled ? "Enable" : "Pause"}
                        disabled={busyId === s.id}
                        onClick={() => toggleStatus(s)}
                      >
                        {busyId === s.id ? (
                          <LoaderCircle className="spin" size={23} />
                        ) : s.disabled ? (
                          <PlayCircle size={25} />
                        ) : (
                          <PauseCircle size={25} />
                        )}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Empty>No skills match your search.</Empty>
      )}
    </main>
  );
}
function SkillPage() {
  const { id } = skillRoute.useParams();
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const [loaded, setLoaded] = useState<any>(null),
    [files, setFiles] = useState<SkillFile[]>([]),
    [path, setPath] = useState("SKILL.md"),
    [text, setText] = useState(""),
    [mode, setMode] = useState<"read" | "edit" | "history">("read"),
    [history, setHistory] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [saved, setSaved] = useState(false),
    [fileDraft, setFileDraft] = useState(""),
    [bufferEdited, setBufferEdited] = useState(false);
  const auth = useContext(Auth);
  const refresh = async () => {
    const l = await api("/skills/" + id);
    const [b, h] = await Promise.all([
      api("/skills/" + id + "/bundle?revision=" + l.revision),
      api("/skills/" + id + "/history"),
    ]);
    setLoaded(l);
    setFiles(b.files);
    setHistory(h);
    setPath("SKILL.md");
    setText(
      decoded(b.files.find((f: SkillFile) => f.path === "SKILL.md").content),
    );
    setDirty(false);
    setBufferEdited(false);
  };
  useEffect(() => {
    setLoaded(null);
    setError("");
    refresh().catch((e) => setError(e.message));
  }, [id]);
  useBlocker({
    shouldBlockFn: () => dirty && !window.confirm("Discard unsaved changes?"),
    enableBeforeUnload: dirty,
  });
  const stash = async () => {
    if (!bufferEdited) return [...files];
    const existing = files.find((f) => f.path === path);
    return files
      .map((f) => (f.path === path ? null : f))
      .filter(Boolean)
      .concat(
        await encodedFile(path, text, existing?.executable),
      ) as SkillFile[];
  };
  const choose = async (p: string) => {
    const next = await stash();
    setFiles(next);
    setPath(p);
    setText(decoded(next.find((f) => f.path === p)!.content));
    setBufferEdited(false);
    setSaved(false);
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await stash();
      await api("/skills/" + id, {
        method: "PUT",
        body: JSON.stringify({
          files: next,
          expectedRevision: loaded.revision,
          message: "Update from workspace",
        }),
      });
      await refresh();
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggleDisabled = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/skills/" + id + "/status", {
        method: "PATCH",
        body: JSON.stringify({
          disabled: !loaded.metadata.disabled,
          expectedRevision: loaded.revision,
        }),
      });
      await refresh();
      setSaved(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!loaded)
    return (
      <main className="page">
        <ErrorNote error={error} />
        {!error && <Empty>Opening skill…</Empty>}
      </main>
    );
  const currentFile = files.find((f) => f.path === path);
  const binary = currentFile ? atob(currentFile.content).includes("\0") : false;
  return (
    <main
      className={`detail-page ${loaded.metadata.disabled ? "is-disabled-detail" : ""}`}
    >
      <div className="detail-heading">
        <Link to="/" className="back-link">
          <ArrowLeft size={15} /> Library
        </Link>
        <div className="detail-title">
          {auth.role === "reader" ? (
            <SkillIconView icon={loaded.metadata.icon} />
          ) : (
            <SkillIconEditor
              key={loaded.revision}
              id={id}
              revision={loaded.revision}
              icon={loaded.metadata.icon}
              disabled={dirty || busy}
              onSaved={refresh}
            />
          )}
          <div>
            <h1>{loaded.metadata.title}</h1>
            <p>
              {loaded.metadata.tags.join(" · ") || "General workflow"}
              {harnessBadgeLabel(loaded.metadata.harnessPolicy)
                ? ` · ${harnessBadgeLabel(loaded.metadata.harnessPolicy)}`
                : ""}
            </p>
          </div>
          {loaded.referenceId && (
            <CopyButton
              label="Copy reference"
              text={skillReferenceMarkdown(
                loaded.metadata.title,
                loaded.referenceId,
              )}
            />
          )}
          <span className="revision-label">
            {dirty ? (
              <>
                <span className="dirty-dot" /> Unsaved changes
              </>
            ) : (
              <>
                <Check size={13} />{" "}
                {loaded.metadata.disabled ? "Disabled" : "Published"} ·{" "}
                {loaded.revision.slice(0, 8)}
              </>
            )}
          </span>
          {auth.role === "admin" && (
            <Button
              variant="ghost"
              className="status-toggle"
              title={loaded.metadata.disabled ? "Enable" : "Pause"}
              aria-label={loaded.metadata.disabled ? "Enable" : "Pause"}
              onClick={toggleDisabled}
              disabled={dirty || busy}
            >
              {loaded.metadata.disabled ? (
                <PlayCircle size={25} />
              ) : (
                <PauseCircle size={25} />
              )}
            </Button>
          )}
          {auth.role !== "reader" && (
            <Button onClick={save} disabled={!dirty || busy}>
              {saved ? <Check size={15} /> : <Save size={15} />}{" "}
              {busy ? "Saving…" : saved ? "Saved" : "Save revision"}
            </Button>
          )}
        </div>
      </div>
      <ErrorNote error={error} />
      {loaded.metadata.disabled && (
        <div className="archive-note" role="status">
          Disabled · unavailable to agents. Files, history and bundle membership
          are preserved. Enable to make it available again.
        </div>
      )}
      {loaded.metadata.archived && (
        <div className="archive-note">
          Archived · retained for history and existing links.
          {loaded.metadata.replacement && (
            <>
              {" "}
              Use{" "}
              <Link
                to="/skills/$id"
                params={{ id: loaded.metadata.replacement }}
              >
                {loaded.metadata.replacement}
              </Link>
              .
            </>
          )}
        </div>
      )}
      {loaded.metadata.kind === "bundle" && (
        <BundleComposition loaded={loaded} refresh={refresh} dirty={dirty} />
      )}
      {auth.role === "admin" && (
        <SkillIntegrations
          id={id}
          revision={loaded.revision}
          selected={loaded.metadata.executorIntegrations ?? []}
          onSaved={refresh}
          disabled={dirty || busy}
        />
      )}
      <div className="editor-layout">
        <aside className="file-sidebar">
          <div className="file-label">
            FILES{" "}
            <span>{files.filter((f) => !isIconAsset(f.path)).length}</span>
          </div>
          {files
            .filter((f) => !isIconAsset(f.path))
            .map((f) => (
              <button
                className={path === f.path ? "active" : ""}
                key={f.path}
                onClick={() => choose(f.path)}
              >
                <FileText size={14} />
                <span>{f.path}</span>
              </button>
            ))}
          {auth.role !== "reader" && (
            <form
              className="add-file"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  !fileDraft.trim() ||
                  files.some((f) => f.path === fileDraft)
                )
                  return;
                const next = await stash();
                const f = await encodedFile(fileDraft.trim(), "");
                setFiles([...next, f]);
                setPath(f.path);
                setText("");
                setBufferEdited(false);
                setDirty(true);
                setMode("edit");
                setFileDraft("");
              }}
            >
              <Input
                aria-label="New file path"
                placeholder="references/guide.md"
                value={fileDraft}
                onChange={(e) => setFileDraft(e.target.value)}
              />
              <Button variant="outline" size="sm" disabled={!fileDraft.trim()}>
                <Plus size={13} /> Add file
              </Button>
            </form>
          )}
          <div className="file-tip">
            <Terminal size={16} />
            <p>Fetch package</p>
            <code>
              skillbox fetch
              <br />
              {id}@{loaded.revision}
            </code>
            <CopyButton
              label="Copy command"
              text={`skillbox fetch ${id}@${loaded.revision}`}
            />
          </div>
        </aside>
        <section className="editor-main">
          <div className="editor-tabs">
            <div>
              <button
                className={mode === "read" ? "active" : ""}
                onClick={() => setMode("read")}
              >
                <BookOpen size={15} /> Preview
              </button>
              {auth.role !== "reader" && (
                <button
                  className={mode === "edit" ? "active" : ""}
                  onClick={() => setMode("edit")}
                >
                  <Code2 size={15} /> Source
                </button>
              )}
              <button
                className={mode === "history" ? "active" : ""}
                onClick={() => setMode("history")}
              >
                <Clock size={15} /> History <span>{history.length}</span>
              </button>
            </div>
            {mode === "edit" && path.endsWith(".md") && (
              <ReferencePicker
                currentId={id}
                onInsert={(markdown) => {
                  const start =
                      sourceRef.current?.selectionStart ?? text.length,
                    end = sourceRef.current?.selectionEnd ?? start;
                  setText(text.slice(0, start) + markdown + text.slice(end));
                  setBufferEdited(true);
                  setDirty(true);
                  setSaved(false);
                  requestAnimationFrame(() => {
                    sourceRef.current?.focus();
                    sourceRef.current?.setSelectionRange(
                      start + markdown.length,
                      start + markdown.length,
                    );
                  });
                }}
              />
            )}
            <span>{path}</span>
          </div>
          {mode === "history" ? (
            <div className="history-list">
              <h2>Revision history</h2>
              <p>Restore an earlier version as a new revision.</p>
              {history.map((h) => (
                <div className="history-row" key={h.revision}>
                  <Clock size={17} />
                  <div>
                    <strong>{h.message}</strong>
                    <p>
                      {h.author} · {new Date(h.createdAt).toLocaleString()} ·{" "}
                      <code>{h.revision.slice(0, 8)}</code>
                    </p>
                  </div>
                  {h.revision === loaded.revision ? (
                    <span className="tag">Current</span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || dirty}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api("/skills/" + id + "/restore", {
                            method: "POST",
                            body: JSON.stringify({
                              revision: h.revision,
                              expectedRevision: loaded.revision,
                            }),
                          });
                          await refresh();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <RotateCcw size={13} /> Restore
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : binary ? (
            <Empty>
              Binary asset · {currentFile?.size.toLocaleString()} bytes. Fetch
              the package to use this file.
            </Empty>
          ) : mode === "edit" ? (
            <textarea
              ref={sourceRef}
              className="source-editor"
              aria-label="Skill source"
              value={text}
              spellCheck={false}
              onChange={(e) => {
                setText(e.target.value);
                setBufferEdited(true);
                setDirty(true);
                setSaved(false);
              }}
            />
          ) : path.endsWith(".md") ? (
            <article className="markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                urlTransform={(url) =>
                  referenceId(url) ? url : defaultUrlTransform(url)
                }
                components={{
                  a: ({ href, children }) =>
                    href && referenceId(href) ? (
                      <SkillReference id={referenceId(href)!}>
                        {children}
                      </SkillReference>
                    ) : (
                      <a
                        href={
                          href?.startsWith("https://") ||
                          href?.startsWith("http://")
                            ? href
                            : undefined
                        }
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => {
                          if (href && !/^https?:/.test(href)) {
                            e.preventDefault();
                            const base = path.split("/").slice(0, -1);
                            for (const part of href.split("#")[0].split("/")) {
                              if (part === "..") base.pop();
                              else if (part && part !== ".") base.push(part);
                            }
                            const candidate = base.join("/");
                            if (files.some((f) => f.path === candidate))
                              choose(candidate);
                            else
                              setError(
                                "Reference is outside this package. Load its skill or fetch it on the execution host.",
                              );
                          }
                        }}
                      >
                        {children}
                      </a>
                    ),
                  img: ({ alt }) => (
                    <span className="tag">
                      Image: {alt ?? "bundled asset"} — available in package
                    </span>
                  ),
                }}
              >
                {text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")}
              </ReactMarkdown>
            </article>
          ) : (
            <pre className="code-preview">{text}</pre>
          )}
          <div className="editor-status">
            <span>
              {binary ? "Binary asset" : `${text.split("\n").length} lines`} ·{" "}
              {currentFile?.executable ? "Executable" : "Text"} · {path}
            </span>
            <span>Revision {loaded.revision.slice(0, 8)}</span>
          </div>
        </section>
      </div>
    </main>
  );
}
function MemberPicker({
  catalog,
  selected,
  onChange,
}: {
  catalog: SkillSummary[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  return (
    <fieldset className="member-picker">
      <legend>Included skills and bundles</legend>
      <Input
        aria-label="Find bundle members"
        placeholder="Find a skill or bundle…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="member-options">
        {catalog
          .filter((s) =>
            (s.id + " " + s.description)
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((s) => (
            <label key={s.id}>
              <input
                type="checkbox"
                checked={selected.includes(s.id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...selected, s.id]
                      : selected.filter((id) => id !== s.id),
                  )
                }
              />
              <span>
                {s.title} {s.disabled && <span className="tag">disabled</span>}
                {s.kind === "bundle" && <span className="tag">bundle</span>}
              </span>
            </label>
          ))}
      </div>
      <small>
        {selected.length} selected. Nested bundles share their members
        automatically. Disabled members stay selected but are skipped by agents.
      </small>
    </fieldset>
  );
}
function BundleComposition({
  loaded,
  refresh,
  dirty,
}: {
  loaded: any;
  refresh: () => Promise<void>;
  dirty: boolean;
}) {
  const [editing, setEditing] = useState(false),
    [catalog, setCatalog] = useState<SkillSummary[]>([]),
    [members, setMembers] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const auth = useContext(Auth);
  const composition = loaded.composition;
  return (
    <section className="bundle-composition">
      <div className="bundle-heading">
        <h2>
          <Layers size={20} /> Bundle composition
        </h2>
        <span>{composition?.skills.length ?? 0} unique skills</span>
        {auth.role === "admin" && (
          <Button
            variant="outline"
            disabled={dirty || busy}
            onClick={async () => {
              try {
                setCatalog(
                  (await api("/skills?includeDisabled=true")).items.filter(
                    (s: SkillSummary) => s.id !== loaded.id,
                  ),
                );
                setMembers(loaded.metadata.members);
                setEditing(!editing);
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Edit members
          </Button>
        )}
      </div>
      <div className="bundle-members">
        {composition?.members.map((id: string) => {
          const bundle = composition.bundles.find((s: any) => s.id === id);
          const skill = composition.skills.find((s: any) => s.id === id);
          return (
            <Link to="/skills/$id" params={{ id }} key={id}>
              {bundle ? <Layers size={14} /> : <FileText size={14} />}
              {bundle?.title ?? skill?.title ?? id}
            </Link>
          );
        })}
      </div>
      {editing && (
        <>
          <MemberPicker
            catalog={catalog}
            selected={members}
            onChange={setMembers}
          />
          <Button
            disabled={busy || dirty}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/bundles/" + loaded.id, {
                  method: "PUT",
                  body: JSON.stringify({
                    title: loaded.metadata.title,
                    description: loaded.metadata.description,
                    members,
                    expectedRevision: loaded.revision,
                  }),
                });
                await refresh();
                setEditing(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save members
          </Button>
        </>
      )}
      <ErrorNote error={error} />
      <details>
        <summary>Resolved skills · shared members appear once</summary>
        <div className="bundle-members">
          {composition?.skills.map((s: SkillSummary) => (
            <Link to="/skills/$id" params={{ id: s.id }} key={s.id}>
              {s.title}
            </Link>
          ))}
        </div>
      </details>
    </section>
  );
}
function NewPage({
  initialKind = "skill",
}: {
  initialKind?: "skill" | "bundle";
}) {
  const [id, setId] = useState(""),
    [description, setDescription] = useState(""),
    [kind, setKind] = useState(initialKind),
    [members, setMembers] = useState<string[]>([]),
    [catalog, setCatalog] = useState<SkillSummary[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const nav = useNavigate();
  useEffect(() => {
    api("/skills")
      .then((r) => setCatalog(r.items))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <main className="page narrow">
      <Link
        to={initialKind === "bundle" ? "/bundles" : "/"}
        className="back-link"
      >
        <ArrowLeft size={14} />{" "}
        {initialKind === "bundle" ? "Bundles" : "Library"}
      </Link>
      <h1>New {kind}</h1>
      <p>
        {kind === "bundle"
          ? "Choose the skills and bundles that belong in this workflow."
          : "Describe when an agent should use this skill. Add its instructions and files next."}
      </p>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            if (kind === "bundle") {
              await api("/bundles/" + id, {
                method: "PUT",
                body: JSON.stringify({
                  title: id,
                  description,
                  members,
                  expectedRevision: null,
                }),
              });
              await nav({ to: "/skills/$id", params: { id } });
              return;
            }
            const f = await encodedFile(
              "SKILL.md",
              `---\nname: ${id}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${id}\n\nWrite your workflow here.\n`,
            );
            await api("/skills/" + id, {
              method: "PUT",
              body: JSON.stringify({
                files: [f],
                expectedRevision: null,
                message: "Create skill",
              }),
            });
            await nav({ to: "/skills/$id", params: { id } });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Type
          <select
            aria-label="Entry type"
            value={kind}
            onChange={(e) => setKind(e.target.value as "skill" | "bundle")}
          >
            <option value="skill">Skill</option>
            <option value="bundle">Bundle</option>
          </select>
        </label>
        <label>
          {kind === "bundle" ? "Bundle" : "Skill"} ID
          <Input
            value={id}
            onChange={(e) => setId(e.target.value)}
            pattern="[a-z0-9][a-z0-9-]{0,79}"
            placeholder="deploy-my-app"
            required
          />
        </label>
        <label>
          When should an agent use it?
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            placeholder="Deploy my web apps, check release health, and roll back a failed deployment."
          />
        </label>
        {kind === "bundle" && (
          <MemberPicker
            catalog={catalog}
            selected={members}
            onChange={setMembers}
          />
        )}
        <ErrorNote error={error} />
        <Button disabled={busy}>
          <Plus size={16} /> Create {kind}
        </Button>
      </form>
    </main>
  );
}
function ActivityPage() {
  const [operation, setOperation] = useState("reads"),
    [skillId, setSkillId] = useState(""),
    [offset, setOffset] = useState(0);
  const [items, setItems] = useState<any[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    api(
      `/events?operation=${operation}&skillId=${encodeURIComponent(skillId)}&offset=${offset}`,
    )
      .then(setItems)
      .catch((e) => setError(e.message));
  }, [operation, skillId, offset]);
  return (
    <main className="page">
      <header className="standard-heading">
        <h1>Activity</h1>
      </header>
      <div className="filters">
        <select
          aria-label="Activity type"
          value={operation}
          onChange={(e) => {
            setOperation(e.target.value);
            setOffset(0);
          }}
        >
          <option value="reads">Agent reads (not usage)</option>
          <option value="usage">Reported usage</option>
          <option value="web">Workspace browsing</option>
          <option value="legacy">Legacy · source unknown</option>
        </select>
        <Input
          aria-label="Skill ID"
          placeholder="Filter by exact skill ID"
          value={skillId}
          onChange={(e) => {
            setSkillId(e.target.value);
            setOffset(0);
          }}
        />
      </div>
      <details className="usage-definition">
        <summary>What counts?</summary>
        <p>
          Discovery lists descriptions only. Reads load instructions, files or a
          package and can include bulk audits. Usage requires an explicit agent
          report. Client keys identify the caller; harness and model names are
          self-reported. Historical records lack source details and cannot
          establish usage.
        </p>
      </details>
      <ErrorNote error={error} />
      {items.length ? (
        <div className="activity-list">
          {items.map((e) => (
            <div key={e.id}>
              <span className="event-dot" />
              <strong>{e.clientName}</strong>
              <span className="event-operation">
                {{
                  load: "Read instructions",
                  read_file: "Read file",
                  bundle: "Fetched package",
                  reported_use: "Reported use",
                  browse: "Listed index",
                  search: "Searched index",
                }[e.operation as string] ?? e.operation.replaceAll("_", " ")}
              </span>
              {e.skillId ? (
                <Link to="/skills/$id" params={{ id: e.skillId }}>
                  {e.skillId}
                </Link>
              ) : (
                <span>Library index</span>
              )}
              <time>{new Date(e.createdAt).toLocaleString()}</time>
              <details className="event-details">
                <summary>Details</summary>
                <dl>
                  {Object.entries({ ...e.context, clientId: e.clientId }).map(
                    ([k, v]) => (
                      <React.Fragment key={k}>
                        <dt>{k}</dt>
                        <dd>{String(v ?? "Unknown")}</dd>
                      </React.Fragment>
                    ),
                  )}
                  {!e.context?.model && (
                    <>
                      <dt>model</dt>
                      <dd>Not reported</dd>
                    </>
                  )}
                  {!e.context?.harness && (
                    <>
                      <dt>harness</dt>
                      <dd>Not reported</dd>
                    </>
                  )}
                </dl>
              </details>
            </div>
          ))}
        </div>
      ) : (
        <Empty>No matching recorded events.</Empty>
      )}
      <div className="filters">
        <Button
          variant="outline"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          disabled={items.length < 100}
          onClick={() => setOffset(offset + 100)}
        >
          Next
        </Button>
      </div>
    </main>
  );
}
function ConnectPage() {
  const url = window.location.origin;
  const [error, setError] = useState("");
  const snippet = JSON.stringify(
    {
      mcpServers: {
        skillbox: {
          command: "node",
          args: ["/absolute/path/to/skillbox.mjs", "mcp"],
          env: { SKILLBOX_URL: url, SKILLBOX_TOKEN: "YOUR_CLIENT_KEY" },
        },
      },
    },
    null,
    2,
  );
  return (
    <main className="page connect-page">
      <header className="standard-heading">
        <h1>Connect an agent</h1>
      </header>
      <ErrorNote error={error} />
      <div className="connect-step">
        <span className="step-number">01</span>
        <div>
          <h2>Create a client key</h2>
          <p>
            Use a different key for each agent so you can change access
            independently.
          </p>
          <Button variant="outline" asChild>
            <Link to="/clients">
              <KeyRound size={15} /> Manage clients <ArrowUpRight size={14} />
            </Link>
          </Button>
        </div>
      </div>
      <div className="connect-step">
        <span className="step-number">02</span>
        <div>
          <h2>Connect the library</h2>
          <p>
            For clients that support HTTP MCP, add this endpoint with a Bearer
            token.
          </p>
          <div className="copy-line">
            <code>{url}/mcp</code>
            <CopyButton text={url + "/mcp"} />
          </div>
          <details open>
            <summary>Or use the stdio bridge</summary>
            <p>
              Download these two files into the same directory, then add the
              config below. Requires Node 20+ or Bun.
            </p>
            <div className="download-links">
              <a href="/cli/skillbox.mjs" download>
                skillbox.mjs <Download size={13} />
              </a>
              <a href="/cli/package.mjs" download>
                package.mjs <Download size={13} />
              </a>
            </div>
            <div className="code-block">
              <CopyButton text={snippet} />
              <pre>{snippet}</pre>
            </div>
            <p className="muted">
              Replace the file path and YOUR_CLIENT_KEY in your agent's local
              MCP configuration. Use a protected config file or secret
              environment variable.
            </p>
          </details>
        </div>
      </div>
      <div className="connect-step">
        <span className="step-number">03</span>
        <div>
          <h2>Install the one bootstrap skill</h2>
          <p>
            It teaches your agent to browse the library at task start, load the
            right workflow, and fetch scripts on the right machine.
          </p>
          <Button variant="outline" asChild>
            <a href="/bootstrap/SKILL.md" download="SKILL.md">
              <Download size={15} /> Download SKILL.md
            </a>
          </Button>
          <p className="muted">
            Place it in your agent's native skills directory as
            skills-library/SKILL.md.
          </p>
        </div>
      </div>
      <div className="connect-note">
        <ShieldCheck size={20} />
        <p>
          The library provides instructions and files. Your agent's existing
          tools handle execution and service permissions.
        </p>
      </div>
    </main>
  );
}
const rootRoute = createRootRoute({ component: Shell });
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: ExecutorSettings,
});
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: LibraryPage,
});
const bundlesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bundles",
  component: BundlesPage,
});
const newBundleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bundles/new",
  component: () => <NewPage initialKind="bundle" />,
});
const skillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/skills/$id",
  component: SkillPage,
});
const newRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/new",
  component: NewPage,
});
const profilesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/profiles",
  component: ProfilesPage,
});
const proposalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/proposals",
  component: ProposalsPage,
});
const clientsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clients",
  component: ClientsPage,
});
const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/activity",
  component: ActivityPage,
});
const connectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/connect",
  component: ConnectPage,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    bundlesRoute,
    newBundleRoute,
    skillRoute,
    newRoute,
    clientsRoute,
    profilesRoute,
    proposalsRoute,
    activityRoute,
    settingsRoute,
    connectRoute,
  ]),
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
