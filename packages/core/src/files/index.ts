// Entry point for `@mulmoclaude/core/files` (server-only). The single source of
// truth for atomic file I/O — tmp-write + rename, with the Windows retry loop —
// shared by the host, core, and plugins so the safety-critical rename logic
// lives in exactly one place (#2399). Internal-only helpers (isTransientRenameError,
// renameWithWindowsRetry) stay off this barrel and are imported from ./atomic by tests.
export { writeFileAtomic, writeFileAtomicSync, type WriteAtomicOptions } from "./atomic.js";
export { writeJsonAtomic } from "./json.js";
export { isEnoent } from "./safe.js";
