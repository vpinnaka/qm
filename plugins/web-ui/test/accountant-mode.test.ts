import { test } from "node:test";
import assert from "node:assert/strict";
import { deepLinkPath, parseDeepLink } from "../src/deep-link.ts";
import { ACCOUNTANT_MODE, appState, canView } from "../src/shell-state.ts";

test("accountant mode addresses a client by its own page", () => {
  assert.equal(ACCOUNTANT_MODE, true);
  assert.equal(deepLinkPath("", "contexts", null, "group:web-project-abc"), "/clients/abc");
  assert.equal(deepLinkPath("/web-ui/", "contexts", null, "group:web-project-abc"), "/web-ui/clients/abc");
  assert.equal(deepLinkPath("", "contexts", null), "/clients");
  assert.equal(deepLinkPath("", "contexts", null, "channel:C1"), "/contexts?scope=channel%3AC1");
});

test("a client page URL parses back to the clients view and its item", () => {
  assert.deepEqual(parseDeepLink("", "/clients/abc", ""), { view: "contexts", session: null, item: "abc" });
  assert.deepEqual(parseDeepLink("/web-ui/", "/web-ui/clients/abc", ""), {
    view: "contexts",
    session: null,
    item: "abc",
  });
  assert.deepEqual(parseDeepLink("", "/clients", ""), { view: "contexts", session: null, item: null });
  assert.deepEqual(parseDeepLink("", "/projects/abc", ""), { view: "contexts", session: null, item: "abc" });
});

test("accountant mode hides the developer views and keeps the bookkeeping ones", () => {
  appState.me = { user: "alice", org: "acme", permissions: ["inbox", "loops", "admin"] };
  for (const view of ["webhooks", "crons", "loops", "files", "keychain", "deploys", "memory", "skills"] as const) {
    assert.equal(canView(view), false, view);
  }
  for (const view of ["chats", "inbox", "calendar", "contexts", "settings"] as const) {
    assert.equal(canView(view), true, view);
  }
  appState.me = null;
});
