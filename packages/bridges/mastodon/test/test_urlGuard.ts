// Attachment URLs arrive from remote senders, and with the allowlist unset any
// account can reach that path — so these cases are the boundary between "fetch
// an image" and "make the bridge probe its own network".

/* eslint-disable sonarjs/no-hardcoded-ip -- literal addresses are the fixtures
   under test here; parameterising them would test nothing. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isBlockedAddress, parseSafeUrlShape, resolvePublicUrl } from "../src/urlGuard.js";

describe("isBlockedAddress", () => {
  it("blocks IPv4 loopback", () => {
    assert.equal(isBlockedAddress("127.0.0.1"), true);
    assert.equal(isBlockedAddress("127.255.255.254"), true);
  });

  it("blocks the cloud metadata endpoint", () => {
    assert.equal(isBlockedAddress("169.254.169.254"), true);
  });

  it("blocks the RFC1918 ranges", () => {
    assert.equal(isBlockedAddress("10.0.0.1"), true);
    assert.equal(isBlockedAddress("172.16.0.1"), true);
    assert.equal(isBlockedAddress("172.31.255.255"), true);
    assert.equal(isBlockedAddress("192.168.1.1"), true);
  });

  it("allows addresses just outside the RFC1918 boundaries", () => {
    assert.equal(isBlockedAddress("172.15.255.255"), false);
    assert.equal(isBlockedAddress("172.32.0.1"), false);
    assert.equal(isBlockedAddress("11.0.0.1"), false);
  });

  it("blocks CGNAT, unspecified, multicast and reserved space", () => {
    assert.equal(isBlockedAddress("100.64.0.1"), true);
    assert.equal(isBlockedAddress("0.0.0.0"), true);
    assert.equal(isBlockedAddress("224.0.0.1"), true);
    assert.equal(isBlockedAddress("255.255.255.255"), true);
  });

  it("allows ordinary public addresses", () => {
    assert.equal(isBlockedAddress("1.1.1.1"), false);
    assert.equal(isBlockedAddress("93.184.216.34"), false);
  });

  it("blocks IPv6 loopback, unspecified, ULA and link-local", () => {
    assert.equal(isBlockedAddress("::1"), true);
    assert.equal(isBlockedAddress("::"), true);
    assert.equal(isBlockedAddress("fc00::1"), true);
    assert.equal(isBlockedAddress("fd12:3456::1"), true);
    assert.equal(isBlockedAddress("fe80::1"), true);
  });

  it("unwraps IPv4-mapped IPv6 rather than trusting the wrapper", () => {
    assert.equal(isBlockedAddress("::ffff:127.0.0.1"), true);
    assert.equal(isBlockedAddress("::ffff:169.254.169.254"), true);
    assert.equal(isBlockedAddress("::ffff:1.1.1.1"), false);
  });

  it("allows a public IPv6 address", () => {
    assert.equal(isBlockedAddress("2606:4700:4700::1111"), false);
  });
});

describe("parseSafeUrlShape", () => {
  it("accepts an ordinary https URL", () => {
    assert.notEqual(parseSafeUrlShape("https://example.com/a.png"), null);
  });

  it("rejects a non-http(s) scheme", () => {
    assert.equal(parseSafeUrlShape("file:///etc/passwd"), null);
    assert.equal(parseSafeUrlShape("ftp://example.com/a.png"), null);
    assert.equal(parseSafeUrlShape("data:image/png;base64,AAAA"), null);
  });

  it("rejects unparseable input", () => {
    assert.equal(parseSafeUrlShape("not a url"), null);
    assert.equal(parseSafeUrlShape(""), null);
  });

  it("rejects localhost by name", () => {
    assert.equal(parseSafeUrlShape("http://localhost:3001/x"), null);
    assert.equal(parseSafeUrlShape("http://LOCALHOST/x"), null);
    assert.equal(parseSafeUrlShape("http://foo.localhost/x"), null);
  });

  it("rejects internal-looking suffixes", () => {
    assert.equal(parseSafeUrlShape("http://printer.local/x"), null);
    assert.equal(parseSafeUrlShape("http://db.internal/x"), null);
  });

  it("rejects a trailing-dot localhost", () => {
    assert.equal(parseSafeUrlShape("http://localhost./x"), null);
  });

  it("rejects literal internal addresses", () => {
    assert.equal(parseSafeUrlShape("http://127.0.0.1/x"), null);
    assert.equal(parseSafeUrlShape("http://169.254.169.254/latest/meta-data/"), null);
    assert.equal(parseSafeUrlShape("http://[::1]/x"), null);
  });
});

describe("resolvePublicUrl", () => {
  it("refuses a literal internal address without touching DNS", async () => {
    assert.equal(await resolvePublicUrl("http://127.0.0.1/x"), null);
  });

  it("refuses a hostname that resolves to loopback", async () => {
    // `localhost` is caught by name, but this asserts the resolve path too.
    assert.equal(await resolvePublicUrl("http://localhost/x"), null);
  });

  it("refuses a hostname that does not resolve", async () => {
    assert.equal(await resolvePublicUrl("http://no-such-host.invalid/x"), null);
  });

  it("passes a literal public address straight through", async () => {
    const url = await resolvePublicUrl("https://1.1.1.1/a.png");
    assert.notEqual(url, null);
  });
});
