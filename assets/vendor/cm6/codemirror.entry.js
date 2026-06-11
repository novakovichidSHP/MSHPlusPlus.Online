import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection
} from "@codemirror/view";
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting
} from "@codemirror/language";
import { history, historyKeymap, defaultKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { python } from "@codemirror/lang-python";
import { tags } from "@lezer/highlight";

const DEFAULT_TAB_SIZE = 4;
const DEFAULT_FONT_SIZE = 14;

const legacyHighlightStyle = HighlightStyle.define([
  {
    tag: [
      tags.keyword,
      tags.operatorKeyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.modifier
    ],
    color: "#C800A4",
    fontWeight: "400"
  },
  {
    tag: [
      tags.atom,
      tags.bool,
      tags.null
    ],
    color: "#C800A4"
  },
  {
    tag: [
      tags.string,
      tags.special(tags.string),
      tags.regexp
    ],
    color: "#DF0002"
  },
  {
    tag: [
      tags.comment,
      tags.lineComment,
      tags.blockComment
    ],
    color: "#008A00",
    fontStyle: "normal"
  },
  {
    tag: [
      tags.number,
      tags.integer,
      tags.float
    ],
    color: "#3A00DC"
  },
  {
    tag: [
      tags.standard(tags.name),
      tags.standard(tags.variableName)
    ],
    color: "#3A00DC"
  }
]);

function clampSelection(value, max) {
  const next = Number(value) || 0;
  return Math.max(0, Math.min(max, next));
}

function normalizeSettings(settings = {}) {
  return {
    tabSize: Number(settings.tabSize) > 0 ? Number(settings.tabSize) : DEFAULT_TAB_SIZE,
    wordWrap: Boolean(settings.wordWrap),
    fontSize: Number(settings.fontSize) > 0 ? Number(settings.fontSize) : DEFAULT_FONT_SIZE
  };
}

export function createCodeMirrorEditor({
  parent,
  initialValue = "",
  readOnly = false,
  settings = {},
  onDocChange,
  onSelectionChange,
  onScroll,
  onShortcutKeydown
}) {
  if (!parent) {
    throw new Error("createCodeMirrorEditor: parent is required");
  }

  const tabSizeCompartment = new Compartment();
  const wrapCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();
  const editableCompartment = new Compartment();
  const languageCompartment = new Compartment();
  const settingsState = normalizeSettings(settings);

  const getWrapExtension = (enabled) => (enabled ? EditorView.lineWrapping : []);
  const getTabExtension = (value) => EditorState.tabSize.of(value);
  const getReadOnlyExtension = (value) => EditorState.readOnly.of(value);
  const getEditableExtension = (value) => EditorView.editable.of(!value);

  let destroyed = false;
  let suppressDocEvent = false;

  const domEvents = EditorView.domEventHandlers({
    keydown(event, view) {
      if (typeof onShortcutKeydown !== "function") {
        return false;
      }
      return Boolean(onShortcutKeydown(event, view));
    },
    scroll() {
      if (typeof onScroll === "function") {
        onScroll(getScroll());
      }
      return false;
    }
  });

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.selectionSet && typeof onSelectionChange === "function") {
      onSelectionChange(getSelection());
    }
    if (update.viewportChanged && typeof onScroll === "function") {
      onScroll(getScroll());
    }
    if (!suppressDocEvent && update.docChanged && typeof onDocChange === "function") {
      onDocChange(getValue());
    }
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      syncRootMetrics();
    }
  });

  const baseExtensions = [
    lineNumbers(),
    highlightSpecialChars(),
    drawSelection(),
    dropCursor(),
    history(),
    indentOnInput(),
    bracketMatching(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    syntaxHighlighting(legacyHighlightStyle, { fallback: true }),
    languageCompartment.of(python()),
    tabSizeCompartment.of(getTabExtension(settingsState.tabSize)),
    wrapCompartment.of(getWrapExtension(settingsState.wordWrap)),
    readOnlyCompartment.of(getReadOnlyExtension(readOnly)),
    editableCompartment.of(getEditableExtension(readOnly)),
    keymap.of([
      indentWithTab,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap
    ]),
    domEvents,
    updateListener
  ];

  const state = EditorState.create({
    doc: String(initialValue || ""),
    extensions: baseExtensions
  });

  const view = new EditorView({
    state,
    parent
  });

  const syncRootMetrics = () => {
    view.dom.style.setProperty("--editor-font-size", `${settingsState.fontSize}px`);
  };

  const getValue = () => view.state.doc.toString();

  const setValue = (text) => {
    const next = String(text || "");
    const current = getValue();
    if (next === current) {
      return;
    }
    suppressDocEvent = true;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: next }
    });
    suppressDocEvent = false;
  };

  const getSelection = () => {
    const main = view.state.selection.main;
    return { start: main.from, end: main.to };
  };

  const setSelection = ({ start = 0, end = start } = {}) => {
    const max = getValue().length;
    const from = clampSelection(start, max);
    const to = clampSelection(end, max);
    view.dispatch({
      selection: EditorSelection.single(from, to),
      scrollIntoView: true
    });
  };

  const getScroll = () => ({
    top: view.scrollDOM.scrollTop,
    left: view.scrollDOM.scrollLeft
  });

  const setScroll = ({ top = 0, left = 0 } = {}) => {
    view.scrollDOM.scrollTop = Number(top) || 0;
    view.scrollDOM.scrollLeft = Number(left) || 0;
  };

  const setReadOnly = (value) => {
    const next = Boolean(value);
    view.dispatch({
      effects: [
        readOnlyCompartment.reconfigure(getReadOnlyExtension(next)),
        editableCompartment.reconfigure(getEditableExtension(next))
      ]
    });
  };

  const applySettings = (nextSettings = {}) => {
    const normalized = normalizeSettings(nextSettings);
    settingsState.tabSize = normalized.tabSize;
    settingsState.wordWrap = normalized.wordWrap;
    settingsState.fontSize = normalized.fontSize;
    view.dispatch({
      effects: [
        tabSizeCompartment.reconfigure(getTabExtension(settingsState.tabSize)),
        wrapCompartment.reconfigure(getWrapExtension(settingsState.wordWrap))
      ]
    });
    syncRootMetrics();
  };

  syncRootMetrics();

  return {
    kind: "cm6",
    focus() {
      view.focus();
    },
    getValue,
    setValue,
    getSelection,
    setSelection,
    getScroll,
    setScroll,
    setReadOnly,
    applySettings,
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      view.destroy();
    }
  };
}
