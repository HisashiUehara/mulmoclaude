// Filename rules for dropped-file uploads (#2270). These decide whether a
// client-supplied name can escape its target folder, so the traversal cases
// matter as much as the happy path.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { renamedCandidate, sanitizeUploadFilename, uploadRelPath } from "../../server/utils/files/upload-name.js";

/** A control character, written as an escape so it stays visible in review. */
const BELL = String.fromCharCode(7);

describe("sanitizeUploadFilename", () => {
  it("keeps an ordinary filename unchanged", () => {
    assert.equal(sanitizeUploadFilename("photo.png"), "photo.png");
  });

  it("reduces a POSIX traversal to its last segment", () => {
    assert.equal(sanitizeUploadFilename("../../etc/passwd"), "passwd");
  });

  it("reduces a Windows path to its last segment (host separator is irrelevant)", () => {
    assert.equal(sanitizeUploadFilename("C:\\Windows\\system32\\evil.dll"), "evil.dll");
  });

  it("strips control characters", () => {
    assert.equal(sanitizeUploadFilename(`repo${BELL}rt.pdf`), "report.pdf");
  });

  it("returns null for an empty name", () => {
    assert.equal(sanitizeUploadFilename(""), null);
  });

  it("returns null for whitespace only", () => {
    assert.equal(sanitizeUploadFilename("   "), null);
  });

  it("returns null for `.`", () => {
    assert.equal(sanitizeUploadFilename("."), null);
  });

  it("returns null for `..`", () => {
    assert.equal(sanitizeUploadFilename(".."), null);
  });

  it("returns null when a path has no final segment", () => {
    assert.equal(sanitizeUploadFilename("foo/bar/"), null);
  });

  it("truncates an over-long name but keeps the extension", () => {
    const result = sanitizeUploadFilename(`${"a".repeat(400)}.png`);
    assert.ok(result !== null);
    assert.ok(result.endsWith(".png"), `expected .png suffix, got ${result}`);
    assert.ok(result.length <= 200, `expected <= 200 chars, got ${result.length}`);
  });

  it("preserves a dotfile name", () => {
    assert.equal(sanitizeUploadFilename(".gitignore"), ".gitignore");
  });

  // Windows drops trailing dots/spaces when it creates the file, so a name
  // ending in one would reach disk as the stripped form while `extname` saw
  // something harmless — an extension-blocklist bypass.
  it("strips a trailing dot so the real extension is visible to policy", () => {
    assert.equal(sanitizeUploadFilename("malware.exe."), "malware.exe");
  });

  it("strips several trailing dots", () => {
    assert.equal(sanitizeUploadFilename("malware.exe..."), "malware.exe");
  });

  it("strips trailing spaces", () => {
    assert.equal(sanitizeUploadFilename("report.pdf  "), "report.pdf");
  });

  it("still rejects a name that is only dots", () => {
    assert.equal(sanitizeUploadFilename("..."), null);
  });
});

describe("renamedCandidate", () => {
  it("inserts the attempt before the extension", () => {
    assert.equal(renamedCandidate("foo.png", 1), "foo (1).png");
  });

  it("appends when there is no extension", () => {
    assert.equal(renamedCandidate("README", 2), "README (2)");
  });

  it("treats a dotfile as having no extension", () => {
    assert.equal(renamedCandidate(".env", 1), ".env (1)");
  });

  it("only splits on the last extension", () => {
    assert.equal(renamedCandidate("archive.tar.gz", 3), "archive.tar (3).gz");
  });
});

// The route returns this string to the client and publishes it as the
// file-change channel, so it has to look the same on every host. Every case
// runs against BOTH host separators — bound to the runner's own `path.sep`,
// the Windows rule is invisible outside Windows CI, which is how the backslash
// form reached main in the first place. The two cases that are deliberately
// NOT host-independent are called out where they appear.
describe("uploadRelPath", () => {
  const WIN32_SEP = "\\";
  const POSIX_SEP = "/";

  /** Same expectation on every host — that identity IS the contract. */
  function expectOnEveryHost(dirRel: string, filename: string, expected: string): void {
    for (const sep of [POSIX_SEP, WIN32_SEP]) {
      assert.equal(uploadRelPath(dirRel, filename, sep), expected, `sep=${JSON.stringify(sep)}`);
    }
  }

  it("joins dir and filename with a POSIX separator", () => {
    expectOnEveryHost("data", "photo.png", "data/photo.png");
  });

  it("keeps a nested directory POSIX-shaped", () => {
    expectOnEveryHost("data/2026/07", "photo.png", "data/2026/07/photo.png");
  });

  // Deliberately host-dependent, and the one case where "same on every host"
  // would be WRONG: on Windows `data\sub` is two directories a client echoed
  // back, but on POSIX a backslash is a legal filename character, so `data\sub`
  // is one directory and splitting it would send the write elsewhere (#2542).
  it("normalises a Windows-shaped directory only on Windows", () => {
    assert.equal(uploadRelPath("data\\sub", "photo.png", WIN32_SEP), "data/sub/photo.png");
    assert.equal(uploadRelPath("data\\sub", "photo.png", POSIX_SEP), "data\\sub/photo.png");
  });

  // Only `dirRel` crosses to POSIX; the filename is appended as one segment and
  // is never rewritten. Host-independent because `sep` never reaches it.
  it("keeps a literal backslash in the filename on every host", () => {
    expectOnEveryHost("data", "we\\ird.txt", "data/we\\ird.txt");
  });

  it("returns the bare filename at the workspace root", () => {
    expectOnEveryHost("", "photo.png", "photo.png");
  });

  it("collapses a leading `./`", () => {
    expectOnEveryHost("./data", "photo.png", "data/photo.png");
  });

  it("keeps a rename candidate's spaces and parentheses intact", () => {
    expectOnEveryHost("data", renamedCandidate("photo.png", 1), "data/photo (1).png");
  });

  // Containment is the resolver's job, but it only recognises an escape it can
  // still see — so the traversal has to survive this join rather than be
  // silently normalised away.
  it("preserves a traversal for the resolver to reject", () => {
    expectOnEveryHost("../escape", "photo.png", "../escape/photo.png");
  });

  // Dropping the leading separator here would turn a path the resolver refuses
  // as absolute into a workspace-relative one it happily writes.
  it("keeps an absolute POSIX dir absolute", () => {
    expectOnEveryHost("/etc", "passwd", "/etc/passwd");
  });

  // Same asymmetry: on Windows this is a drive-absolute path the resolver must
  // refuse; on POSIX it is a directory literally named `C:\Windows`, which the
  // resolver treats as workspace-relative — correctly, because that is what it
  // is there.
  it("keeps a Windows drive-absolute dir absolute on Windows", () => {
    assert.equal(uploadRelPath("C:\\Windows", "evil.dll", WIN32_SEP), "C:/Windows/evil.dll");
    assert.equal(uploadRelPath("C:\\Windows", "evil.dll", POSIX_SEP), "C:\\Windows/evil.dll");
  });

  it("defaults to the host's own separator", () => {
    assert.equal(uploadRelPath("data", "photo.png"), "data/photo.png");
  });
});
