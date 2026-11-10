import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { parseImport, ImportError, plainTextToHtml, flattenSingleTemplateGroups } from "../lib/import.js";
import { createBackup, backupFileName } from "../lib/backup.js";
import { validateLibrary } from "../lib/library.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const parseXml = (text) =>
  new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") throw new Error(message);
    },
  }).parseFromString(text, "text/xml");
const shape = (items) =>
  items.map((item) => (item.type === "group" ? { [item.name]: item.templates.map((t) => t.name) } : item.name));
const allIds = (items) => items.flatMap((item) => [item.id, ...(item.templates ?? []).map((t) => t.id)]);
const rejects = (fn, code) =>
  assert.throws(fn, (error) => error instanceof ImportError && error.code === code, `expected ${code}`);

test("Quicktext JSON export with flattening", () => {
  const { items, stats } = parseImport(fixture("quicktext-export.json"));
  assert.deepEqual(shape(items), ["Signature PL", { Support: ["Hotline", "Plain", "Greeting"] }, "Lone", { Empty: [] }]);
  assert.deepEqual(stats, { templates: 5, groups: 2, flattened: 2, withTags: 1 });
  const support = items[1];
  assert.equal(support.templates[0].html, "<p>Call us</p>");
  assert.equal(support.templates[1].html, "Line 1<br>Line &lt;2&gt; &amp; &quot;3&quot;");
  assert.deepEqual(Object.keys(support.templates[0]).sort(), ["html", "id", "name", "type"]);
  assert.equal(new Set(allIds(items)).size, allIds(items).length);
  assert.equal(validateLibrary({ version: 1, items }).ok, true);
});

test("Quicktext JSON export without flattening", () => {
  const { items, stats } = parseImport(fixture("quicktext-export.json"), { flatten: false });
  assert.deepEqual(shape(items), [
    { "Signature PL": ["Signature PL"] },
    { Support: ["Hotline", "Plain", "Greeting"] },
    { Lone: ["Lone"] },
    { Empty: [] },
  ]);
  assert.deepEqual(stats, { templates: 5, groups: 4, flattened: 0, withTags: 1 });
});

test("legacy Quicktext XML file", () => {
  const { items, stats } = parseImport(fixture("quicktext-templates.xml"), { parseXml });
  assert.deepEqual(shape(items), ["Signature PL", { Support: ["Hotline", "Plain"] }, { "No texts": [] }]);
  assert.deepEqual(stats, { templates: 3, groups: 2, flattened: 1, withTags: 0 });
  assert.equal(items[0].html, `<p style="font-family: 'Arial';"><b>Jan Kowalski</b><br>Manager</p>`);
  assert.equal(items[1].templates[1].html, "Line 1<br>Line &lt;2&gt; &amp; &quot;3&quot;");
  assert.equal(validateLibrary({ version: 1, items }).ok, true);
});

test("backup round trip keeps content and assigns new ids", () => {
  const library = {
    version: 1,
    items: [
      { type: "template", id: "a", name: "A", html: "<p>A</p>" },
      { type: "group", id: "g", name: "G", templates: [{ type: "template", id: "b", name: "B", html: "<p>B</p>" }] },
    ],
  };
  const { items, stats } = parseImport(createBackup(library));
  assert.deepEqual(shape(items), ["A", { G: ["B"] }]);
  assert.equal(items[1].templates[0].html, "<p>B</p>");
  assert.deepEqual(stats, { templates: 2, groups: 1, flattened: 0, withTags: 0 });
  for (const id of allIds(items)) assert.ok(!["a", "g", "b"].includes(id));
});

test("a backup comes back unflattened, also with a same-name single-template group", () => {
  const library = {
    version: 1,
    items: [{ type: "group", id: "g", name: "Signature", templates: [{ type: "template", id: "s", name: "Signature", html: "<p>S</p>" }] }],
  };
  const { items, stats } = parseImport(createBackup(library));
  assert.deepEqual(shape(items), [{ Signature: ["Signature"] }]);
  assert.equal(stats.flattened, 0);
});

test("Quicktext template lists without a group are rejected, empty ones ignored", () => {
  const text = { name: "Lost", text: "<p>Content</p>" };
  rejects(() => parseImport(JSON.stringify({ templates: { groups: [], texts: [[text]] } })), "invalid");
  rejects(() => parseImport(JSON.stringify({ templates: { groups: [{ name: "G" }], texts: [[], [text]] } })), "invalid");
  const { items } = parseImport(JSON.stringify({ templates: { groups: [{ name: "G" }], texts: [[text], [], null] } }));
  assert.deepEqual(shape(items), [{ G: ["Lost"] }]);
});

test("unknown and broken files are rejected", () => {
  rejects(() => parseImport("not json at all"), "unknown-format");
  rejects(() => parseImport(JSON.stringify({ hello: 1 })), "unknown-format");
  rejects(() => parseImport("<html><body></body></html>", { parseXml }), "unknown-format");
  rejects(() => parseImport(`<?xml version="1.0"?><quicktext version="2"><filetype>scripts</filetype></quicktext>`, { parseXml }), "unknown-format");
  rejects(() => parseImport("<quicktext version=\"2\">", { parseXml }), "invalid");
  rejects(() => parseImport(`<quicktext version="1"></quicktext>`, { parseXml }), "invalid");
  rejects(() => parseImport("<quicktext/>"), "unknown-format");
  rejects(() => parseImport(JSON.stringify({ format: "quicktext-lite", version: 1, items: [{ type: "x" }] })), "invalid");
  rejects(() => parseImport(JSON.stringify({ templates: { groups: ["bad"], texts: [] } })), "invalid");
  rejects(() => parseImport(JSON.stringify({ templates: { groups: [{ name: "G" }], texts: [[1]] } })), "invalid");
  rejects(() => parseImport(JSON.stringify({ templates: { groups: [{ name: "G" }], texts: [{}] } })), "invalid");
});

test("byte order mark, empty names and missing fields", () => {
  const text = "﻿" + JSON.stringify({ templates: { groups: [{ name: "" }, {}], texts: [[{ name: " ", text: 5 }]] } });
  const { items } = parseImport(text, { untitled: "Untitled" });
  // The first group and its template are both "Untitled", so flattening applies.
  assert.deepEqual(shape(items), ["Untitled", { Untitled: [] }]);
  assert.equal(items[0].html, "");
});

test("helpers", () => {
  assert.equal(plainTextToHtml("a\r\nb\rc\nd"), "a<br>b<br>c<br>d");
  const { items, flattened } = flattenSingleTemplateGroups([
    { type: "group", id: "1", name: "X", templates: [{ type: "template", id: "2", name: "Y", html: "" }] },
  ]);
  assert.equal(flattened, 0);
  assert.equal(items[0].type, "group");
  assert.equal(backupFileName(new Date(2026, 0, 5)), "quicktext-lite-backup-2026-01-05.json");
});
