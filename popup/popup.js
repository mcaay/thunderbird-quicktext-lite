// The panel opened from the compose toolbar button or with Cmd/Ctrl+Shift+S.

import { loadLibrary } from "../lib/storage.js";
import { displayRows, filterRows } from "../lib/library.js";
import { applyI18n, msg } from "../lib/i18n.js";

const ERROR_MESSAGES = {
  "plain-text": "errorPlainText",
  "not-found": "errorNotFound",
  "insert-failed": "errorInsertFailed",
};

const list = document.getElementById("list");
const search = document.getElementById("search");
const message = document.getElementById("message");
const errorBox = document.getElementById("error");

// `ready` is set once the rows are shown; `pending` keeps a Cmd/Ctrl+digit or
// Enter pressed before that.
const state = {
  tabId: null,
  isMac: false,
  rows: [],
  visible: [],
  activeId: null,
  busy: false,
  ready: false,
  pending: null,
};

init().catch((error) => {
  console.error("Quicktext Lite: panel failed", error);
  showError(msg("errorInsertFailed"));
});

async function init() {
  applyI18n();
  document.getElementById("manage").addEventListener("click", openManager);
  // Keys and typing count from the first moment: Cmd/Ctrl+Shift+S followed
  // at once by Cmd/Ctrl+1 must insert, not reach Thunderbird.
  document.addEventListener("keydown", onKeyDown, true);
  search.hidden = false;
  if (document.activeElement !== search) search.focus();

  const [[tab], platform, { insertErrors = {} }, { status, library }] = await Promise.all([
    browser.tabs.query({ active: true, currentWindow: true }),
    browser.runtime.getPlatformInfo(),
    browser.storage.session.get("insertErrors"),
    loadLibrary(),
  ]);
  state.tabId = tab.id;
  state.isMac = platform.os === "mac";
  if (!document.hasFocus()) await new Promise((resolve) => window.addEventListener("focus", resolve, { once: true }));
  if (document.activeElement !== search) search.focus();
  // A very fast second key may have reached the editor before this popup
  // existed. Consume that input once, before rendering the initial search.
  const earlyInput = await browser.tabs.sendMessage(tab.id, { type: "take-panel-input" }).catch(() => []);
  const details = await browser.compose.getComposeDetails(tab.id);
  let earlyText = "";
  for (const input of earlyInput ?? []) {
    if (input.text !== undefined) earlyText += input.text;
    else if (input.key === "Backspace") earlyText = [...earlyText].slice(0, -1).join("");
    else if (input.key === "Escape") return window.close();
    else if (!state.pending && input.key === "Enter") state.pending = { enter: true };
    else if (!state.pending && input.number !== undefined) state.pending = { number: input.number };
  }
  // Preserve an in-progress native text edit when nothing was buffered.
  // Reassigning value here can truncate typing during the focus handoff.
  if (earlyText) {
    const start = search.selectionStart;
    const end = search.selectionEnd;
    search.setRangeText(earlyText, 0, 0, "preserve");
    search.setSelectionRange(start + earlyText.length, end + earlyText.length);
  }

  // An insert from the context menu may have failed in this tab.
  if (insertErrors[tab.id]) showError(errorText(insertErrors[tab.id]));

  if (details.isPlainText) return showMessage(msg("errorPlainText"));
  if (status === "damaged") return showMessage(msg("libraryDamaged"));

  state.rows = displayRows(library);
  if (!state.rows.length) return showMessage(msg("popupEmpty"));

  search.addEventListener("input", render);
  render();
  state.ready = true;
  if (state.pending?.number !== undefined) insertNumber(state.pending.number);
  else if (state.pending?.enter && state.activeId) insert(state.activeId);
}

function render() {
  state.visible = filterRows(state.rows, search.value);
  const ids = visibleTemplateIds();
  if (!ids.includes(state.activeId)) state.activeId = ids[0] ?? null;
  list.replaceChildren(...state.visible.map(rowElement));
  message.hidden = ids.length > 0;
  if (!ids.length) message.textContent = msg("popupNoMatches");
  highlight(true);
}

function rowElement(row) {
  const li = document.createElement("li");
  if (row.kind === "group") {
    li.className = "group";
    li.textContent = row.group.name;
    return li;
  }
  li.className = row.group ? "template grouped" : "template";
  li.dataset.id = row.template.id;
  li.setAttribute("role", "option");
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = row.template.name;
  li.append(name);
  if (row.number !== null) {
    const hint = document.createElement("kbd");
    hint.textContent = (state.isMac ? "⌘" : "Ctrl+") + row.number;
    li.append(hint);
  }
  li.addEventListener("click", () => insert(row.template.id));
  li.addEventListener("mousemove", () => {
    if (state.activeId === row.template.id) return;
    state.activeId = row.template.id;
    highlight(false);
  });
  return li;
}

function visibleTemplateIds() {
  return state.visible.filter((row) => row.kind === "template").map((row) => row.template.id);
}

function highlight(scroll) {
  for (const li of list.querySelectorAll("li.template")) {
    const active = li.dataset.id === state.activeId;
    li.classList.toggle("active", active);
    li.setAttribute("aria-selected", String(active));
    if (active && scroll) li.scrollIntoView({ block: "nearest" });
  }
}

// Capture phase, so the panel sees Cmd/Ctrl+digit before anything else.
// Until the rows are shown the platform may be unknown, so either modifier
// counts.
function onKeyDown(event) {
  if (event.isComposing) return;
  const modifier = state.ready ? (state.isMac ? event.metaKey : event.ctrlKey) : event.metaKey || event.ctrlKey;
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(event.code);
  if (modifier && digit && !event.altKey && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    if (state.ready) insertNumber(Number(digit[1]));
    else state.pending = { number: Number(digit[1]) };
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveActive(event.key === "ArrowDown" ? 1 : -1);
  } else if (event.key === "Enter" && !event.target.closest("button")) {
    event.preventDefault();
    if (!state.ready) state.pending = { enter: true };
    else if (state.activeId) insert(state.activeId);
  }
}

function insertNumber(number) {
  const row = state.rows.find((r) => r.kind === "template" && r.number === number);
  if (row) insert(row.template.id);
}

function moveActive(step) {
  const ids = visibleTemplateIds();
  if (!ids.length) return;
  const index = ids.indexOf(state.activeId);
  state.activeId = ids[(index + step + ids.length) % ids.length];
  highlight(true);
}

async function insert(templateId) {
  if (state.busy) return;
  state.busy = true;
  try {
    const result = await browser.runtime.sendMessage({ type: "insert", templateId, tabId: state.tabId });
    if (result?.ok) {
      window.close();
      return;
    }
    showError(errorText(result?.error));
  } catch (error) {
    console.error("Quicktext Lite: insert failed", error);
    showError(msg("errorInsertFailed"));
  } finally {
    state.busy = false;
  }
}

async function openManager() {
  try {
    await browser.runtime.sendMessage({ type: "open-manager" });
  } catch (error) {
    console.error("Quicktext Lite: opening manager failed", error);
  }
}

function errorText(code) {
  return msg(ERROR_MESSAGES[code] ?? "errorInsertFailed");
}

function showMessage(text) {
  message.textContent = text;
  message.hidden = false;
  search.hidden = true;
}

function showError(text) {
  errorBox.textContent = text;
  errorBox.hidden = false;
}
