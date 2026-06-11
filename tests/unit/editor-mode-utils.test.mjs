import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EDITOR_MODE,
  normalizeEditorMode,
  resolveEditorMode
} from "../../assets/utils/editor-mode-utils.js";

function query(value) {
  return {
    get(key) {
      return key === "editor" ? value : null;
    }
  };
}

test("normalizeEditorMode returns known modes and fallback for unknown", () => {
  assert.equal(normalizeEditorMode("cm6"), "cm6");
  assert.equal(normalizeEditorMode("legacy"), "legacy");
  assert.equal(normalizeEditorMode("invalid"), DEFAULT_EDITOR_MODE);
  assert.equal(normalizeEditorMode("invalid", "legacy"), "legacy");
});

test("resolveEditorMode uses query override when valid", () => {
  assert.equal(resolveEditorMode(query("legacy"), "cm6", DEFAULT_EDITOR_MODE), "legacy");
  assert.equal(resolveEditorMode(query("cm6"), "legacy", DEFAULT_EDITOR_MODE), "cm6");
});

test("resolveEditorMode falls back to stored/default when query invalid", () => {
  assert.equal(resolveEditorMode(query("broken"), "legacy", DEFAULT_EDITOR_MODE), "legacy");
  assert.equal(resolveEditorMode(null, "broken", "legacy"), "legacy");
});
