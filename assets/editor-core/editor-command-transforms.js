export const EDITOR_COMMANDS = Object.freeze({
  TAB: "tab",
  ENTER: "enter",
  TOGGLE_COMMENT: "toggle-comment",
  MOVE_LINE_UP: "move-line-up",
  MOVE_LINE_DOWN: "move-line-down",
  DUPLICATE_LINE: "duplicate-line",
  DELETE_LINE: "delete-line",
  SELECT_LINE: "select-line"
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSelection(selection, maxLength) {
  const start = clamp(Number(selection?.start) || 0, 0, maxLength);
  const end = clamp(Number(selection?.end) || 0, 0, maxLength);
  return start <= end ? { start, end } : { start: end, end: start };
}

function getLineStartOffset(lines, lineIndex) {
  let offset = 0;
  for (let i = 0; i < lineIndex; i += 1) {
    offset += lines[i].length + 1;
  }
  return offset;
}

function getLineInfo(value, offset) {
  const lines = value.split("\n");
  let cursor = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const start = cursor;
    const end = start + lines[i].length;
    const nextCursor = end + 1;
    if (offset <= end || i === lines.length - 1) {
      return {
        lines,
        lineIndex: i,
        lineStart: start,
        lineEnd: end,
        column: offset - start
      };
    }
    cursor = nextCursor;
  }
  return {
    lines,
    lineIndex: 0,
    lineStart: 0,
    lineEnd: lines[0].length,
    column: 0
  };
}

function applyTab(state, options) {
  const tabSize = Number(options?.tabSize) > 0 ? Number(options.tabSize) : 4;
  const spaces = " ".repeat(tabSize);
  const value = state.value;
  const selection = state.selection;
  const nextValue = value.slice(0, selection.start) + spaces + value.slice(selection.end);
  const cursor = selection.start + spaces.length;
  return {
    handled: true,
    changed: true,
    valueChanged: nextValue !== value,
    selectionChanged: true,
    value: nextValue,
    selection: { start: cursor, end: cursor }
  };
}

function applyEnter(state, options) {
  const tabSize = Number(options?.tabSize) > 0 ? Number(options.tabSize) : 4;
  const spaces = " ".repeat(tabSize);
  const value = state.value;
  const selection = state.selection;
  const start = selection.start;
  const before = value.slice(0, start);
  const lineStart = before.lastIndexOf("\n") + 1;
  const line = value.slice(lineStart, start);
  const indentMatch = line.match(/^[ \t]*/);
  const baseIndent = indentMatch ? indentMatch[0] : "";
  const trimmed = line.trimEnd();
  const shouldIndent = trimmed.endsWith(":") || baseIndent.length > 0;
  if (!shouldIndent) {
    return {
      handled: false,
      changed: false,
      valueChanged: false,
      selectionChanged: false,
      value,
      selection
    };
  }
  const extraIndent = trimmed.endsWith(":") ? spaces : "";
  const insert = `\n${baseIndent}${extraIndent}`;
  const nextValue = value.slice(0, selection.start) + insert + value.slice(selection.end);
  const cursor = selection.start + insert.length;
  return {
    handled: true,
    changed: true,
    valueChanged: nextValue !== value,
    selectionChanged: true,
    value: nextValue,
    selection: { start: cursor, end: cursor }
  };
}

function applyToggleComment(state) {
  const value = state.value;
  const selection = state.selection;
  const info = getLineInfo(value, selection.start);
  const lines = info.lines.slice();
  const line = lines[info.lineIndex];
  const trimmed = line.trim();

  if (trimmed.startsWith("#")) {
    lines[info.lineIndex] = line.replace(/^(\s*)#\s?/, "$1");
  } else if (trimmed) {
    lines[info.lineIndex] = line.replace(/^(\s*)/, "$1# ");
  } else {
    return {
      handled: true,
      changed: false,
      valueChanged: false,
      selectionChanged: false,
      value,
      selection
    };
  }

  const nextValue = lines.join("\n");
  return {
    handled: true,
    changed: nextValue !== value,
    valueChanged: nextValue !== value,
    selectionChanged: false,
    value: nextValue,
    selection
  };
}

function applyMoveLineUp(state) {
  const value = state.value;
  const selection = state.selection;
  const info = getLineInfo(value, selection.start);
  const lines = info.lines.slice();
  if (info.lineIndex === 0) {
    return {
      handled: true,
      changed: false,
      valueChanged: false,
      selectionChanged: false,
      value,
      selection
    };
  }

  const currentLine = lines[info.lineIndex];
  const prevLine = lines[info.lineIndex - 1];
  lines[info.lineIndex - 1] = currentLine;
  lines[info.lineIndex] = prevLine;

  const nextValue = lines.join("\n");
  const newLineStart = getLineStartOffset(lines, info.lineIndex - 1);
  const newCursor = newLineStart + Math.min(info.column, currentLine.length);

  return {
    handled: true,
    changed: true,
    valueChanged: true,
    selectionChanged: true,
    value: nextValue,
    selection: { start: newCursor, end: newCursor }
  };
}

function applyMoveLineDown(state) {
  const value = state.value;
  const selection = state.selection;
  const info = getLineInfo(value, selection.start);
  const lines = info.lines.slice();
  if (info.lineIndex >= lines.length - 1) {
    return {
      handled: true,
      changed: false,
      valueChanged: false,
      selectionChanged: false,
      value,
      selection
    };
  }

  const currentLine = lines[info.lineIndex];
  const nextLine = lines[info.lineIndex + 1];
  lines[info.lineIndex] = nextLine;
  lines[info.lineIndex + 1] = currentLine;

  const nextValue = lines.join("\n");
  const newLineStart = getLineStartOffset(lines, info.lineIndex + 1);
  const newCursor = newLineStart + Math.min(info.column, currentLine.length);

  return {
    handled: true,
    changed: true,
    valueChanged: true,
    selectionChanged: true,
    value: nextValue,
    selection: { start: newCursor, end: newCursor }
  };
}

function applyDuplicateLine(state) {
  const value = state.value;
  const selection = state.selection;
  const info = getLineInfo(value, selection.start);
  const lines = info.lines.slice();
  const currentLine = lines[info.lineIndex];
  lines.splice(info.lineIndex + 1, 0, currentLine);
  const nextValue = lines.join("\n");
  const newLineStart = getLineStartOffset(lines, info.lineIndex + 1);
  const newCursor = newLineStart + Math.min(info.column, currentLine.length);

  return {
    handled: true,
    changed: true,
    valueChanged: true,
    selectionChanged: true,
    value: nextValue,
    selection: { start: newCursor, end: newCursor }
  };
}

function applyDeleteLine(state) {
  const value = state.value;
  const selection = state.selection;
  const info = getLineInfo(value, selection.start);
  const lines = info.lines.slice();
  lines.splice(info.lineIndex, 1);
  if (!lines.length) {
    lines.push("");
  }
  const nextValue = lines.join("\n");
  const newLineIndex = Math.min(info.lineIndex, lines.length - 1);
  const newLineStart = getLineStartOffset(lines, newLineIndex);
  const newLineLength = lines[newLineIndex].length;
  const newCursor = newLineStart + Math.min(info.column, newLineLength);

  return {
    handled: true,
    changed: nextValue !== value,
    valueChanged: nextValue !== value,
    selectionChanged: true,
    value: nextValue,
    selection: { start: newCursor, end: newCursor }
  };
}

function applySelectLine(state) {
  const value = state.value;
  const selection = state.selection;
  const info = getLineInfo(value, selection.start);
  return {
    handled: true,
    changed: true,
    valueChanged: false,
    selectionChanged: selection.start !== info.lineStart || selection.end !== info.lineEnd,
    value,
    selection: { start: info.lineStart, end: info.lineEnd }
  };
}

export function applyEditorCommand(command, editorState, options = {}) {
  const value = String(editorState?.value || "");
  const selection = normalizeSelection(editorState?.selection, value.length);
  const state = { value, selection };

  switch (command) {
    case EDITOR_COMMANDS.TAB:
      return applyTab(state, options);
    case EDITOR_COMMANDS.ENTER:
      return applyEnter(state, options);
    case EDITOR_COMMANDS.TOGGLE_COMMENT:
      return applyToggleComment(state);
    case EDITOR_COMMANDS.MOVE_LINE_UP:
      return applyMoveLineUp(state);
    case EDITOR_COMMANDS.MOVE_LINE_DOWN:
      return applyMoveLineDown(state);
    case EDITOR_COMMANDS.DUPLICATE_LINE:
      return applyDuplicateLine(state);
    case EDITOR_COMMANDS.DELETE_LINE:
      return applyDeleteLine(state);
    case EDITOR_COMMANDS.SELECT_LINE:
      return applySelectLine(state);
    default:
      return {
        handled: false,
        changed: false,
        valueChanged: false,
        selectionChanged: false,
        value,
        selection
      };
  }
}
