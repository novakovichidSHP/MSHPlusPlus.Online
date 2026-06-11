import { applyEditorCommand } from "./editor-command-transforms.js";

function getAdapterState(adapter) {
  if (!adapter) {
    return {
      value: "",
      selection: { start: 0, end: 0 }
    };
  }
  return {
    value: String(adapter.getValue?.() || ""),
    selection: adapter.getSelection?.() || { start: 0, end: 0 }
  };
}

export function runEditorCommand({ adapter, command, tabSize = 4 } = {}) {
  if (!adapter || !command) {
    return {
      handled: false,
      changed: false,
      valueChanged: false,
      selectionChanged: false,
      value: "",
      selection: { start: 0, end: 0 }
    };
  }

  const state = getAdapterState(adapter);
  const result = applyEditorCommand(command, state, { tabSize });
  if (!result.handled) {
    return result;
  }

  if (result.valueChanged) {
    adapter.setValue(result.value);
  }
  if (result.selectionChanged || result.valueChanged) {
    adapter.setSelection(result.selection);
  }

  return result;
}
