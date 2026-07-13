import { EDITOR_COMMANDS } from "./editor-command-transforms.js";

function isPrimaryModifier(event) {
  return Boolean(event?.ctrlKey || event?.metaKey);
}

function normalizeKey(event) {
  return String(event?.key || "").toLowerCase();
}

function normalizeCode(event) {
  return String(event?.code || "").toLowerCase();
}

function matchesPhysicalOrLogicalKey(event, code, key) {
  const normalizedCode = normalizeCode(event);
  if (normalizedCode && normalizedCode !== "unidentified") {
    return normalizedCode === code.toLowerCase();
  }
  return normalizeKey(event) === key.toLowerCase();
}

export function resolveEditorShortcut(event) {
  if (!event) {
    return null;
  }

  const primary = isPrimaryModifier(event);

  if (matchesPhysicalOrLogicalKey(event, "Tab", "Tab") && !primary && !event.altKey) {
    return EDITOR_COMMANDS.TAB;
  }

  if (matchesPhysicalOrLogicalKey(event, "Enter", "Enter") && !primary && !event.altKey && !event.shiftKey) {
    return EDITOR_COMMANDS.ENTER;
  }

  if (event.altKey && !primary && matchesPhysicalOrLogicalKey(event, "Slash", "/")) {
    return EDITOR_COMMANDS.TOGGLE_COMMENT;
  }

  if (event.altKey && !primary && matchesPhysicalOrLogicalKey(event, "ArrowUp", "ArrowUp")) {
    return EDITOR_COMMANDS.MOVE_LINE_UP;
  }

  if (event.altKey && !primary && matchesPhysicalOrLogicalKey(event, "ArrowDown", "ArrowDown")) {
    return EDITOR_COMMANDS.MOVE_LINE_DOWN;
  }

  if (primary && !event.altKey && !event.shiftKey && matchesPhysicalOrLogicalKey(event, "KeyD", "d")) {
    return EDITOR_COMMANDS.DUPLICATE_LINE;
  }

  if (primary && !event.altKey && event.shiftKey && matchesPhysicalOrLogicalKey(event, "KeyK", "k")) {
    return EDITOR_COMMANDS.DELETE_LINE;
  }

  if (primary && !event.altKey && !event.shiftKey && matchesPhysicalOrLogicalKey(event, "KeyL", "l")) {
    return EDITOR_COMMANDS.SELECT_LINE;
  }

  return null;
}
