// The workspace-relative-path POSIX contract (#2542). Every case runs against
// BOTH host separators — bound to the runner's own `path.sep`, the Windows rule
// is invisible outside Windows CI, which is how the backslash form reached main
// twice (#2540, #2542).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { toPosixRelPath, joinPosixRelPath } from "../../src/files/relPath.js";

const WIN32_SEP = "\\";
const POSIX_SEP = "/";

describe("toPosixRelPath", () => {
  it("converts a Windows-shaped path", () => {
    assert.equal(toPosixRelPath("sub\\dir\\photo.png", WIN32_SEP), "sub/dir/photo.png");
  });

  it("leaves an already-POSIX path alone on Windows", () => {
    assert.equal(toPosixRelPath("sub/dir/photo.png", WIN32_SEP), "sub/dir/photo.png");
  });

  it("normalises a mixed-separator path on Windows", () => {
    assert.equal(toPosixRelPath("sub/dir\\photo.png", WIN32_SEP), "sub/dir/photo.png");
  });

  // The other Windows fixtures are hand-written literals — our belief about what
  // `node:path` emits there. This one runs the real thing from a POSIX runner,
  // so the contract is pinned against node's actual output, not against a guess.
  it("converts what node:path itself produces on Windows", () => {
    assert.equal(toPosixRelPath(path.win32.join("sub", "dir", "photo.png"), path.win32.sep), "sub/dir/photo.png");
  });

  it("is a no-op on POSIX", () => {
    assert.equal(toPosixRelPath("sub/dir/photo.png", POSIX_SEP), "sub/dir/photo.png");
  });

  // A backslash is a legal filename character on POSIX. A blanket
  // `.replace(/\\/g, "/")` would split this one name into two segments and send
  // the write to a different directory — which is why the rule splits on the
  // host separator instead.
  it("keeps a literal backslash in a POSIX filename", () => {
    assert.equal(toPosixRelPath("sub/we\\ird.txt", POSIX_SEP), "sub/we\\ird.txt");
  });

  it("handles the workspace root (empty path)", () => {
    assert.equal(toPosixRelPath("", WIN32_SEP), "");
    assert.equal(toPosixRelPath("", POSIX_SEP), "");
  });

  it("handles a single segment on both hosts", () => {
    assert.equal(toPosixRelPath("photo.png", WIN32_SEP), "photo.png");
    assert.equal(toPosixRelPath("photo.png", POSIX_SEP), "photo.png");
  });

  // Containment is the resolver's job downstream, but it can only refuse an
  // escape it can still see.
  it("preserves a traversal", () => {
    assert.equal(toPosixRelPath("..\\escape\\photo.png", WIN32_SEP), "../escape/photo.png");
    assert.equal(toPosixRelPath("../escape/photo.png", POSIX_SEP), "../escape/photo.png");
  });

  it("keeps a Windows drive-absolute path absolute", () => {
    assert.equal(toPosixRelPath("C:\\Windows\\evil.dll", WIN32_SEP), "C:/Windows/evil.dll");
  });

  it("defaults to the host separator", () => {
    assert.equal(toPosixRelPath(["a", "b"].join(path.sep)), "a/b");
  });
});

describe("joinPosixRelPath", () => {
  it("joins with a POSIX separator", () => {
    assert.equal(joinPosixRelPath("sub", "photo.png"), "sub/photo.png");
  });

  it("returns the bare segment at the workspace root", () => {
    assert.equal(joinPosixRelPath("", "photo.png"), "photo.png");
  });

  // The parent is already POSIX-shaped and the segment is one `Dirent.name`;
  // neither may have its characters rewritten.
  it("does not touch a backslash inside a segment", () => {
    assert.equal(joinPosixRelPath("sub", "we\\ird.txt"), "sub/we\\ird.txt");
  });

  it("collapses a leading `./`", () => {
    assert.equal(joinPosixRelPath("./data", "photo.png"), "data/photo.png");
  });

  it("preserves a traversal", () => {
    assert.equal(joinPosixRelPath("../escape", "photo.png"), "../escape/photo.png");
  });

  it("keeps an absolute POSIX dir absolute", () => {
    assert.equal(joinPosixRelPath("/etc", "passwd"), "/etc/passwd");
  });
});
