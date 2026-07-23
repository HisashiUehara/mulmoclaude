// Framework-agnostic decision logic behind `useFileWatch`, kept separate from the
// Vue composable so the version-bump rule is testable without a Vue runtime.

export interface FileChangePayload {
  mtimeMs?: number;
}

// The plugin-scoped live-refresh channel a View subscribes to. The runtime
// resolves `file:<path>` to `plugin:<pkg>:file:<path>`.
export function fileWatchChannel(filePath: string): string {
  return `file:${filePath}`;
}

// Next monotonic version given the current one and an incoming payload. Bumps to
// `mtimeMs` only when it is a number strictly greater than `current`, which drops
// out-of-order events and collapses same-ms writes to the later mtime. Returns
// `current` unchanged otherwise.
export function nextFileVersion(current: number, payload: FileChangePayload | undefined): number {
  if (typeof payload?.mtimeMs === "number" && payload.mtimeMs > current) {
    return payload.mtimeMs;
  }
  return current;
}
