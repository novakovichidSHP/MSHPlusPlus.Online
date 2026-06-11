import { EDITOR_COMMANDS } from "./editor-command-transforms.js";

function isPrimaryModifier(event) {
  return Boolean(event?.ctrlKey || event?.metaKey);
}

function normalizeKey(event) {
  return String(event?.key || "").toLowerCase();
}

export function resolveEditorShortcut(event) {
  if (!event) {
    return null;
  }

  const key = normalizeKey(event);
  const primary = isPrimaryModifier(event);

  if (key === "tab" && !primary && !event.altKey) {
    return EDITOR_COMMANDS.TAB;
  }

  if (key === "enter" && !primary && !event.altKey && !event.shiftKey) {
    return EDITOR_COMMANDS.ENTER;
  }

  if (event.altKey && !primary && key === "/") {
    return EDITOR_COMMANDS.TOGGLE_COMMENT;
  }

  if (event.altKey && !primary && key === "arrowup") {
    return EDITOR_COMMANDS.MOVE_LINE_UP;
  }

  if (event.altKey && !primary && key === "arrowdown") {
    return EDITOR_COMMANDS.MOVE_LINE_DOWN;
  }

  if (primary && !event.altKey && !event.shiftKey && key === "d") {
    return EDITOR_COMMANDS.DUPLICATE_LINE;
  }

  if (primary && !event.altKey && event.shiftKey && key === "k") {
    return EDITOR_COMMANDS.DELETE_LINE;
  }

  if (primary && !event.altKey && !event.shiftKey && key === "l") {
    return EDITOR_COMMANDS.SELECT_LINE;
  }

  return null;
}
