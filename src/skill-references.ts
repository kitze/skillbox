import { fromMarkdown } from "mdast-util-from-markdown";
export const REFERENCE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function referenceId(url: string) {
  const match = /^skill:\/\/([0-9a-f-]+)$/i.exec(url);
  return match && REFERENCE_ID.test(match[1]!) ? match[1]!.toLowerCase() : null;
}

/**
 * Parse a SEP-2640 skill resource URI (`skill://<id-or-uuid>/<relative-path>`).
 * Markdown identity links stay UUID-only via {@link referenceId}; this does not
 * treat `skill://android-engineering` as a resource.
 */
export function parseSkillResourceUri(
  uri: string,
): { idOrReference: string; path: string } | null {
  const match = /^skill:\/\/([^/?#]+)\/([^?#]+)$/i.exec(uri.trim());
  if (!match) return null;
  let idOrReference: string;
  let path: string;
  try {
    idOrReference = decodeURIComponent(match[1]!).toLowerCase();
    path = decodeURIComponent(match[2]!);
  } catch {
    return null;
  }
  if (
    !REFERENCE_ID.test(idOrReference) &&
    !/^[a-z0-9][a-z0-9-]{0,79}$/.test(idOrReference)
  )
    return null;
  if (
    !path ||
    path.length > 240 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /[\x00-\x1f:]/.test(path) ||
    path
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  )
    return null;
  return { idOrReference, path };
}

export function canonicalSkillUri(skillId: string, path: string) {
  return `skill://${skillId}/${path}`;
}
export function skillReferenceMarkdown(label: string, id: string) {
  if (!REFERENCE_ID.test(id)) throw new Error("Invalid skill reference ID");
  return `[${label.replace(/[\\\[\]]/g, "\\$&").replace(/[\r\n]/g, " ")}](skill://${id})`;
}
export function extractSkillReferences(markdown: string): string[] {
  const tree = fromMarkdown(markdown),
    definitions = new Map<string, string>(),
    ids = new Set<string>();
  function walk(node: any, visit: (node: any) => void) {
    visit(node);
    for (const child of node.children ?? []) walk(child, visit);
  }
  walk(tree, (node) => {
    if (node.type === "definition") definitions.set(node.identifier, node.url);
  });
  walk(tree, (node) => {
    const url =
      node.type === "link"
        ? node.url
        : node.type === "linkReference"
          ? definitions.get(node.identifier)
          : undefined;
    if (url) {
      const id = referenceId(url);
      if (id) ids.add(id);
    }
  });
  return [...ids];
}
