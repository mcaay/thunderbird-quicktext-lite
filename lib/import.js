// Turns an import file into library items. Supported: Quicktext Lite
// backups, Quicktext 6 JSON exports and legacy Quicktext XML files.
// Pure module; the caller passes in the XML parser (DOMParser in
// Thunderbird, @xmldom/xmldom in tests).

import { validateLibrary } from "./library.js";
import { BACKUP_FORMAT } from "./backup.js";

export class ImportError extends Error {
  // code is "unknown-format" or "invalid"
  constructor(code, detail = "") {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ImportError";
    this.code = code;
    this.detail = detail;
  }
}

const QUICKTEXT_TAG = /\[\[[^[\]]+\]\]/;

// Parses and checks the whole file before returning anything, so a broken
// file never leads to a partial import.
export function parseImport(text, { parseXml, flatten = true, untitled = "Untitled" } = {}) {
  const source = String(text).replace(/^﻿/, "").trim();
  let { items, quicktext } = source.startsWith("<")
    ? { items: fromQuicktextXml(source, parseXml, untitled), quicktext: true }
    : fromJson(source, untitled);
  let flattened = 0;
  // Flattening undoes a Quicktext workaround; a backup comes back as it was.
  if (flatten && quicktext) ({ items, flattened } = flattenSingleTemplateGroups(items));
  const templates = items.flatMap((item) => (item.type === "group" ? item.templates : [item]));
  return {
    items,
    stats: {
      templates: templates.length,
      groups: items.filter((item) => item.type === "group").length,
      flattened,
      withTags: templates.filter((template) => QUICKTEXT_TAG.test(template.html)).length,
    },
  };
}

// A group holding exactly one template with the same name is how Quicktext
// users fake a template without a group; such groups become templates.
export function flattenSingleTemplateGroups(items) {
  let flattened = 0;
  const result = items.map((item) => {
    if (item.type === "group" && item.templates.length === 1 && item.templates[0].name.trim() === item.name.trim()) {
      flattened++;
      return item.templates[0];
    }
    return item;
  });
  return { items: result, flattened };
}

export function plainTextToHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r\n?|\n/g, "<br>");
}

function fromJson(source, untitled) {
  let data;
  try {
    data = JSON.parse(source);
  } catch {
    throw new ImportError("unknown-format");
  }
  if (data?.format === BACKUP_FORMAT) return { items: fromBackup(data), quicktext: false };
  if (Array.isArray(data?.templates?.groups) && Array.isArray(data?.templates?.texts)) {
    return { items: fromQuicktextJson(data.templates, untitled), quicktext: true };
  }
  throw new ImportError("unknown-format");
}

// Imported items get new ids, so importing a backup into the library it came
// from cannot produce duplicates.
function fromBackup(data) {
  const result = validateLibrary({ version: data.version, items: data.items });
  if (!result.ok) throw new ImportError("invalid", result.error);
  return result.library.items.map((item) =>
    item.type === "group"
      ? { ...item, id: crypto.randomUUID(), templates: item.templates.map((t) => ({ ...t, id: crypto.randomUUID() })) }
      : { ...item, id: crypto.randomUUID() },
  );
}

function fromQuicktextJson({ groups, texts }, untitled) {
  // A missing list means an empty group, but templates past the last group
  // have nowhere to go and would be dropped without a word.
  if (texts.slice(groups.length).some((list) => list?.length)) {
    throw new ImportError("invalid", "templates without a group");
  }
  return groups.map((group, gi) => {
    if (!isObject(group)) throw new ImportError("invalid", `group ${gi + 1} is not an object`);
    const list = texts[gi] ?? [];
    if (!Array.isArray(list)) throw new ImportError("invalid", `the templates of group ${gi + 1} are not a list`);
    const templates = list.map((text, ti) => {
      if (!isObject(text)) throw new ImportError("invalid", `template ${ti + 1} of group ${gi + 1} is not an object`);
      return makeTemplate(text.name, text.text, text.type === "text/plain", untitled);
    });
    return makeGroup(group.name, templates, untitled);
  });
}

function fromQuicktextXml(source, parseXml, untitled) {
  if (typeof parseXml !== "function") throw new ImportError("unknown-format");
  let doc;
  try {
    doc = parseXml(source);
  } catch (error) {
    throw new ImportError("invalid", error?.message || "malformed XML");
  }
  const root = doc?.documentElement;
  if (!root || doc.getElementsByTagName("parsererror").length) throw new ImportError("invalid", "malformed XML");
  if (root.nodeName !== "quicktext") throw new ImportError("unknown-format");
  const version = root.getAttribute("version");
  if (version !== "2") throw new ImportError("invalid", `unsupported Quicktext file version ${version}`);
  const filetype = childText(root, "filetype").trim();
  if (filetype !== "" && filetype !== "templates") throw new ImportError("unknown-format");
  return childElements(root, "menu").map((menu) => {
    const texts = childElements(menu, "texts")[0];
    const templates = texts
      ? childElements(texts, "text").map((node) =>
          makeTemplate(childText(node, "name"), childText(node, "body"), node.getAttribute("type") === "0", untitled),
        )
      : [];
    return makeGroup(childText(menu, "title"), templates, untitled);
  });
}

function childElements(node, name) {
  const result = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType === 1 && child.nodeName === name) result.push(child);
  }
  return result;
}

function childText(node, name) {
  return childElements(node, name)[0]?.textContent ?? "";
}

function makeTemplate(name, body, isPlainText, untitled) {
  const text = typeof body === "string" ? body : "";
  return {
    type: "template",
    id: crypto.randomUUID(),
    name: cleanName(name, untitled),
    html: isPlainText ? plainTextToHtml(text) : text,
  };
}

function makeGroup(name, templates, untitled) {
  return { type: "group", id: crypto.randomUUID(), name: cleanName(name, untitled), templates };
}

function cleanName(name, untitled) {
  const value = typeof name === "string" ? name.trim() : "";
  return value || untitled;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
