import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  crosshairCursor,
  drawSelection,
  dropCursor,
  gutter,
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
import { cpp } from "@codemirror/lang-cpp";
import { tags } from "@lezer/highlight";

const DEFAULT_TAB_SIZE = 4;
const DEFAULT_FONT_SIZE = 14;

class DebugBreakpointMarker extends GutterMarker {
  toDOM() {
    const marker = document.createElement("span");
    marker.className = "cm-debug-breakpoint-dot";
    marker.textContent = "●";
    marker.title = "Breakpoint";
    return marker;
  }
}

const debugBreakpointMarker = new DebugBreakpointMarker();

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

// Тёмная подсветка синтаксиса (для data-theme="dark") — палитра в духе senior-МШП.
const darkHighlightStyle = HighlightStyle.define([
  {
    tag: [
      tags.keyword,
      tags.operatorKeyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.modifier
    ],
    color: "#c792ea"
  },
  { tag: [tags.atom, tags.bool, tags.null], color: "#ff9cac" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "#c3e88d" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "#6b6f95", fontStyle: "italic" },
  { tag: [tags.number, tags.integer, tags.float], color: "#f78c6c" },
  { tag: [tags.standard(tags.name), tags.standard(tags.variableName)], color: "#82aaff" },
  { tag: [tags.processingInstruction, tags.meta], color: "#ff7eb6" }
]);

// Тёмная тема редактора: фон/курсор/строки/выделение.
const darkEditorTheme = EditorView.theme({
  "&": { color: "#e8e4ff", backgroundColor: "#160e36" },
  ".cm-content": { caretColor: "#82aaff" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#82aaff" },
  ".cm-gutters": { backgroundColor: "#160e36", color: "#5b5f8c", border: "none" },
  ".cm-activeLine": { backgroundColor: "rgba(124,108,255,.10)" },
  ".cm-activeLineGutter": { backgroundColor: "rgba(124,108,255,.12)", color: "#9b93c9" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgba(124,108,255,.30)"
  },
  ".cm-matchingBracket": { backgroundColor: "rgba(130,170,255,.25)", outline: "none" }
}, { dark: true });

const lightThemeExtension = syntaxHighlighting(legacyHighlightStyle, { fallback: true });
const darkThemeExtension = [darkEditorTheme, syntaxHighlighting(darkHighlightStyle, { fallback: true })];

function getThemeExtension(theme) {
  return theme === "dark" ? darkThemeExtension : lightThemeExtension;
}

function clampSelection(value, max) {
  const next = Number(value) || 0;
  return Math.max(0, Math.min(max, next));
}

function normalizeSettings(settings = {}) {
  return {
    tabSize: Number(settings.tabSize) > 0 ? Number(settings.tabSize) : DEFAULT_TAB_SIZE,
    wordWrap: Boolean(settings.wordWrap),
    fontSize: Number(settings.fontSize) > 0 ? Number(settings.fontSize) : DEFAULT_FONT_SIZE,
    theme: settings.theme === "dark" ? "dark" : "light"
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
  onShortcutKeydown,
  onDebugGutterClick
}) {
  if (!parent) {
    throw new Error("createCodeMirrorEditor: parent is required");
  }

  const tabSizeCompartment = new Compartment();
  const wrapCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();
  const editableCompartment = new Compartment();
  const languageCompartment = new Compartment();
  const themeCompartment = new Compartment();
  const debugCompartment = new Compartment();
  const settingsState = normalizeSettings(settings);
  let debugMarkers = { breakpoints: [], currentLine: null };

  const getWrapExtension = (enabled) => (enabled ? EditorView.lineWrapping : []);
  const getTabExtension = (value) => EditorState.tabSize.of(value);
  const getReadOnlyExtension = (value) => EditorState.readOnly.of(value);
  const getEditableExtension = (value) => EditorView.editable.of(!value);

  const buildDebugExtension = () => {
    const breakpointLines = new Set(
      (debugMarkers.breakpoints || [])
        .map((line) => Math.floor(Number(line)))
        .filter((line) => line > 0)
    );
    const currentLine = Math.floor(Number(debugMarkers.currentLine) || 0);
    const lineDecorations = [];
    for (const { from, number } of viewLineIter()) {
      const classes = [];
      if (breakpointLines.has(number)) classes.push("cm-debug-breakpoint-line");
      if (number === currentLine) classes.push("cm-debug-current-line");
      if (classes.length) {
        lineDecorations.push(Decoration.line({ class: classes.join(" ") }).range(from));
      }
    }
    return [
      EditorView.decorations.of(Decoration.set(lineDecorations, true)),
      gutter({
        class: "cm-debug-gutter",
        lineMarker(view, line) {
          const number = view.state.doc.lineAt(line.from).number;
          return breakpointLines.has(number) ? debugBreakpointMarker : null;
        },
        initialSpacer: () => debugBreakpointMarker,
        domEventHandlers: {
          mousedown(view, line, event) {
            if (typeof onDebugGutterClick !== "function") return false;
            event.preventDefault();
            const number = view.state.doc.lineAt(line.from).number;
            onDebugGutterClick(number);
            return true;
          }
        }
      })
    ];
  };

  function* viewLineIter() {
    if (!viewRef) return;
    const doc = viewRef.state.doc;
    for (let i = 1; i <= doc.lines; i += 1) {
      const line = doc.line(i);
      yield { from: line.from, number: i };
    }
  }

  let destroyed = false;
  let suppressDocEvent = false;
  let viewRef = null;

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
    debugCompartment.of([]),
    themeCompartment.of(getThemeExtension(settingsState.theme)),
    languageCompartment.of(cpp()),
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
  viewRef = view;

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

  const setTheme = (theme) => {
    settingsState.theme = theme === "dark" ? "dark" : "light";
    view.dispatch({
      effects: themeCompartment.reconfigure(getThemeExtension(settingsState.theme))
    });
  };

  const setDebugMarkers = (markers = {}) => {
    debugMarkers = {
      breakpoints: Array.isArray(markers.breakpoints) ? markers.breakpoints : [],
      currentLine: markers.currentLine || null
    };
    view.dispatch({
      effects: debugCompartment.reconfigure(buildDebugExtension())
    });
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
    setTheme,
    setDebugMarkers,
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      view.destroy();
    }
  };
}
