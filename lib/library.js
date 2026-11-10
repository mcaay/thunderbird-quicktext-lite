// Template library: pure data operations, no WebExtension APIs, so the
// tests run this module unchanged under Node.
//
// A library is { version, items }. Each item is either a template
// { type: "template", id, name, html } or a group
// { type: "group", id, name, templates: [template, ...] }.
// Groups hold templates only, so there is exactly one level of nesting.
//
// Every operation returns a new library and never changes its input.

export const LIBRARY_VERSION = 1;

export function emptyLibrary() {
  return { version: LIBRARY_VERSION, items: [] };
}

export function createTemplate(name, html = "") {
  return { type: "template", id: crypto.randomUUID(), name, html };
}

export function createGroup(name) {
  return { type: "group", id: crypto.randomUUID(), name, templates: [] };
}

// Checks data read from storage or a backup. Returns a clean copy without
// unknown fields, or the first problem found.
export function validateLibrary(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return invalid("not an object");
  if (data.version !== LIBRARY_VERSION) return invalid(`unsupported version ${data.version}`);
  if (!Array.isArray(data.items)) return invalid("items is not a list");
  const ids = new Set();
  const items = [];
  for (let i = 0; i < data.items.length; i++) {
    const raw = data.items[i];
    const where = `items[${i}]`;
    if (raw?.type === "template") {
      const template = checkTemplate(raw, where, ids);
      if (typeof template === "string") return invalid(template);
      items.push(template);
    } else if (raw?.type === "group") {
      const problem = checkBase(raw, where, ids);
      if (problem) return invalid(problem);
      if (!Array.isArray(raw.templates)) return invalid(`${where}: templates is not a list`);
      const templates = [];
      for (let j = 0; j < raw.templates.length; j++) {
        const childWhere = `${where}.templates[${j}]`;
        if (raw.templates[j]?.type !== "template") return invalid(`${childWhere}: not a template`);
        const template = checkTemplate(raw.templates[j], childWhere, ids);
        if (typeof template === "string") return invalid(template);
        templates.push(template);
      }
      items.push({ type: "group", id: raw.id, name: raw.name, templates });
    } else {
      return invalid(`${where}: unknown type`);
    }
  }
  return { ok: true, library: { version: LIBRARY_VERSION, items } };
}

function invalid(error) {
  return { ok: false, error };
}

function checkBase(raw, where, ids) {
  if (typeof raw.id !== "string" || !raw.id) return `${where}: missing id`;
  if (ids.has(raw.id)) return `${where}: duplicate id`;
  ids.add(raw.id);
  if (typeof raw.name !== "string" || !raw.name.trim()) return `${where}: missing name`;
  return null;
}

function checkTemplate(raw, where, ids) {
  const problem = checkBase(raw, where, ids);
  if (problem) return problem;
  if (typeof raw.html !== "string") return `${where}: html is not text`;
  return { type: "template", id: raw.id, name: raw.name, html: raw.html };
}

// Locates an item. `group` is the parent group of a grouped template (null
// otherwise) and `index` the position inside its container.
export function findItem(library, id) {
  for (let i = 0; i < library.items.length; i++) {
    const item = library.items[i];
    if (item.id === id) return { item, group: null, index: i };
    if (item.type === "group") {
      const j = item.templates.findIndex((template) => template.id === id);
      if (j !== -1) return { item: item.templates[j], group: item, index: j };
    }
  }
  return null;
}

export function findTemplate(library, id) {
  const found = findItem(library, id);
  return found?.item.type === "template" ? found.item : null;
}

export function countTemplates(library) {
  return library.items.reduce((sum, item) => sum + (item.type === "group" ? item.templates.length : 1), 0);
}

function copy(library) {
  return structuredClone(library);
}

function containerOf(library, found) {
  return found.group ? found.group.templates : library.items;
}

// A selected group receives the template at its end; a selected template
// gets it right after itself, in the same container; otherwise it goes to
// the end of the top level.
export function addTemplate(library, template, selectedId = null) {
  const lib = copy(library);
  const selected = selectedId ? findItem(lib, selectedId) : null;
  if (!selected) lib.items.push(template);
  else if (selected.item.type === "group") selected.item.templates.push(template);
  else containerOf(lib, selected).splice(selected.index + 1, 0, template);
  return lib;
}

// Groups always live at the top level: after the selected top-level item,
// after the group of a selected grouped template, or at the end.
export function addGroup(library, group, selectedId = null) {
  const lib = copy(library);
  const selected = selectedId ? findItem(lib, selectedId) : null;
  if (!selected) {
    lib.items.push(group);
  } else {
    const topIndex = selected.group ? lib.items.indexOf(selected.group) : selected.index;
    lib.items.splice(topIndex + 1, 0, group);
  }
  return lib;
}

export function appendItems(library, items) {
  const lib = copy(library);
  lib.items.push(...structuredClone(items));
  return lib;
}

export function removeItem(library, id) {
  const lib = copy(library);
  const found = findItem(lib, id);
  if (found) containerOf(lib, found).splice(found.index, 1);
  return lib;
}

export function renameItem(library, id, name) {
  const lib = copy(library);
  const found = findItem(lib, id);
  if (found) found.item.name = name;
  return lib;
}

export function setTemplateHtml(library, id, html) {
  const lib = copy(library);
  const found = findItem(lib, id);
  if (found?.item.type === "template") found.item.html = html;
  return lib;
}

// target is { position: "end" } (end of the top level) or
// { refId, position: "before" | "after" | "into" }; "into" moves a
// template to the end of the group refId.
export function canMove(library, id, target) {
  const source = findItem(library, id);
  if (!source || !target) return false;
  if (target.position === "end") return true;
  if (!target.refId || target.refId === id) return false;
  const ref = findItem(library, target.refId);
  if (!ref) return false;
  if (target.position === "into") return ref.item.type === "group" && source.item.type === "template";
  if (target.position !== "before" && target.position !== "after") return false;
  return !(source.item.type === "group" && ref.group);
}

// Returns the same library object when the move is not allowed.
export function moveItem(library, id, target) {
  if (!canMove(library, id, target)) return library;
  const lib = copy(library);
  const source = findItem(lib, id);
  containerOf(lib, source).splice(source.index, 1);
  if (target.position === "end") {
    lib.items.push(source.item);
    return lib;
  }
  const ref = findItem(lib, target.refId);
  if (target.position === "into") {
    ref.item.templates.push(source.item);
    return lib;
  }
  containerOf(lib, ref).splice(ref.index + (target.position === "after" ? 1 : 0), 0, source.item);
  return lib;
}

// Rows in display order for the panel. Empty groups are left out. The first
// ten templates get the shortcut numbers 1 to 9 and 0, the rest none.
export function displayRows(library) {
  const rows = [];
  let count = 0;
  const nextNumber = () => {
    const number = count < 9 ? count + 1 : count === 9 ? 0 : null;
    count++;
    return number;
  };
  for (const item of library.items) {
    if (item.type === "template") {
      rows.push({ kind: "template", template: item, group: null, number: nextNumber() });
    } else if (item.templates.length) {
      rows.push({ kind: "group", group: item });
      for (const template of item.templates) {
        rows.push({ kind: "template", template, group: item, number: nextNumber() });
      }
    }
  }
  return rows;
}

// Lower case without diacritics. "ł" has no decomposed form, so it is
// mapped by hand.
export function normalizeForSearch(text) {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l");
}

// Keeps templates whose own name or group name contains the query, plus the
// header of each group that still has a visible template. Numbers stay as
// they were.
export function filterRows(rows, query) {
  const needle = normalizeForSearch(query.trim());
  if (!needle) return rows;
  const result = [];
  let header = null;
  for (const row of rows) {
    if (row.kind === "group") {
      header = row;
      continue;
    }
    const hit =
      normalizeForSearch(row.template.name).includes(needle) ||
      (row.group !== null && normalizeForSearch(row.group.name).includes(needle));
    if (!hit) continue;
    if (row.group && header?.group === row.group) {
      result.push(header);
      header = null;
    }
    result.push(row);
  }
  return result;
}
