import test from "node:test";
import assert from "node:assert/strict";
import { resolveEditorShortcut } from "../../assets/editor-core/editor-shortcuts.js";
import { EDITOR_COMMANDS } from "../../assets/editor-core/editor-command-transforms.js";

function event(overrides = {}) {
  return {
    key: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides
  };
}

test("maps tab and enter shortcuts", () => {
  assert.equal(resolveEditorShortcut(event({ key: "Tab" })), EDITOR_COMMANDS.TAB);
  assert.equal(resolveEditorShortcut(event({ key: "Enter" })), EDITOR_COMMANDS.ENTER);
  assert.equal(resolveEditorShortcut(event({ key: "Enter", shiftKey: true })), null);
});

test("maps alt shortcuts", () => {
  assert.equal(resolveEditorShortcut(event({ key: "/", altKey: true })), EDITOR_COMMANDS.TOGGLE_COMMENT);
  assert.equal(resolveEditorShortcut(event({ key: "ArrowUp", altKey: true })), EDITOR_COMMANDS.MOVE_LINE_UP);
  assert.equal(resolveEditorShortcut(event({ key: "ArrowDown", altKey: true })), EDITOR_COMMANDS.MOVE_LINE_DOWN);
});

test("maps ControlOrMeta shortcuts", () => {
  assert.equal(resolveEditorShortcut(event({ key: "d", ctrlKey: true })), EDITOR_COMMANDS.DUPLICATE_LINE);
  assert.equal(resolveEditorShortcut(event({ key: "D", metaKey: true })), EDITOR_COMMANDS.DUPLICATE_LINE);
  assert.equal(resolveEditorShortcut(event({ key: "K", ctrlKey: true, shiftKey: true })), EDITOR_COMMANDS.DELETE_LINE);
  assert.equal(resolveEditorShortcut(event({ key: "l", ctrlKey: true })), EDITOR_COMMANDS.SELECT_LINE);
});

test("ignores unsupported combinations", () => {
  assert.equal(resolveEditorShortcut(event({ key: "x" })), null);
  assert.equal(resolveEditorShortcut(event({ key: "/", altKey: true, ctrlKey: true })), null);
});
