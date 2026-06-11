import { runEditorCommand } from "../editor-core/editor-command-runner.js";
import { resolveEditorShortcut } from "../editor-core/editor-shortcuts.js";

function notHandledResult() {
  return {
    handled: false,
    changed: false,
    valueChanged: false,
    selectionChanged: false,
    value: "",
    selection: { start: 0, end: 0 }
  };
}

export function handleLegacyEditorKeydown({
  event,
  adapter,
  tabSize = 4,
  onAfterCommand
} = {}) {
  const command = resolveEditorShortcut(event);
  if (!command) {
    return notHandledResult();
  }

  const result = runEditorCommand({
    adapter,
    command,
    tabSize
  });

  if (!result.handled) {
    return result;
  }

  if (event && typeof event.preventDefault === "function") {
    event.preventDefault();
  }

  if (typeof onAfterCommand === "function") {
    onAfterCommand(result);
  }

  return result;
}
