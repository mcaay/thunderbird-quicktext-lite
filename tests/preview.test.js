import { test } from "node:test";
import assert from "node:assert/strict";
import { previewDocument } from "../lib/preview.js";

const policy = (doc) => /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(doc)[1];

test("the preview shows remote images, allows nothing else, and links cannot navigate it", () => {
  const doc = previewDocument("<p>Hi</p>");
  assert.equal(policy(doc), "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data:");
  assert.ok(doc.includes('<base target="_top">'));
  assert.ok(doc.endsWith("<body><p>Hi</p></body></html>"));
});
