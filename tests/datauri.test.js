import { test } from "node:test";
import assert from "node:assert/strict";
import { findDataUris, decodedSize, formatSize, chipLabel } from "../lib/datauri.js";

test("findDataUris locates base64 data URIs with their type and size", () => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const text = `<img src="data:image/png;base64,${png}"><a href="x">y</a><img src='data:image/svg+xml;charset=utf-8;base64,PHN2Zz48L3N2Zz4='>`;
  const found = findDataUris(text);
  assert.equal(found.length, 2);
  assert.equal(text.slice(found[0].from, found[0].to), `data:image/png;base64,${png}`);
  assert.equal(found[0].mime, "image/png");
  assert.equal(found[0].bytes, 70);
  assert.equal(found[1].mime, "image/svg+xml");
  assert.equal(text.slice(found[1].from, found[1].to), "data:image/svg+xml;charset=utf-8;base64,PHN2Zz48L3N2Zz4=");
});

test("findDataUris ignores data URIs that are not base64", () => {
  assert.deepEqual(findDataUris(`<img src="data:image/svg+xml,%3Csvg%3E">`), []);
  assert.deepEqual(findDataUris("no images here"), []);
});

test("sizes and labels", () => {
  assert.equal(decodedSize("AAAA"), 3);
  assert.equal(decodedSize("AA=="), 1);
  assert.equal(decodedSize("AAA="), 2);
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(46080), "45 KB");
  assert.equal(formatSize(1572864), "1.5 MB");
  assert.equal(chipLabel("image/png", 46080), "[image PNG 45 KB]");
  assert.equal(chipLabel("image/svg+xml", 100, { image: "obrazek", data: "dane" }), "[obrazek SVG 100 B]");
  assert.equal(chipLabel("application/pdf", 2048), "[data PDF 2 KB]");
});
