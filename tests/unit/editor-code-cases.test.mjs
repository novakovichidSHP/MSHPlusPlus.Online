import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validCases, invalidCases } = require("../fixtures/editor-code-cases.cjs");

test("editor code matrix has at least 15 valid and 15 invalid cases", () => {
  assert.ok(Array.isArray(validCases));
  assert.ok(Array.isArray(invalidCases));
  assert.ok(validCases.length >= 15);
  assert.ok(invalidCases.length >= 15);
});

test("editor code matrix ids are unique", () => {
  const all = [...validCases, ...invalidCases];
  const ids = all.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("editor code matrix entries have required fields", () => {
  for (const entry of validCases) {
    assert.equal(typeof entry.id, "string");
    assert.equal(typeof entry.code, "string");
    assert.ok(entry.code.length > 0);
  }
  for (const entry of invalidCases) {
    assert.equal(typeof entry.id, "string");
    assert.equal(typeof entry.code, "string");
    assert.equal(typeof entry.errorPattern, "string");
    assert.ok(entry.code.length > 0);
    assert.ok(entry.errorPattern.length > 0);
  }
});
