import { createLegacyEditorDecorations } from "./legacy-editor-decorations.js";
import { handleLegacyEditorKeydown } from "./legacy-editor-keydown.js";

function noop() { }

function fireSynthetic(target, type) {
  if (!target) {
    return;
  }
  target.dispatchEvent(new Event(type, { bubbles: true }));
}

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

export function createLegacyEditorAdapter({
  editor,
  editorStack,
  editorWrap,
  editorHighlight,
  lineNumbers
}) {
  const changeHandlers = new Set();
  const scrollHandlers = new Set();
  const selectionHandlers = new Set();
  let detachInput = noop;
  let detachScroll = noop;
  let detachSelect = noop;
  let decorations = null;

  const emit = (handlers, payload) => {
    handlers.forEach((handler) => {
      try {
        handler(payload);
      } catch (error) {
        console.error(error);
      }
    });
  };

  const onInput = () => emit(changeHandlers, { source: "legacy" });
  const onScroll = () => emit(scrollHandlers, getScroll());
  const onSelect = () => emit(selectionHandlers, getSelection());

  const addDomListener = (target, event, handler, options) => {
    if (!target) {
      return noop;
    }
    target.addEventListener(event, handler, options);
    return () => target.removeEventListener(event, handler, options);
  };

  const setLegacyVisibility = (active) => {
    if (editor) {
      editor.classList.toggle("cm6-source-hidden", !active);
      editor.removeAttribute("aria-hidden");
      editor.tabIndex = active ? 0 : -1;
    }
    if (editorWrap) {
      editorWrap.classList.remove("cm6-mode");
    }
    if (editorStack) {
      editorStack.classList.toggle("cm6-active", false);
    }
    if (editorHighlight) {
      editorHighlight.classList.toggle("hidden", false);
    }
    if (lineNumbers) {
      lineNumbers.classList.toggle("hidden", false);
    }
  };

  const getValue = () => (editor ? editor.value : "");

  const setValue = (text) => {
    if (!editor) {
      return;
    }
    const next = String(text || "");
    if (editor.value !== next) {
      editor.value = next;
    }
  };

  const getSelection = () => {
    if (!editor) {
      return { start: 0, end: 0 };
    }
    return {
      start: Number(editor.selectionStart || 0),
      end: Number(editor.selectionEnd || 0)
    };
  };

  const setSelection = ({ start = 0, end = start } = {}) => {
    if (!editor) {
      return;
    }
    const max = editor.value.length;
    const from = Math.max(0, Math.min(max, Number(start) || 0));
    const to = Math.max(from, Math.min(max, Number(end) || from));
    editor.selectionStart = from;
    editor.selectionEnd = to;
  };

  const getScroll = () => ({
    top: editor ? editor.scrollTop : 0,
    left: editor ? editor.scrollLeft : 0
  });

  const setScroll = ({ top = 0, left = 0 } = {}) => {
    if (!editor) {
      return;
    }
    editor.scrollTop = Number(top) || 0;
    editor.scrollLeft = Number(left) || 0;
  };

  const ensureDecorations = () => {
    if (decorations) {
      return decorations;
    }
    decorations = createLegacyEditorDecorations({
      editor,
      editorHighlight,
      lineNumbers,
      getEditorValue: getValue
    });
    return decorations;
  };

  const adapter = {
    kind: "legacy",
    init({ initialValue = "", readOnly = false, settings = {} } = {}) {
      setLegacyVisibility(true);
      setValue(initialValue);
      if (editor) {
        editor.readOnly = Boolean(readOnly);
      }
      const runtimeDecorations = ensureDecorations();
      runtimeDecorations.applySettings({
        tabSize: settings?.tabSize,
        wordWrap: settings?.wordWrap
      });
      runtimeDecorations.refresh();
      runtimeDecorations.syncScroll();
      detachInput();
      detachScroll();
      detachSelect();
      detachInput = addDomListener(editor, "input", onInput);
      detachScroll = addDomListener(editor, "scroll", onScroll);
      detachSelect = addDomListener(editor, "select", onSelect);
    },
    destroy() {
      detachInput();
      detachScroll();
      detachSelect();
      detachInput = noop;
      detachScroll = noop;
      detachSelect = noop;
      if (decorations) {
        decorations.clear();
      }
      changeHandlers.clear();
      scrollHandlers.clear();
      selectionHandlers.clear();
    },
    getValue,
    setValue,
    focus() {
      if (editor) {
        editor.focus();
      }
    },
    getSelection,
    setSelection,
    getScroll,
    setScroll,
    setReadOnly(readOnly) {
      if (editor) {
        editor.readOnly = Boolean(readOnly);
      }
    },
    applySettings(settings = {}) {
      ensureDecorations().applySettings({
        tabSize: settings?.tabSize,
        wordWrap: settings?.wordWrap
      });
    },
    handleKeydown(event, { tabSize = 4 } = {}) {
      const result = handleLegacyEditorKeydown({
        event,
        adapter,
        tabSize,
        onAfterCommand(commandResult) {
          if (commandResult.selectionChanged) {
            ensureDecorations().syncScroll();
          }
        }
      });
      if (!result.handled) {
        return notHandledResult();
      }
      if (result.valueChanged) {
        fireSynthetic(editor, "input");
      } else if (result.selectionChanged) {
        fireSynthetic(editor, "select");
      }
      return result;
    },
    refreshDecorations() {
      ensureDecorations().refresh();
    },
    syncDecorationsScroll() {
      ensureDecorations().syncScroll();
    },
    setLineHighlight(lineNumber) {
      if (!Number.isFinite(lineNumber)) {
        return;
      }
      ensureDecorations().setLineHighlight(lineNumber);
    },
    clearLineHighlight() {
      ensureDecorations().clearLineHighlight();
    },
    scrollToLine(lineNumber) {
      ensureDecorations().scrollToLine(lineNumber);
    },
    onChange(handler) {
      if (typeof handler !== "function") {
        return noop;
      }
      changeHandlers.add(handler);
      return () => changeHandlers.delete(handler);
    },
    onScroll(handler) {
      if (typeof handler !== "function") {
        return noop;
      }
      scrollHandlers.add(handler);
      return () => scrollHandlers.delete(handler);
    },
    onSelectionChange(handler) {
      if (typeof handler !== "function") {
        return noop;
      }
      selectionHandlers.add(handler);
      return () => selectionHandlers.delete(handler);
    }
  };

  return adapter;
}
