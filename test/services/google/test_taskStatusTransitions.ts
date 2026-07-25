// The two status transitions on a Google task. `completeTask` and
// `uncompleteTask` differ by one string literal, so the regression these
// guard is a typo or a copy-paste that leaves both sending the same value —
// the request still goes out, still looks like a success to every caller, and
// the task simply doesn't move. What Google does with a *malformed* status is
// not asserted here and could not be: `stubFetch` answers 200 no matter what
// it receives. `globalThis.fetch` is stubbed; no network, no token.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { completeTask, uncompleteTask } from "@mulmoclaude/core/google";

const realFetch = globalThis.fetch;
let requests: { url: string; method: string | undefined; body: string | undefined }[] = [];

function stubFetch(body: unknown): void {
  globalThis.fetch = (async (url: string | URL, init?: Parameters<typeof fetch>[1]) => {
    requests.push({ url: String(url), method: init?.method, body: typeof init?.body === "string" ? init.body : undefined });
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

beforeEach(() => {
  requests = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const taskBody = (status: string) => ({ id: "t1", title: "Buy milk", status });

describe("completeTask", () => {
  it("PATCHes status: completed and nothing else", async () => {
    stubFetch(taskBody("completed"));
    const task = await completeTask("token", { taskId: "t1" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, "PATCH");
    assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), { status: "completed" });
    assert.equal(task.status, "completed");
  });
});

describe("uncompleteTask (#2574)", () => {
  it("PATCHes status: needsAction and nothing else", async () => {
    stubFetch(taskBody("needsAction"));
    const task = await uncompleteTask("token", { taskId: "t1" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, "PATCH");
    // Google's own spelling, per the Tasks v1 `status` enum. Pinned because
    // the casing is easy to get wrong and nothing downstream would catch it —
    // `TaskSummary` just echoes whatever status comes back.
    assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), { status: "needsAction" });
    assert.equal(task.status, "needsAction");
  });

  // PATCH, not PUT — a PUT would need the whole task and would drop every
  // field the caller never read (title, notes, due, position).
  it("does not resend the fields it is not changing", async () => {
    stubFetch(taskBody("needsAction"));
    await uncompleteTask("token", { taskId: "t1" });
    const sent = JSON.parse(requests[0]?.body ?? "{}");
    assert.deepEqual(Object.keys(sent), ["status"]);
  });

  it("targets the default list when no taskListId is given", async () => {
    stubFetch(taskBody("needsAction"));
    await uncompleteTask("token", { taskId: "t1" });
    assert.match(requests[0]?.url ?? "", /\/lists\/%40default\/tasks\/t1$|\/lists\/@default\/tasks\/t1$/);
  });

  it("targets the given list and encodes the task id", async () => {
    stubFetch(taskBody("needsAction"));
    await uncompleteTask("token", { taskId: "a/b", taskListId: "MTIzNDU2" });
    assert.match(requests[0]?.url ?? "", /MTIzNDU2/);
    assert.match(requests[0]?.url ?? "", /a%2Fb/);
  });
});

// The pair must stay opposites. Asserting them together is what catches a
// copy-paste that leaves both sending the same status.
describe("the two transitions are opposites", () => {
  it("send different status values", async () => {
    stubFetch(taskBody("completed"));
    await completeTask("token", { taskId: "t1" });
    stubFetch(taskBody("needsAction"));
    await uncompleteTask("token", { taskId: "t1" });
    const [completed, uncompleted] = requests.map((req) => JSON.parse(req.body ?? "{}").status);
    assert.notEqual(completed, uncompleted);
    assert.deepEqual([completed, uncompleted], ["completed", "needsAction"]);
  });
});
