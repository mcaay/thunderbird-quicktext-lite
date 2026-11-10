// Context menu in the message body: "Insert template" with the same
// structure as the panel.

import { loadLibrary, readLibrary } from "./lib/storage.js";
import { msg } from "./lib/i18n.js";
import { openManager } from "./lib/integration.js";

// Every item, children included, names the context: an item without one
// gets the default context, which does not match the message body.
const CONTEXTS = ["compose_body"];
const MENU_ROOT = "qtl-root";
const MENU_MANAGE = "qtl-manage";
const TEMPLATE_PREFIX = "qtl-template:";
const GROUP_PREFIX = "qtl-group:";

let queue = Promise.resolve();

// Called with the storage.onChanged entry of every library write. The menu
// shows names and order only, so an autosave of template HTML leaves it as
// it is. Both values come with the event, so nothing is read again.
export function updateMenus({ oldValue, newValue }) {
  const next = readLibrary(newValue);
  if (menuSignature(readLibrary(oldValue)) === menuSignature(next)) return Promise.resolve();
  return rebuildMenus(next);
}

function menuSignature({ status, library }) {
  if (status === "damaged") return "damaged";
  return JSON.stringify(
    library.items.map((item) =>
      item.type === "group" ? [item.id, item.name, item.templates.map((t) => [t.id, t.name])] : [item.id, item.name],
    ),
  );
}

// Rebuilds run one after another, so overlapping library changes cannot
// leave the menu half built. The returned promise rejects when the build
// fails, so the caller decides how to report it. `loaded` is a result of
// readLibrary; without it the library is read from storage.
export function rebuildMenus(loaded) {
  queue = queue.catch(() => {}).then(() => build(loaded));
  return queue;
}

async function build(loaded) {
  const { status, library } = loaded ?? (await loadLibrary());
  const items = status === "damaged" ? [] : library.items;
  const entries = [{ id: MENU_ROOT, title: msg("menuInsertTemplate") }];
  let templates = 0;
  for (const item of items) {
    if (item.type === "template") {
      entries.push({ id: TEMPLATE_PREFIX + item.id, parentId: MENU_ROOT, title: menuLabel(item.name) });
      templates++;
    } else if (item.templates.length) {
      const groupMenuId = GROUP_PREFIX + item.id;
      entries.push({ id: groupMenuId, parentId: MENU_ROOT, title: menuLabel(item.name) });
      for (const template of item.templates) {
        entries.push({ id: TEMPLATE_PREFIX + template.id, parentId: groupMenuId, title: menuLabel(template.name) });
        templates++;
      }
    }
  }
  if (!templates) {
    const title = msg(status === "damaged" ? "libraryDamaged" : "menuEmpty");
    entries.push({ id: "qtl-empty", parentId: MENU_ROOT, title, enabled: false });
  }
  entries.push({ id: "qtl-separator", parentId: MENU_ROOT, type: "separator" });
  entries.push({ id: MENU_MANAGE, parentId: MENU_ROOT, title: msg("menuManage") });
  await browser.menus.removeAll();
  // Thunderbird handles the create calls in the order they are made, so a
  // parent always exists before its children: one wait instead of one per item.
  await Promise.all(entries.map(create));
}

// "&" marks an access key in menu titles; "&&" is a literal ampersand.
function menuLabel(name) {
  return name.replace(/&/g, "&&");
}

function create(properties) {
  return new Promise((resolve, reject) => {
    browser.menus.create({ contexts: CONTEXTS, ...properties }, () => {
      const error = browser.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

// Disables the menu in plain-text messages.
export async function handleMenuShown(info, tab) {
  if (!info.menuIds.includes(MENU_ROOT) || !tab) return;
  let plainText;
  try {
    plainText = (await browser.compose.getComposeDetails(tab.id)).isPlainText;
  } catch {
    return;
  }
  await browser.menus.update(MENU_ROOT, {
    enabled: !plainText,
    title: msg(plainText ? "menuInsertTemplateHtmlOnly" : "menuInsertTemplate"),
  });
  await browser.menus.refresh();
}

export function handleMenuClicked(info, tab, insertTemplate) {
  const id = String(info.menuItemId);
  if (id === MENU_MANAGE) return openManager();
  if (id.startsWith(TEMPLATE_PREFIX) && tab) return insertTemplate(tab.id, id.slice(TEMPLATE_PREFIX.length));
  return undefined;
}
