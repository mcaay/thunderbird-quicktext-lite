import { test } from "node:test";
import assert from "node:assert/strict";
import { openManager, registerComposeScript } from "../lib/integration.js";
import { rebuildMenus, updateMenus, handleMenuShown, handleMenuClicked } from "../menus.js";

test("registers a missing compose script without querying an unknown ID", async () => {
  const script = { id: "quicktext-lite-compose", js: ["compose/compose.js"] };
  const registered = [{ id: "another-script" }];
  let writes = 0;
  globalThis.browser = { scripting: { compose: {
    async getRegisteredScripts(...args) { assert.deepEqual(args, []); return registered; },
    async registerScripts(scripts) { registered.push(...scripts); writes++; },
  } } };
  await registerComposeScript(script);
  await registerComposeScript(script);
  assert.equal(writes, 1);
  assert.deepEqual(registered[1], script);
});

function managerBrowser(tabs = []) {
  const calls = [];
  globalThis.browser = {
    runtime: {
      getURL: (path) => `moz-extension://test/${path}`,
      async openOptionsPage() {
        calls.push(["options"]);
        tabs.push({ id: 9, windowId: 7, url: "moz-extension://test/manager/manager.html" });
      },
    },
    tabs: {
      async query(query) { assert.deepEqual(query, { type: "content" }); return tabs; },
      async create(options) { calls.push(["create", options]); return { id: 9, windowId: options.windowId }; },
      async update(...args) { calls.push(["tab", ...args]); },
    },
    windows: {
      async getAll(query) { assert.deepEqual(query, { windowTypes: ["normal"] }); return [{ id: 7 }]; },
      async update(...args) { calls.push(["window", ...args]); },
    },
  };
  return calls;
}

test("reuses the manager tab and focuses its window without tabs permission", async () => {
  const calls = managerBrowser([{ id: 3, windowId: 7, url: "moz-extension://test/manager/manager.html" }]);
  await openManager();
  assert.deepEqual(calls, [["tab", 3, { active: true }], ["window", 7, { focused: true }]]);
});

test("creates a proper extension options tab and focuses its main window", async () => {
  const calls = managerBrowser();
  await openManager();
  assert.deepEqual(calls, [
    ["options"],
    ["tab", 9, { active: true }], ["window", 7, { focused: true }],
  ]);
});

test("waits for the options tab URL to become available", async () => {
  const calls = managerBrowser();
  const query = browser.tabs.query;
  let reads = 0;
  browser.tabs.query = async (options) => ++reads <= 2 ? [] : query(options);
  await openManager();
  assert.equal(reads, 3);
  assert.deepEqual(calls.at(-1), ["window", 7, { focused: true }]);
});

test("every context-menu child works in compose_body and grouped inserts route correctly", async () => {
  const entries = [];
  globalThis.browser = {
    runtime: {}, i18n: { getMessage: (key) => key },
    storage: { local: { async get() { return { library: { version: 1, items: [
      { type: "template", id: "a", name: "A&B", html: "A" },
      { type: "group", id: "g", name: "Group", templates: [
        { type: "template", id: "b", name: "B", html: "B" },
      ] },
    ] } }; } } },
    menus: { async removeAll() { entries.length = 0; }, create(entry, callback) { entries.push(entry); callback(); } },
  };
  await rebuildMenus();
  assert.equal(entries.length, 6);
  for (const entry of entries) assert.deepEqual(entry.contexts, ["compose_body"]);
  assert.equal(entries.find((e) => e.id === "qtl-template:a").title, "A&&B");
  assert.equal(entries.find((e) => e.id === "qtl-template:b").parentId, "qtl-group:g");
  const inserted = [];
  await handleMenuClicked({ menuItemId: "qtl-template:b" }, { id: 4 }, (...args) => inserted.push(args));
  assert.deepEqual(inserted, [[4, "b"]]);
});

function menuBrowser({ failCreate = false } = {}) {
  const calls = { reads: 0, removeAll: 0, entries: [] };
  globalThis.browser = {
    runtime: { lastError: null },
    i18n: { getMessage: (key) => key },
    storage: { local: { async get() { calls.reads++; return {}; } } },
    menus: {
      async removeAll() { calls.removeAll++; calls.entries.length = 0; },
      create(entry, callback) {
        calls.entries.push(entry);
        if (failCreate) browser.runtime.lastError = { message: "create failed" };
        callback();
        browser.runtime.lastError = null;
      },
    },
  };
  return calls;
}

test("only changes the menu shows rebuild it, from the value in the change event", async () => {
  const calls = menuBrowser();
  const library = (html, name = "A") => ({ version: 1, items: [
    { type: "template", id: "a", name, html },
    { type: "group", id: "g", name: "G", templates: [{ type: "template", id: "b", name: "B", html }] },
  ] });
  await updateMenus({ oldValue: library("<p>1</p>"), newValue: library("<p>2</p>") });
  assert.equal(calls.removeAll, 0);
  await updateMenus({ oldValue: library("<p>2</p>"), newValue: library("<p>2</p>", "Renamed") });
  assert.equal(calls.removeAll, 1);
  assert.equal(calls.reads, 0);
  assert.equal(calls.entries.find((e) => e.id === "qtl-template:a").title, "Renamed");
  await updateMenus({ oldValue: undefined, newValue: { version: 1, items: [] } });
  assert.equal(calls.removeAll, 1, "an empty library shows the same menu as no library");
});

test("damaged data gets its own menu entry instead of the empty one", async () => {
  const calls = menuBrowser();
  await updateMenus({ oldValue: { version: 1, items: [] }, newValue: { version: 99 } });
  const notice = calls.entries.find((e) => e.id === "qtl-empty");
  assert.deepEqual([notice.title, notice.enabled], ["libraryDamaged", false]);
});

test("a failed menu build rejects, so initialisation can retry, and does not block the next one", async () => {
  menuBrowser({ failCreate: true });
  await assert.rejects(rebuildMenus(), /create failed/);
  const calls = menuBrowser();
  await rebuildMenus();
  assert.deepEqual(calls.entries.map((e) => e.id), ["qtl-root", "qtl-empty", "qtl-separator", "qtl-manage"]);
});

test("context menu switches from plain text back to HTML", async () => {
  const updates = [];
  let plainText = true;
  globalThis.browser = {
    i18n: { getMessage: (key) => key },
    compose: { async getComposeDetails() { return { isPlainText: plainText }; } },
    menus: { async update(id, options) { updates.push(options); }, async refresh() {} },
  };
  await handleMenuShown({ menuIds: ["qtl-root"] }, { id: 1 });
  plainText = false;
  await handleMenuShown({ menuIds: ["qtl-root"] }, { id: 2 });
  assert.deepEqual(updates, [
    { enabled: false, title: "menuInsertTemplateHtmlOnly" },
    { enabled: true, title: "menuInsertTemplate" },
  ]);
});
