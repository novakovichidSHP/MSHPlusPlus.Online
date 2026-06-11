import { runEditorCommand } from "./editor-command-runner.js";
import { resolveEditorShortcut } from "./editor-shortcuts.js";
import { createCodeMirrorEditor } from "../vendor/cm6/codemirror.bundle.js";

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

export function createCm6EditorAdapter({
  editor,
  editorStack,
  editorWrap,
  editorHighlight,
  lineNumbers
}) {
  const changeHandlers = new Set();
  const scrollHandlers = new Set();
  const selectionHandlers = new Set();
  let cm6 = null;
  let host = null;
  let detachMirrorInput = noop;
  let detachMirrorScroll = noop;
  let suppressMirrorSync = false;
  let currentTabSize = 4;

  const emit = (handlers, payload) => {
    handlers.forEach((handler) => {
      try {
        handler(payload);
      } catch (error) {
        console.error(error);
      }
    });
  };

  const addListener = (target, event, handler, options) => {
    if (!target) {
      return noop;
    }
    target.addEventListener(event, handler, options);
    return () => target.removeEventListener(event, handler, options);
  };

  const toSelection = () => ({
    start: Number(editor?.selectionStart || 0),
    end: Number(editor?.selectionEnd || 0)
  });

  const toScroll = () => ({
    top: Number(editor?.scrollTop || 0),
    left: Number(editor?.scrollLeft || 0)
  });

  const applyCm6Visibility = (active) => {
    if (!editor) {
      return;
    }
    editor.classList.toggle("cm6-source-hidden", active);
    editor.setAttribute("aria-hidden", active ? "true" : "false");
    editor.tabIndex = active ? -1 : 0;
    if (editorStack) {
      editorStack.classList.toggle("cm6-active", active);
    }
    if (editorWrap) {
      editorWrap.classList.toggle("cm6-mode", active);
    }
    if (editorHighlight) {
      editorHighlight.classList.toggle("hidden", active);
    }
    if (lineNumbers) {
      lineNumbers.classList.toggle("hidden", active);
    }
  };

  const ensureHost = () => {
    if (!editorStack) {
      return null;
    }
    if (host && host.isConnected) {
      return host;
    }
    host = document.createElement("div");
    host.className = "cm6-editor-host";
    editorStack.insertBefore(host, editorStack.firstChild);
    return host;
  };

  const syncMirrorFromCm6 = () => {
    if (!cm6 || !editor) {
      return;
    }
    suppressMirrorSync = true;
    const value = cm6.getValue();
    if (editor.value !== value) {
      editor.value = value;
    }
    const selection = cm6.getSelection();
    editor.selectionStart = selection.start;
    editor.selectionEnd = selection.end;
    const scroll = cm6.getScroll();
    editor.scrollTop = scroll.top;
    editor.scrollLeft = scroll.left;
    suppressMirrorSync = false;
  };

  const syncCm6FromMirror = () => {
    if (!cm6 || !editor || suppressMirrorSync) {
      return;
    }
    cm6.setValue(editor.value || "");
    cm6.setSelection(toSelection());
    cm6.setScroll(toScroll());
  };

  const onMirrorInput = () => {
    syncCm6FromMirror();
    emit(changeHandlers, { source: "cm6-mirror" });
  };

  const onMirrorScroll = () => {
    if (!cm6 || suppressMirrorSync) {
      return;
    }
    cm6.setScroll(toScroll());
    emit(scrollHandlers, toScroll());
  };

  const resolveLineStartSelection = (lineNumber) => {
    const line = Math.max(1, Math.floor(Number(lineNumber) || 1));
    const rows = String(adapter.getValue() || "").split("\n");
    let from = 0;
    for (let i = 0; i < Math.min(line - 1, rows.length); i += 1) {
      from += rows[i].length + 1;
    }
    return { start: from, end: from };
  };

  const handleShortcutKeydown = (event, { tabSize = currentTabSize } = {}) => {
    if (Number(tabSize) > 0) {
      currentTabSize = Number(tabSize);
    }
    const command = resolveEditorShortcut(event);
    if (!command) {
      return notHandledResult();
    }

    const result = runEditorCommand({
      adapter,
      command,
      tabSize: currentTabSize
    });

    if (!result.handled) {
      return result;
    }

    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    if (result.valueChanged) {
      fireSynthetic(editor, "input");
    } else if (result.selectionChanged) {
      fireSynthetic(editor, "select");
    }
    return result;
  };

  const adapter = {
    kind: "cm6",
    init({ initialValue = "", readOnly = false, settings = {} } = {}) {
      const mount = ensureHost();
      if (!mount) {
        throw new Error("CM6 adapter init failed: editor host missing");
      }
      if (Number(settings?.tabSize) > 0) {
        currentTabSize = Number(settings.tabSize);
      }
      applyCm6Visibility(true);
      cm6 = createCodeMirrorEditor({
        parent: mount,
        initialValue,
        readOnly,
        settings: {
          tabSize: settings.tabSize,
          wordWrap: settings.wordWrap,
          fontSize: settings.editorFontSize
        },
        onDocChange() {
          syncMirrorFromCm6();
          fireSynthetic(editor, "input");
          emit(changeHandlers, { source: "cm6" });
        },
        onSelectionChange(selection) {
          if (!editor) {
            return;
          }
          const scroll = cm6 ? cm6.getScroll() : { top: 0, left: 0 };
          suppressMirrorSync = true;
          editor.selectionStart = selection.start;
          editor.selectionEnd = selection.end;
          editor.scrollTop = scroll.top;
          editor.scrollLeft = scroll.left;
          suppressMirrorSync = false;
          fireSynthetic(editor, "select");
          emit(selectionHandlers, selection);
        },
        onScroll(scroll) {
          if (!editor) {
            return;
          }
          suppressMirrorSync = true;
          editor.scrollTop = scroll.top;
          editor.scrollLeft = scroll.left;
          suppressMirrorSync = false;
          emit(scrollHandlers, scroll);
        },
        onShortcutKeydown(event) {
          return adapter.handleKeydown(event, { tabSize: currentTabSize }).handled;
        }
      });
      syncMirrorFromCm6();
      detachMirrorInput();
      detachMirrorScroll();
      detachMirrorInput = addListener(editor, "input", onMirrorInput);
      detachMirrorScroll = addListener(editor, "scroll", onMirrorScroll);
    },
    destroy() {
      detachMirrorInput();
      detachMirrorScroll();
      detachMirrorInput = noop;
      detachMirrorScroll = noop;
      if (cm6) {
        cm6.destroy();
        cm6 = null;
      }
      if (host && host.parentNode) {
        host.parentNode.removeChild(host);
      }
      host = null;
      applyCm6Visibility(false);
      changeHandlers.clear();
      scrollHandlers.clear();
      selectionHandlers.clear();
    },
    focus() {
      cm6?.focus();
    },
    getValue() {
      return cm6 ? cm6.getValue() : (editor?.value || "");
    },
    setValue(text) {
      if (cm6) {
        cm6.setValue(String(text || ""));
        syncMirrorFromCm6();
      } else if (editor) {
        editor.value = String(text || "");
      }
    },
    getSelection() {
      return cm6 ? cm6.getSelection() : toSelection();
    },
    setSelection(selection) {
      if (cm6) {
        cm6.setSelection(selection);
        syncMirrorFromCm6();
      } else if (editor) {
        const next = selection || {};
        editor.selectionStart = Number(next.start || 0);
        editor.selectionEnd = Number(next.end || editor.selectionStart);
      }
    },
    getScroll() {
      return cm6 ? cm6.getScroll() : toScroll();
    },
    setScroll(scroll) {
      if (cm6) {
        cm6.setScroll(scroll);
        syncMirrorFromCm6();
      } else if (editor) {
        editor.scrollTop = Number(scroll?.top || 0);
        editor.scrollLeft = Number(scroll?.left || 0);
      }
    },
    setReadOnly(readOnly) {
      cm6?.setReadOnly(Boolean(readOnly));
      if (editor) {
        editor.readOnly = Boolean(readOnly);
      }
    },
    applySettings(settings) {
      if (Number(settings?.tabSize) > 0) {
        currentTabSize = Number(settings.tabSize);
      }
      cm6?.applySettings({
        tabSize: settings?.tabSize,
        wordWrap: settings?.wordWrap,
        fontSize: settings?.editorFontSize
      });
    },
    handleKeydown(event, { tabSize = currentTabSize } = {}) {
      return handleShortcutKeydown(event, { tabSize });
    },
    refreshDecorations() { },
    syncDecorationsScroll() { },
    setLineHighlight(lineNumber) {
      if (!Number.isFinite(lineNumber)) {
        return;
      }
      adapter.scrollToLine(lineNumber);
    },
    clearLineHighlight() { },
    scrollToLine(lineNumber) {
      if (!Number.isFinite(lineNumber)) {
        return;
      }
      adapter.setSelection(resolveLineStartSelection(lineNumber));
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
