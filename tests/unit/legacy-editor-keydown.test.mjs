import test from "node:test";
import assert from "node:assert/strict";
import { handleLegacyEditorKeydown } from "../../assets/editor-legacy/legacy-editor-keydown.js";

function createAdapter(value = "", selection = { start: 0, end: 0 }) {
  let currentValue = value;
  let currentSelection = { ...selection };
  return {
    getValue() {
      return currentValue;
    },
    setValue(next) {
      currentValue = String(next);
    },
    getSelection() {
      return { ...currentSelection };
    },
    setSelection(next) {
      currentSelection = {
        start: Number(next?.start || 0),
        end: Number(next?.end || 0)
      };
    }
  };
}

test("legacy keydown returns not-handled result for unsupported key", () => {
  let prevented = false;
  const result = handleLegacyEditorKeydown({
    event: {
      key: "z",
      preventDefault() {
        prevented = true;
      }
    },
    adapter: createAdapter("print(1)\n")
  });

  assert.equal(result.handled, false);
  assert.equal(prevented, false);
});

test("legacy keydown handles Tab command and updates value", () => {
  let prevented = false;
  const adapter = createAdapter("print(1)\n", { start: 0, end: 0 });

  const result = handleLegacyEditorKeydown({
    event: {
      key: "Tab",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault() {
        prevented = true;
      }
    },
    adapter,
    tabSize: 2
  });

  assert.equal(result.handled, true);
  assert.equal(result.valueChanged, true);
  assert.equal(prevented, true);
  assert.equal(adapter.getValue(), "  print(1)\n");
});

test("legacy keydown passes result to onAfterCommand callback", () => {
  const adapter = createAdapter("line1\nline2", { start: 0, end: 0 });
  let callbackResult = null;

  const result = handleLegacyEditorKeydown({
    event: {
      key: "l",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault() { }
    },
    adapter,
    onAfterCommand(payload) {
      callbackResult = payload;
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.selectionChanged, true);
  assert.equal(callbackResult?.handled, true);
  assert.equal(callbackResult?.selectionChanged, true);
});

test("legacy keydown returns not-handled when adapter is missing", () => {
  const result = handleLegacyEditorKeydown({
    event: {
      key: "Tab",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault() { }
    },
    adapter: null
  });

  assert.equal(result.handled, false);
  assert.equal(result.valueChanged, false);
});
