import { test } from "node:test";
import assert from "node:assert/strict";

const library = { version: 1, items: [{ type: "template", id: "a", name: "A", html: "<p>A</p>" }] };

// A fresh copy of background.js per test, so its start-up runs against this fake.
async function startBackground(name, { failCreate = false, failErrorList = false } = {}) {
  const listeners = {};
  const on = (key) => ({ addListener: (listener) => { listeners[key] = listener; } });
  const calls = [];
  const session = {};
  globalThis.browser = {
    commands: { onCommand: on("commands.onCommand") },
    runtime: { onStartup: on("onStartup"), onInstalled: on("onInstalled"), onMessage: on("onMessage"), lastError: null },
    storage: {
      onChanged: on("storage.onChanged"),
      local: { async get() { return { library }; } },
      session: {
        async get(key) {
          if (key === "insertErrors" && failErrorList) throw new Error("session storage failed");
          return { [key]: session[key] };
        },
        async set(values) { Object.assign(session, values); },
      },
    },
    menus: {
      onShown: on("menus.onShown"),
      onClicked: on("menus.onClicked"),
      async removeAll() {},
      create(entry, callback) {
        if (failCreate) browser.runtime.lastError = { message: "create failed" };
        callback();
        browser.runtime.lastError = null;
      },
    },
    scripting: { compose: { async getRegisteredScripts() { return []; }, async registerScripts() {} } },
    compose: { async getComposeDetails() { calls.push("getComposeDetails"); return { isPlainText: false }; } },
    tabs: {
      onRemoved: on("tabs.onRemoved"),
      async sendMessage(tabId, message) { calls.push(["insert", tabId, message.html]); return { ok: true }; },
    },
    composeAction: { async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle() {} },
    i18n: { getMessage: (key) => key },
  };
  await import(`../background.js?${name}`);
  // onStartup returns the start-up initialisation that is already running.
  await listeners.onStartup();
  return { listeners, calls, session };
}

test("a panel insert skips the plain-text check the panel has made, a menu insert keeps it", async () => {
  const { listeners, calls } = await startBackground("insert");
  assert.deepEqual(await listeners.onMessage({ type: "insert", tabId: 5, templateId: "a" }), { ok: true });
  assert.deepEqual(calls, [["insert", 5, "<p>A</p>"]]);
  await listeners["menus.onClicked"]({ menuItemId: "qtl-template:a" }, { id: 6 });
  assert.deepEqual(calls.slice(1), ["getComposeDetails", ["insert", 6, "<p>A</p>"]]);
});

test("an insert that reached the editor is reported as done even if clearing an old error fails", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const { listeners, calls } = await startBackground("forget", { failErrorList: true });
  assert.deepEqual(await listeners.onMessage({ type: "insert", tabId: 5, templateId: "a" }), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(logged.mock.callCount(), 1);
});

test("a failed menu build leaves initialisation open for a retry", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const { listeners, session } = await startBackground("init", { failCreate: true });
  assert.equal(session.initialized, undefined);
  assert.equal(logged.mock.callCount(), 1);
  browser.menus.create = (entry, callback) => callback();
  await listeners.onStartup();
  assert.equal(session.initialized, true);
});

test("closing tabs does not wake the background", async () => {
  const { listeners } = await startBackground("tabs");
  assert.equal(listeners["tabs.onRemoved"], undefined);
});

test("the panel command prepares the compose editor before focusing its popup", async () => {
  const { listeners } = await startBackground("panel-command");
  const calls = [];
  browser.tabs.sendMessage = async (id, message) => calls.push(["prepare", id, message.type]);
  browser.composeAction.openPopup = async (options) => calls.push(["popup", options.windowId]);
  await listeners["commands.onCommand"]("open-template-panel", { id: 5, windowId: 9, type: "mail" });
  assert.deepEqual(calls, []);
  await listeners["commands.onCommand"]("open-template-panel", { id: 6, windowId: 10, type: "messageCompose" });
  assert.deepEqual(calls, [["prepare", 6, "prepare-panel"], ["popup", 10]]);
});

// Ctrl+Shift+digit (Control+Shift on macOS) inserts a template by its panel
// number. The shared fake library gets other items for these tests only.
async function withLibraryItems(items, run) {
  const saved = library.items;
  library.items = items;
  try {
    await run();
  } finally {
    library.items = saved;
  }
}

const numbered = [
  { type: "template", id: "t1", name: "One", html: "<p>1</p>" },
  {
    type: "group",
    id: "g",
    name: "Group",
    templates: [
      { type: "template", id: "t2", name: "Two", html: "<p>2</p>" },
      { type: "template", id: "t3", name: "Three", html: "<p>3</p>" },
    ],
  },
];

test("a number shortcut inserts the template with that panel number without opening the panel", async () => {
  await withLibraryItems(numbered, async () => {
    const { listeners, calls } = await startBackground("shortcut-insert");
    browser.composeAction.openPopup = async () => calls.push("popup");
    await listeners["commands.onCommand"]("insert-template-2", { id: 7, windowId: 3, type: "messageCompose" });
    assert.deepEqual(calls, ["getComposeDetails", ["insert", 7, "<p>2</p>"]]);
  });
});

test("the tenth template answers to the 0 shortcut", async () => {
  const eleven = Array.from({ length: 11 }, (_, i) => ({ type: "template", id: `n${i + 1}`, name: `N${i + 1}`, html: `<p>${i + 1}</p>` }));
  await withLibraryItems(eleven, async () => {
    const { listeners, calls } = await startBackground("shortcut-zero");
    await listeners["commands.onCommand"]("insert-template-0", { id: 7, windowId: 3, type: "messageCompose" });
    assert.deepEqual(calls, ["getComposeDetails", ["insert", 7, "<p>10</p>"]]);
  });
});

test("a number shortcut does nothing without a template for its number or outside a compose window", async () => {
  await withLibraryItems(numbered, async () => {
    const { listeners, calls } = await startBackground("shortcut-none");
    await listeners["commands.onCommand"]("insert-template-4", { id: 7, windowId: 3, type: "messageCompose" });
    await listeners["commands.onCommand"]("insert-template-1", { id: 8, windowId: 4, type: "mail" });
    assert.deepEqual(calls, []);
  });
});

test("a number shortcut in a plain-text message marks the toolbar button like a menu insert", async () => {
  await withLibraryItems(numbered, async () => {
    const { listeners, calls, session } = await startBackground("shortcut-plain");
    browser.compose.getComposeDetails = async () => ({ isPlainText: true });
    const badges = [];
    browser.composeAction.setBadgeText = async (details) => badges.push(details);
    await listeners["commands.onCommand"]("insert-template-1", { id: 7, windowId: 3, type: "messageCompose" });
    assert.deepEqual(calls, []);
    assert.deepEqual(badges, [{ tabId: 7, text: "!" }]);
    assert.equal(session.insertErrors[7], "plain-text");
  });
});

test("the ten number shortcuts have keys and descriptions in both languages", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  const { commands } = read("../manifest.json");
  const en = read("../_locales/en/messages.json");
  const pl = read("../_locales/pl/messages.json");
  for (const digit of "1234567890") {
    const command = commands[`insert-template-${digit}`];
    assert.deepEqual(command.suggested_key, { default: `Ctrl+Shift+${digit}`, mac: `MacCtrl+Shift+${digit}` });
    const key = command.description.replace(/^__MSG_|__$/g, "");
    assert.ok(en[key]?.message && pl[key]?.message, key);
  }
});
