// Workspace-relative paths are a POSIX contract (#2542). Every surface that
// carries one — the Files tree, the upload response, the `file:` pubsub
// channel, `<collection_paths>` in the agent prompt, export manifests, wiki
// link hrefs — is `/`-separated on every host. Only the host filesystem layer
// speaks `path.sep`.
//
// `node:path` produces host-shaped strings: `path.relative` / `path.join`
// return `sub\dir` on Windows. Anything derived from them has to cross back to
// the POSIX contract before it leaves the filesystem layer, and this is where
// that conversion is defined.

import path from "node:path";

/** Convert a host-shaped workspace-relative path to the POSIX form.
 *
 *  Splits on the host separator rather than rewriting every `\` — on POSIX a
 *  backslash is a legal filename character, so a blanket replace would turn the
 *  single directory `we\ird` into the two segments `we/ird` and send the write
 *  somewhere else. Splitting on `path.sep` is a no-op on POSIX and correct on
 *  Windows.
 *
 *  `sep` is a parameter so the Windows rule is assertable from a POSIX runner:
 *  bound to the host's own separator, the whole rule is invisible outside
 *  Windows CI, which is how the backslash form reached main twice (#2540). */
export function toPosixRelPath(hostRelPath: string, sep: string = path.sep): string {
  return hostRelPath.split(sep).join("/");
}

/** Append a single path segment to a POSIX workspace-relative path.
 *
 *  Separate from `toPosixRelPath` because the inputs differ: this one joins
 *  segments that are ALREADY POSIX-shaped (a parent rel path plus one
 *  `Dirent.name`), so it must not touch the characters inside them. Use
 *  `toPosixRelPath` first when the parent came out of `node:path`. */
export function joinPosixRelPath(dirRelPosix: string, segment: string): string {
  return path.posix.join(dirRelPosix, segment);
}
