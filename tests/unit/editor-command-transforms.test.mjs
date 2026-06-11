import test from "node:test";
import assert from "node:assert/strict";
import { applyEditorCommand, EDITOR_COMMANDS } from "../../assets/editor-core/editor-command-transforms.js";

function apply(command, value, selection, options) {
  return applyEditorCommand(command, { value, selection }, options);
}

test("tab inserts spaces and moves cursor", () => {
  const result = apply(EDITOR_COMMANDS.TAB, "print(1)", { start: 0, end: 0 }, { tabSize: 4 });
  assert.equal(result.handled, true);
  assert.equal(result.value, "    print(1)");
  assert.deepEqual(result.selection, { start: 4, end: 4 });
});

test("enter applies indentation after colon", () => {
  const source = "if True:";
  const result = apply(EDITOR_COMMANDS.ENTER, source, { start: source.length, end: source.length }, { tabSize: 2 });
  assert.equal(result.handled, true);
  assert.equal(result.value, "if True:\n  ");
  assert.deepEqual(result.selection, { start: 11, end: 11 });
});

test("enter falls back when indentation is not needed", () => {
  const source = "print(1)";
  const result = apply(EDITOR_COMMANDS.ENTER, source, { start: source.length, end: source.length }, { tabSize: 4 });
  assert.equal(result.handled, false);
  assert.equal(result.value, source);
});

test("toggle comment comments and uncomments current line", () => {
  const first = apply(EDITOR_COMMANDS.TOGGLE_COMMENT, "x = 1", { start: 0, end: 0 });
  assert.equal(first.value, "# x = 1");
  const second = apply(EDITOR_COMMANDS.TOGGLE_COMMENT, first.value, { start: 0, end: 0 });
  assert.equal(second.value, "x = 1");
});

test("move line up swaps lines and keeps cursor column", () => {
  const source = "a\nlong_line\nccc";
  const cursor = source.indexOf("long_line") + 4;
  const result = apply(EDITOR_COMMANDS.MOVE_LINE_UP, source, { start: cursor, end: cursor });
  assert.equal(result.value, "long_line\na\nccc");
  assert.equal(result.selection.start, 4);
});

test("move line down at bottom is handled without changes", () => {
  const source = "a\nb";
  const cursor = source.length;
  const result = apply(EDITOR_COMMANDS.MOVE_LINE_DOWN, source, { start: cursor, end: cursor });
  assert.equal(result.handled, true);
  assert.equal(result.changed, false);
  assert.equal(result.value, source);
});

test("duplicate line inserts copy below", () => {
  const source = "first\nsecond";
  const result = apply(EDITOR_COMMANDS.DUPLICATE_LINE, source, { start: 1, end: 1 });
  assert.equal(result.value, "first\nfirst\nsecond");
});

test("delete line removes current line and keeps valid cursor", () => {
  const source = "line1\nline2\nline3";
  const start = source.indexOf("line2") + 2;
  const result = apply(EDITOR_COMMANDS.DELETE_LINE, source, { start, end: start });
  assert.equal(result.value, "line1\nline3");
  assert.ok(result.selection.start <= result.value.length);
});

test("select line selects full line boundaries", () => {
  const source = "alpha\nbeta\ngamma";
  const start = source.indexOf("beta") + 2;
  const result = apply(EDITOR_COMMANDS.SELECT_LINE, source, { start, end: start });
  assert.deepEqual(result.selection, {
    start: source.indexOf("beta"),
    end: source.indexOf("beta") + "beta".length
  });
});
