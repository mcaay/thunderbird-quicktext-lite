// Template manager: tree of groups and templates, HTML editor with preview,
// import and export.

import { loadLibrary, saveLibrary } from "../lib/storage.js";
import {
  emptyLibrary,
  createTemplate,
  createGroup,
  findItem,
  addTemplate,
  addGroup,
  appendItems,
  removeItem,
  renameItem,
  setTemplateHtml,
  canMove,
  moveItem,
} from "../lib/library.js";
import { parseImport, ImportError } from "../lib/import.js";
import { createBackup, backupFileName } from "../lib/backup.js";
import { formatSize } from "../lib/datauri.js";
import { previewDocument } from "../lib/preview.js";
import { applyI18n, msg } from "../lib/i18n.js";
import { createEditor } from "./editor.js";

const IMAGE_WARNING_BYTES = 1024 * 1024;
const SAVE_DELAY = 500;
const PREVIEW_DELAY = 300;

const $ = (id) => document.getElementById(id);
const tree = $("tree");

const state = {
  library: emptyLibrary(),
  // Nothing is saved before the stored library has been read.
  loaded: false,
  damaged: null,
  selectedId: null,
  editorTemplateId: null,
  editorDirty: false,
  pendingSave: false,
  saveTimer: null,
  previewTimer: null,
  saving: Promise.resolve(),
  dragId: null,
};

let editor;

// After a failed read everything stays locked: saving would replace
// templates that were never shown.
init().catch((error) => {
  console.error("Quicktext Lite: manager failed", error);
  setStatus(msg("loadFailed", String(error)), true);
});

async function init() {
  applyI18n();
  editor = createEditor($("editor"), {
    onChange: onEditorChange,
    words: { image: msg("chipImage"), data: msg("chipData") },
  });
  bindToolbar();
  bindTree();
  bindDetail();
  bindImport();
  bindBanner();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveNow();
  });
  window.addEventListener("pagehide", () => saveNow());

  const loaded = await loadLibrary();
  if (loaded.status === "damaged") {
    state.damaged = loaded;
    $("banner-text").textContent = msg("damagedData", loaded.error);
    $("banner").hidden = false;
  } else {
    state.library = loaded.library;
  }
  state.loaded = true;
  renderTree();
  select(state.library.items[0]?.id ?? null);
}

// ---------- saving ----------

function markChanged() {
  state.pendingSave = true;
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveNow, SAVE_DELAY);
}

function saveNow() {
  clearTimeout(state.saveTimer);
  commitEditor();
  if (!state.pendingSave || !state.loaded || state.damaged) return state.saving;
  state.pendingSave = false;
  const snapshot = state.library;
  state.saving = state.saving
    .then(() => saveLibrary(snapshot))
    .then(
      () => setStatus(msg("statusSaved")),
      (error) => {
        // The next change saves the whole library again.
        state.pendingSave = true;
        setStatus(msg("statusSaveFailed", error?.message ?? String(error)), true);
      },
    );
  return state.saving;
}

// The editor content is copied into the library lazily: before saving,
// before switching templates and before structural changes.
function commitEditor() {
  if (!state.editorTemplateId || !state.editorDirty) return;
  state.library = setTemplateHtml(state.library, state.editorTemplateId, editor.getContent());
  state.editorDirty = false;
}

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
}

function setNotice(text) {
  $("notice").textContent = text ?? "";
  $("notice").hidden = !text;
}

// ---------- tree ----------

function renderTree() {
  const root = document.createElement("ul");
  root.className = "tree-root";
  root.setAttribute("role", "tree");
  for (const item of state.library.items) root.append(nodeElement(item, false));
  const end = document.createElement("div");
  end.className = "tree-end";
  tree.replaceChildren(root, end);
  renderSelection();
}

function nodeElement(item, grouped) {
  const li = document.createElement("li");
  li.className = `node ${item.type}`;
  const row = document.createElement("div");
  row.className = item.type === "group" ? "row group-row" : grouped ? "row grouped" : "row";
  row.dataset.id = item.id;
  row.tabIndex = -1;
  row.setAttribute("role", "treeitem");
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = item.name;
  row.append(label);
  li.append(row);
  if (item.type === "group") {
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(item.templates.length);
    row.append(count);
    row.setAttribute("aria-expanded", "true");
    const children = document.createElement("ul");
    children.setAttribute("role", "group");
    for (const template of item.templates) children.append(nodeElement(template, true));
    li.append(children);
  }
  return li;
}

function rowOf(id) {
  return tree.querySelector(`.row[data-id="${CSS.escape(id)}"]`);
}

function renderSelection() {
  for (const row of tree.querySelectorAll(".row")) {
    const selected = row.dataset.id === state.selectedId;
    row.classList.toggle("selected", selected);
    row.setAttribute("aria-selected", String(selected));
    row.tabIndex = selected ? 0 : -1;
  }
  const locked = !state.loaded || Boolean(state.damaged);
  for (const id of ["new-template", "new-group", "import", "export"]) $(id).disabled = locked;
  $("delete").disabled = locked || !state.selectedId;
}

function select(id) {
  commitEditor();
  setNotice(null);
  state.selectedId = id && findItem(state.library, id) ? id : null;
  renderSelection();
  renderDetail();
}

function bindTree() {
  tree.addEventListener("click", (event) => {
    const row = event.target.closest(".row");
    // Re-selecting the current row would reset the editor and its undo history.
    if (row && row.dataset.id !== state.selectedId) select(row.dataset.id);
  });
  tree.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = [...tree.querySelectorAll(".row")];
    const index = rows.findIndex((row) => row.dataset.id === state.selectedId);
    const next = rows[Math.min(rows.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      select(next.dataset.id);
      next.focus();
    }
  });

  // Internal moves do not need an OS drag session. Pointer capture also keeps
  // a fast drag reliable when the pointer leaves a row or the tree.
  let gesture = null;
  let suppressClick = false;
  const cancel = () => {
    const pointerId = gesture?.pointerId;
    gesture = null;
    endDrag();
    if (pointerId !== undefined && tree.hasPointerCapture(pointerId)) tree.releasePointerCapture(pointerId);
  };
  tree.addEventListener("click", (event) => {
    if (suppressClick) {
      event.stopImmediatePropagation();
      event.preventDefault();
      suppressClick = false;
    }
  }, true);
  tree.addEventListener("pointerdown", (event) => {
    const row = event.target.closest?.(".row");
    if (!row || state.damaged || event.button !== 0 || !event.isPrimary) return;
    gesture = { id: row.dataset.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    tree.setPointerCapture(event.pointerId);
  });
  tree.addEventListener("pointermove", (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (!state.dragId) {
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 5) return;
      commitEditor();
      state.dragId = gesture.id;
      rowOf(state.dragId)?.classList.add("dragging");
    }
    event.preventDefault();
    const bounds = tree.getBoundingClientRect();
    if (event.clientX >= bounds.left && event.clientX <= bounds.right) {
      if (event.clientY < bounds.top + 28) tree.scrollTop -= 20;
      else if (event.clientY > bounds.bottom - 28) tree.scrollTop += 20;
    }
    const target = dropTarget(event);
    clearDropMarks();
    if (target && canMove(state.library, state.dragId, target)) markDrop(target);
  });
  tree.addEventListener("pointerup", (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const clickedId = gesture.id;
    const id = state.dragId;
    const target = id ? dropTarget(event) : null;
    if (id) {
      event.preventDefault();
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }
    cancel();
    // Pointer capture retargets the click to the tree. Preserve ordinary row
    // selection explicitly, without resetting the selected editor's history.
    if (!id) {
      if (clickedId !== state.selectedId) select(clickedId);
      return;
    }
    if (!target || !canMove(state.library, id, target)) return;
    const moved = moveItem(state.library, id, target);
    if (moved === state.library) return;
    state.library = moved;
    structureChanged(id);
  });
  tree.addEventListener("pointercancel", cancel);
  tree.addEventListener("lostpointercapture", cancel);
  window.addEventListener("blur", cancel);
  tree.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && gesture) {
      event.preventDefault();
      cancel();
    }
  });
}

// A template dropped on the upper 30% of a group header goes before the
// group, lower down it goes into the group. Everything else is before or
// after the row under the pointer; below the last row means the end.
function dropTarget(event) {
  const element = document.elementFromPoint(event.clientX, event.clientY);
  if (!element || !tree.contains(element)) return null;
  // The tree's own padding and scrollbar count as the row at that height.
  const row = element.closest(".row") ?? (element === tree ? rowAtHeight(event.clientY) : null);
  if (!row) return element === tree || element.closest(".tree-end") ? { position: "end" } : null;
  const rect = row.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / rect.height;
  const refId = row.dataset.id;
  if (row.classList.contains("group-row") && findItem(state.library, state.dragId)?.item.type === "template") {
    return { refId, position: ratio < 0.3 ? "before" : "into" };
  }
  return { refId, position: ratio < 0.5 ? "before" : "after" };
}

// The row that spans height y, the first row when y is above all rows, or
// null below the last row.
function rowAtHeight(y) {
  return [...tree.querySelectorAll(".row")].find((row) => y < row.getBoundingClientRect().bottom) ?? null;
}

// "After" a group means after the whole group, so the mark goes on its block.
function markDrop(target) {
  if (target.position === "end") {
    tree.querySelector(".tree-end")?.classList.add("drop-end");
    return;
  }
  const row = rowOf(target.refId);
  if (!row) return;
  const isGroupBlock = row.classList.contains("group-row") && target.position !== "into";
  (isGroupBlock ? row.parentElement : row).classList.add(`drop-${target.position}`);
}

function clearDropMarks() {
  for (const element of tree.querySelectorAll(".drop-before, .drop-after, .drop-into, .drop-end")) {
    element.classList.remove("drop-before", "drop-after", "drop-into", "drop-end");
  }
}

function endDrag() {
  state.dragId = null;
  clearDropMarks();
  for (const row of tree.querySelectorAll(".dragging")) row.classList.remove("dragging");
}

// ---------- toolbar ----------

function bindToolbar() {
  $("new-template").addEventListener("click", () => {
    commitEditor();
    const template = createTemplate(msg("defaultTemplateName"));
    state.library = addTemplate(state.library, template, state.selectedId);
    structureChanged(template.id, true);
  });
  $("new-group").addEventListener("click", () => {
    commitEditor();
    const group = createGroup(msg("defaultGroupName"));
    state.library = addGroup(state.library, group, state.selectedId);
    structureChanged(group.id, true);
  });
  $("delete").addEventListener("click", deleteSelected);
  $("export").addEventListener("click", async () => {
    await saveNow();
    download(createBackup(state.library), backupFileName());
  });
}

function structureChanged(selectId, focusName = false) {
  renderTree();
  select(selectId);
  markChanged();
  saveNow();
  if (focusName) {
    $("name").focus();
    $("name").select();
  }
}

function deleteSelected() {
  const found = state.selectedId ? findItem(state.library, state.selectedId) : null;
  if (!found) return;
  const question =
    found.item.type === "group"
      ? msg("confirmDeleteGroup", found.item.name, found.item.templates.length)
      : msg("confirmDeleteTemplate", found.item.name);
  if (!window.confirm(question)) return;
  commitEditor();
  const next = neighbourOf(found);
  state.library = removeItem(state.library, found.item.id);
  state.editorTemplateId = null;
  state.editorDirty = false;
  structureChanged(next);
}

// The row after the deleted block, or the one before it.
function neighbourOf(found) {
  const removed = new Set([found.item.id, ...(found.item.templates ?? []).map((template) => template.id)]);
  const ids = [...tree.querySelectorAll(".row")].map((row) => row.dataset.id);
  const position = ids.indexOf(found.item.id);
  const after = ids.slice(position).find((id) => !removed.has(id));
  const before = ids.slice(0, position).reverse().find((id) => !removed.has(id));
  return after ?? before ?? null;
}

function download(text, fileName) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------- detail ----------

function renderDetail() {
  const found = state.selectedId ? findItem(state.library, state.selectedId) : null;
  $("placeholder").hidden = Boolean(found);
  $("placeholder").textContent = msg(state.library.items.length ? "selectHint" : "emptyLibrary");
  $("item-form").hidden = !found;
  state.editorTemplateId = null;
  state.editorDirty = false;
  if (!found) return;
  $("name").value = found.item.name;
  setNameValidity(true);
  const isTemplate = found.item.type === "template";
  $("template-fields").hidden = !isTemplate;
  if (isTemplate) {
    editor.setContent(found.item.html);
    state.editorTemplateId = found.item.id;
    updatePreview(found.item.html);
  }
}

function bindDetail() {
  $("name").addEventListener("input", () => {
    const name = $("name").value.trim();
    setNameValidity(Boolean(name));
    if (!name || !state.selectedId) return;
    state.library = renameItem(state.library, state.selectedId, name);
    const label = rowOf(state.selectedId)?.querySelector(".label");
    if (label) label.textContent = name;
    markChanged();
  });
  // An empty name is never saved; leaving the field restores the last one.
  $("name").addEventListener("change", () => {
    if ($("name").value.trim()) return;
    const found = state.selectedId ? findItem(state.library, state.selectedId) : null;
    if (found) $("name").value = found.item.name;
    setNameValidity(true);
  });

  $("insert-image").addEventListener("click", () => $("image-file").click());
  $("image-file").addEventListener("change", async () => {
    const file = $("image-file").files[0];
    $("image-file").value = "";
    if (!file) return;
    const templateId = state.editorTemplateId;
    const dataUrl = await readAsDataUrl(file);
    // Another item selected while the file was read must not receive it.
    if (state.editorTemplateId !== templateId) return;
    editor.insertAtCursor(`<img src="${dataUrl}" alt="">`);
    setNotice(file.size > IMAGE_WARNING_BYTES ? msg("imageTooLarge", formatSize(file.size)) : null);
  });
}

function setNameValidity(valid) {
  $("name").classList.toggle("invalid", !valid);
  $("name").title = valid ? "" : msg("nameRequired");
}

function onEditorChange() {
  if (!state.editorTemplateId) return;
  state.editorDirty = true;
  markChanged();
  clearTimeout(state.previewTimer);
  state.previewTimer = setTimeout(() => updatePreview(editor.getContent()), PREVIEW_DELAY);
}

// The preview iframe is sandboxed without scripts or same-origin access.
function updatePreview(html) {
  $("preview").srcdoc = previewDocument(html);
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ---------- import ----------

function bindImport() {
  const dialog = $("import-dialog");
  const confirmButton = $("import-confirm");
  // Each opening of the dialog is one import. A file still being read when
  // the dialog is closed (Cancel, Escape) or opened again is dropped.
  let run = 0;
  const cancelled = (current) => !dialog.open || current !== run;
  $("import").addEventListener("click", () => {
    run++;
    $("import-file").value = "";
    $("import-error").hidden = true;
    confirmButton.disabled = false;
    dialog.showModal();
  });
  $("import-cancel").addEventListener("click", () => dialog.close());
  confirmButton.addEventListener("click", async (event) => {
    event.preventDefault();
    const file = $("import-file").files[0];
    if (!file) return showImportError(msg("importNoFile"));
    const current = run;
    // A second click while the file is read would import it twice.
    confirmButton.disabled = true;
    let result;
    try {
      result = parseImport(await file.text(), {
        parseXml: (text) => new DOMParser().parseFromString(text, "text/xml"),
        flatten: $("import-flatten").checked,
        untitled: msg("untitled"),
      });
    } catch (error) {
      if (cancelled(current)) return;
      confirmButton.disabled = false;
      return showImportError(importErrorText(error));
    }
    if (cancelled(current)) return;
    dialog.close();
    commitEditor();
    state.library = appendItems(state.library, result.items);
    structureChanged(result.items[0]?.id ?? state.selectedId);
    setNotice(importSummary(result.stats));
  });
}

function showImportError(text) {
  $("import-error").textContent = text;
  $("import-error").hidden = false;
}

function importErrorText(error) {
  if (error instanceof ImportError && error.code === "unknown-format") return msg("importErrorUnknownFormat");
  return msg("importErrorInvalid", error?.detail || error?.message || String(error));
}

function importSummary({ templates, groups, flattened, withTags }) {
  const parts = [msg("importSummary", templates, groups)];
  if (flattened) parts.push(msg("importSummaryFlattened", flattened));
  if (withTags) parts.push(msg("importSummaryTags", withTags));
  return parts.join(" ");
}

// ---------- damaged data ----------

function bindBanner() {
  $("download-raw").addEventListener("click", () => {
    download(JSON.stringify(state.damaged?.raw ?? null, null, 2), "quicktext-lite-raw-data.json");
  });
  $("start-empty").addEventListener("click", async () => {
    if (!window.confirm(msg("confirmStartEmpty"))) return;
    state.damaged = null;
    $("banner").hidden = true;
    state.library = emptyLibrary();
    state.selectedId = null;
    structureChanged(null);
  });
}
