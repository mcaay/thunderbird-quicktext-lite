// Background script: registers the compose script, keeps the context menu in
// sync with the library and inserts templates for the panel and the menu.

import { loadLibrary, LIBRARY_KEY } from "./lib/storage.js";
import { displayRows, findTemplate } from "./lib/library.js";
import { msg } from "./lib/i18n.js";
import { rebuildMenus, updateMenus, handleMenuShown, handleMenuClicked } from "./menus.js";
import { openManager, registerComposeScript } from "./lib/integration.js";

const COMPOSE_SCRIPT = { id: "quicktext-lite-compose", js: ["compose/compose.js"] };
const ERROR_MESSAGES = {
  "plain-text": "errorPlainText",
  "not-found": "errorNotFound",
  "insert-failed": "errorInsertFailed",
};

// Listeners are registered at the top level so they wake the background
// script after it has been suspended.
browser.commands.onCommand.addListener(async (command, tab) => {
  const shortcut = /^insert-template-(\d)$/.exec(command);
  if (shortcut && tab?.type === "messageCompose") return insertByNumber(tab.id, Number(shortcut[1]));
  if (command !== "open-template-panel" || tab?.type !== "messageCompose") return;
  try {
    try {
      await browser.tabs.sendMessage(tab.id, { type: "prepare-panel" });
    } catch {
      await browser.scripting.executeScript({ target: { tabId: tab.id }, files: COMPOSE_SCRIPT.js });
      await browser.tabs.sendMessage(tab.id, { type: "prepare-panel" });
    }
    await browser.composeAction.openPopup({ windowId: tab.windowId });
  } catch (error) {
    console.error("Quicktext Lite: opening panel failed", error);
  }
});
browser.runtime.onStartup.addListener(() => initialize());
browser.runtime.onInstalled.addListener(() => initialize());
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(LIBRARY_KEY in changes)) return;
  updateMenus(changes[LIBRARY_KEY]).catch((error) => console.error("Quicktext Lite: menu rebuild failed", error));
});
browser.menus.onShown.addListener((info, tab) => handleMenuShown(info, tab));
browser.menus.onClicked.addListener((info, tab) => handleMenuClicked(info, tab, insertFromMenu));
browser.runtime.onMessage.addListener((message) => {
  // Only the panel sends "insert", and it has just checked that the message
  // is not plain text.
  if (message?.type === "insert") return insertTemplate(message.tabId, message.templateId, { checked: true });
  if (message?.type === "open-manager") {
    // Acknowledge before focusing the main window destroys the popup context.
    openManager().catch((error) => console.error("Quicktext Lite: opening manager failed", error));
    return Promise.resolve({ ok: true });
  }
  return undefined;
});
// Error entries of closed tabs stay in storage.session: tab ids are not
// reused within a session, and a tabs.onRemoved listener would wake this
// script for every tab closed anywhere in Thunderbird.

let initializing = null;
initialize();

// Runs once per Thunderbird session. storage.session survives suspensions of
// the background script but not restarts, updates or re-enabling. A failed
// step leaves the flag unset, so the next start of this script retries.
function initialize() {
  initializing ??= (async () => {
    const { initialized } = await browser.storage.session.get("initialized");
    if (initialized) return;
    await registerComposeScript(COMPOSE_SCRIPT);
    await rebuildMenus();
    await browser.storage.session.set({ initialized: true });
  })()
    .catch((error) => console.error("Quicktext Lite: initialisation failed", error))
    .finally(() => {
      initializing = null;
    });
  return initializing;
}

// getComposeDetails makes Thunderbird serialise the whole message, so it is
// skipped when the caller has just checked for plain text (`checked`).
async function insertTemplate(tabId, templateId, { checked = false } = {}) {
  try {
    if (!checked && (await browser.compose.getComposeDetails(tabId)).isPlainText) {
      return { ok: false, error: "plain-text" };
    }
    const { status, library } = await loadLibrary();
    const template = status === "damaged" ? null : findTemplate(library, templateId);
    if (!template) return { ok: false, error: "not-found" };
    await sendToEditor(tabId, template.html);
  } catch (error) {
    console.error("Quicktext Lite: insert failed", error);
    return { ok: false, error: "insert-failed" };
  }
  // The template is in the message now; clearing an old error must not
  // report it as failed and invite a second insert.
  await forgetError(tabId).catch((error) => console.error("Quicktext Lite: clearing the error failed", error));
  return { ok: true };
}

// Compose windows opened before the add-on was installed have no compose
// script yet; it is injected on first use.
async function sendToEditor(tabId, html) {
  const message = { type: "insert-html", html };
  let response;
  try {
    response = await browser.tabs.sendMessage(tabId, message);
  } catch {
    await browser.scripting.executeScript({ target: { tabId }, files: COMPOSE_SCRIPT.js });
    response = await browser.tabs.sendMessage(tabId, message);
  }
  if (!response?.ok) throw new Error(response?.error || "no answer from the editor");
}

// The menu has no place to show an error, so the toolbar button gets a "!"
// badge and the panel shows the message the next time it opens.
async function insertFromMenu(tabId, templateId) {
  const result = await insertTemplate(tabId, templateId);
  if (!result.ok) await rememberError(tabId, result.error);
}

// Ctrl+Shift+digit (Control+Shift on macOS) inserts the template that has
// this number in the panel, without opening it. A number with no template
// does nothing.
async function insertByNumber(tabId, number) {
  try {
    const { status, library } = await loadLibrary();
    if (status === "damaged") return;
    const row = displayRows(library).find((r) => r.kind === "template" && r.number === number);
    if (row) await insertFromMenu(tabId, row.template.id);
  } catch (error) {
    console.error("Quicktext Lite: shortcut insert failed", error);
  }
}

async function rememberError(tabId, code) {
  const { insertErrors = {} } = await browser.storage.session.get("insertErrors");
  insertErrors[tabId] = code;
  await browser.storage.session.set({ insertErrors });
  await browser.composeAction.setBadgeText({ tabId, text: "!" });
  await browser.composeAction.setBadgeBackgroundColor({ tabId, color: "#d70022" });
  await browser.composeAction.setTitle({ tabId, title: msg(ERROR_MESSAGES[code] ?? "errorInsertFailed") });
}

async function forgetError(tabId) {
  const { insertErrors = {} } = await browser.storage.session.get("insertErrors");
  if (!(tabId in insertErrors)) return;
  delete insertErrors[tabId];
  await browser.storage.session.set({ insertErrors });
  await browser.composeAction.setBadgeText({ tabId, text: "" });
  await browser.composeAction.setTitle({ tabId, title: null });
}
