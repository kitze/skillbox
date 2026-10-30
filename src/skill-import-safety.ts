// Heuristic only: absence of a match is not a guarantee that a package is safe.
export function hasEmbeddedSecret(text: string) {
  return /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}/.test(
    text,
  );
}
export function excludedImportPath(path: string) {
  return path
    .split("/")
    .some(
      (part) =>
        [
          ".git",
          "node_modules",
          "__pycache__",
          ".venv",
          ".DS_Store",
          "sync.json",
        ].includes(part) ||
        part === ".env" ||
        part.startsWith(".env."),
    );
}
