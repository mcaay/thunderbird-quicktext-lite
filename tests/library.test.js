import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyLibrary,
  validateLibrary,
  findItem,
  countTemplates,
  addTemplate,
  addGroup,
  appendItems,
  removeItem,
  renameItem,
  setTemplateHtml,
  canMove,
  moveItem,
  displayRows,
  filterRows,
  normalizeForSearch,
} from "../lib/library.js";

const t = (id, name = id, html = `<p>${id}</p>`) => ({ type: "template", id, name, html });
const g = (id, templates = [], name = id) => ({ type: "group", id, name, templates });
const lib = (...items) => ({ version: 1, items });
const shape = (library) =>
  library.items.map((item) => (item.type === "group" ? { [item.id]: item.templates.map((x) => x.id) } : item.id));

test("validateLibrary accepts a valid library and drops unknown fields", () => {
  const input = lib({ ...t("a"), extra: 1 }, g("g", [t("b")]));
  const result = validateLibrary(input);
  assert.equal(result.ok, true);
  assert.deepEqual(result.library, lib(t("a"), g("g", [t("b")])));
});

test("validateLibrary rejects broken data", () => {
  const cases = [
    null,
    [],
    { version: 2, items: [] },
    { version: 1, items: {} },
    lib({ type: "other", id: "x", name: "x" }),
    lib(t("a"), t("a")),
    lib(t("a", "  ")),
    lib({ type: "template", id: "a", name: "a" }),
    lib(g("g", [g("h")])),
    lib({ type: "group", id: "g", name: "g" }),
    lib({ type: "template", id: "", name: "a", html: "" }),
  ];
  for (const data of cases) assert.equal(validateLibrary(data).ok, false, JSON.stringify(data));
});

test("findItem reports the parent group and the index", () => {
  const library = lib(t("a"), g("g", [t("b"), t("c")]));
  assert.equal(findItem(library, "a").index, 0);
  assert.equal(findItem(library, "a").group, null);
  assert.equal(findItem(library, "c").group.id, "g");
  assert.equal(findItem(library, "c").index, 1);
  assert.equal(findItem(library, "zzz"), null);
  assert.equal(countTemplates(library), 3);
});

test("addTemplate follows the selection rules", () => {
  const base = lib(t("a"), g("g", [t("b"), t("c")]), t("d"));
  assert.deepEqual(shape(addTemplate(base, t("n"))), ["a", { g: ["b", "c"] }, "d", "n"]);
  assert.deepEqual(shape(addTemplate(base, t("n"), "g")), ["a", { g: ["b", "c", "n"] }, "d"]);
  assert.deepEqual(shape(addTemplate(base, t("n"), "a")), ["a", "n", { g: ["b", "c"] }, "d"]);
  assert.deepEqual(shape(addTemplate(base, t("n"), "b")), ["a", { g: ["b", "n", "c"] }, "d"]);
});

test("addGroup always goes to the top level", () => {
  const base = lib(t("a"), g("g", [t("b")]), t("d"));
  assert.deepEqual(shape(addGroup(base, g("n"))), ["a", { g: ["b"] }, "d", { n: [] }]);
  assert.deepEqual(shape(addGroup(base, g("n"), "a")), ["a", { n: [] }, { g: ["b"] }, "d"]);
  assert.deepEqual(shape(addGroup(base, g("n"), "b")), ["a", { g: ["b"] }, { n: [] }, "d"]);
  assert.deepEqual(shape(addGroup(base, g("n"), "g")), ["a", { g: ["b"] }, { n: [] }, "d"]);
});

test("removeItem, renameItem, setTemplateHtml and appendItems", () => {
  const base = lib(t("a"), g("g", [t("b")]));
  assert.deepEqual(shape(removeItem(base, "b")), ["a", { g: [] }]);
  assert.deepEqual(shape(removeItem(base, "g")), ["a"]);
  assert.equal(findItem(renameItem(base, "g", "New"), "g").item.name, "New");
  assert.equal(findItem(setTemplateHtml(base, "b", "<b>x</b>"), "b").item.html, "<b>x</b>");
  assert.equal(findItem(setTemplateHtml(base, "g", "x"), "g").item.html, undefined);
  assert.deepEqual(shape(appendItems(base, [t("z")])), ["a", { g: ["b"] }, "z"]);
});

test("operations never change their input", () => {
  const base = lib(t("a"), g("g", [t("b")]));
  const before = structuredClone(base);
  addTemplate(base, t("n"), "g");
  addGroup(base, g("n"));
  removeItem(base, "b");
  renameItem(base, "a", "x");
  setTemplateHtml(base, "a", "x");
  moveItem(base, "a", { refId: "g", position: "into" });
  assert.deepEqual(base, before);
});

test("moveItem places items before, after, into and at the end", () => {
  const base = lib(t("a"), g("g", [t("b"), t("c")]), t("d"), g("h"));
  assert.deepEqual(shape(moveItem(base, "a", { refId: "d", position: "after" })), [{ g: ["b", "c"] }, "d", "a", { h: [] }]);
  assert.deepEqual(shape(moveItem(base, "d", { refId: "a", position: "before" })), ["d", "a", { g: ["b", "c"] }, { h: [] }]);
  assert.deepEqual(shape(moveItem(base, "a", { refId: "h", position: "into" })), [{ g: ["b", "c"] }, "d", { h: ["a"] }]);
  assert.deepEqual(shape(moveItem(base, "c", { refId: "b", position: "before" })), ["a", { g: ["c", "b"] }, "d", { h: [] }]);
  assert.deepEqual(shape(moveItem(base, "b", { refId: "a", position: "after" })), ["a", "b", { g: ["c"] }, "d", { h: [] }]);
  assert.deepEqual(shape(moveItem(base, "b", { position: "end" })), ["a", { g: ["c"] }, "d", { h: [] }, "b"]);
  assert.deepEqual(shape(moveItem(base, "h", { refId: "a", position: "before" })), [{ h: [] }, "a", { g: ["b", "c"] }, "d"]);
  assert.deepEqual(shape(moveItem(base, "g", { refId: "d", position: "after" })), ["a", "d", { g: ["b", "c"] }, { h: [] }]);
});

test("moveItem refuses moves that break the one-level rule", () => {
  const base = lib(t("a"), g("g", [t("b")]), g("h"));
  const refused = [
    ["g", { refId: "h", position: "into" }],
    ["g", { refId: "b", position: "before" }],
    ["h", { refId: "b", position: "after" }],
    ["a", { refId: "a", position: "before" }],
    ["a", { refId: "b", position: "into" }],
    ["a", { refId: "missing", position: "before" }],
    ["missing", { position: "end" }],
    ["a", { refId: "g", position: "sideways" }],
  ];
  for (const [id, target] of refused) {
    assert.equal(canMove(base, id, target), false, `${id} ${JSON.stringify(target)}`);
    assert.equal(moveItem(base, id, target), base);
  }
});

test("displayRows numbers the first ten templates and hides empty groups", () => {
  const library = lib(
    t("t1"),
    g("g1", [t("t2"), t("t3")]),
    g("empty"),
    ...Array.from({ length: 9 }, (_, i) => t(`x${i}`)),
  );
  const rows = displayRows(library);
  assert.deepEqual(
    rows.map((row) => (row.kind === "group" ? `[${row.group.id}]` : `${row.template.id}:${row.number}`)),
    ["t1:1", "[g1]", "t2:2", "t3:3", "x0:4", "x1:5", "x2:6", "x3:7", "x4:8", "x5:9", "x6:0", "x7:null", "x8:null"],
  );
  assert.equal(rows.find((row) => row.kind === "template" && row.template.id === "t2").group.id, "g1");
});

test("filterRows matches names and group names without case or diacritics", () => {
  const library = lib(
    t("a", "Stopka Łódź"),
    g("g", [t("b", "Hotline PL"), t("c", "Hotline EN")], "Pomoc techniczna"),
    t("d", "Inne"),
  );
  const rows = displayRows(library);
  const ids = (query) =>
    filterRows(rows, query).map((row) => (row.kind === "group" ? `[${row.group.id}]` : `${row.template.id}:${row.number}`));
  assert.deepEqual(ids("lodz"), ["a:1"]);
  assert.deepEqual(ids("  HOTLINE en "), ["[g]", "c:3"]);
  assert.deepEqual(ids("pomoc"), ["[g]", "b:2", "c:3"]);
  assert.deepEqual(ids("nothing"), []);
  assert.equal(filterRows(rows, " "), rows);
  assert.equal(normalizeForSearch("ŻÓŁĆ"), "zolc");
});

test("emptyLibrary is valid", () => {
  assert.equal(validateLibrary(emptyLibrary()).ok, true);
});
