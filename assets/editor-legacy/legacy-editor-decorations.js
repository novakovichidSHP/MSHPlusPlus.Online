function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapToken(value, type) {
  return `<span class="token ${type}">${value}</span>`;
}

function highlightPlain(text, tokenRegex, numberRegex, keywordSet, builtinSet) {
  if (!text) {
    return "";
  }
  let out = "";
  let lastIndex = 0;
  for (const match of text.matchAll(tokenRegex)) {
    const index = match.index ?? 0;
    const value = match[0];
    out += escapeHtml(text.slice(lastIndex, index));
    let type = "number";
    if (numberRegex.test(value)) {
      type = "number";
    } else if (builtinSet.has(value)) {
      type = "builtin";
    } else if (keywordSet.has(value)) {
      type = "keyword";
    }
    out += wrapToken(escapeHtml(value), type);
    lastIndex = index + value.length;
  }
  out += escapeHtml(text.slice(lastIndex));
  return out;
}

function highlightPython(code) {
  const keywordList = [
    "and", "as", "assert", "break", "class", "continue", "def", "del", "elif", "else",
    "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda",
    "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
    "True", "False", "None"
  ];
  const builtinList = [
    "print", "input", "range", "len", "int", "float", "str", "list", "dict", "set",
    "tuple", "open", "min", "max", "sum", "abs", "enumerate", "zip", "map", "filter"
  ];
  const keywordSet = new Set(keywordList);
  const builtinSet = new Set(builtinList);
  const keywordPattern = `(?:${keywordList.join("|")})`;
  const builtinPattern = `(?:${builtinList.join("|")})`;
  const tokenRegex = new RegExp(`\\b${keywordPattern}\\b|\\b${builtinPattern}\\b|\\b\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b`, "g");
  const numberRegex = /^\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?$/i;

  let out = "";
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    const next3 = code.slice(i, i + 3);
    if (next3 === "'''" || next3 === '"""') {
      const end = code.indexOf(next3, i + 3);
      const endIndex = end === -1 ? code.length : end + 3;
      const chunk = code.slice(i, endIndex);
      out += wrapToken(escapeHtml(chunk), "string");
      i = endIndex;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      let escaped = false;
      while (j < code.length) {
        const cj = code[j];
        if (escaped) {
          escaped = false;
          j += 1;
          continue;
        }
        if (cj === "\\") {
          escaped = true;
          j += 1;
          continue;
        }
        if (cj === ch || cj === "\n") {
          if (cj === ch) {
            j += 1;
          }
          break;
        }
        j += 1;
      }
      const chunk = code.slice(i, j);
      out += wrapToken(escapeHtml(chunk), "string");
      i = j;
      continue;
    }
    if (ch === "#") {
      let j = i;
      while (j < code.length && code[j] !== "\n") {
        j += 1;
      }
      const chunk = code.slice(i, j);
      out += wrapToken(escapeHtml(chunk), "comment");
      i = j;
      continue;
    }
    let j = i;
    while (j < code.length) {
      const cj = code[j];
      if (cj === "#" || cj === "'" || cj === '"') {
        break;
      }
      j += 1;
    }
    const chunk = code.slice(i, j);
    out += highlightPlain(chunk, tokenRegex, numberRegex, keywordSet, builtinSet);
    i = j;
  }
  return out;
}

export function createLegacyEditorDecorations({
  editor,
  editorHighlight,
  lineNumbers,
  getIsActive,
  getEditorValue
}) {
  const isActive = typeof getIsActive === "function" ? getIsActive : () => true;
  const readEditorValue = typeof getEditorValue === "function"
    ? getEditorValue
    : () => (editor ? editor.value : "");

  let lineNumbersContent = null;
  let lineHighlight = null;
  let highlightedLine = null;

  const ensureLineNumbersContentElement = () => {
    if (lineNumbersContent && lineNumbersContent.isConnected) {
      return lineNumbersContent;
    }
    if (!lineNumbers) {
      return null;
    }
    const existing = lineNumbers.querySelector(".line-numbers-content");
    if (existing) {
      lineNumbersContent = existing;
      return existing;
    }
    const content = document.createElement("div");
    content.className = "line-numbers-content";
    lineNumbers.textContent = "";
    lineNumbers.appendChild(content);
    lineNumbersContent = content;
    return content;
  };

  const ensureLineHighlightElement = () => {
    if (lineHighlight && lineHighlight.isConnected) {
      return lineHighlight;
    }
    const host = editorHighlight ? editorHighlight.parentElement : null;
    if (!host) {
      return null;
    }
    const highlight = document.createElement("div");
    highlight.className = "editor-line-highlight";
    highlight.style.display = "none";
    host.insertBefore(highlight, editorHighlight);
    lineHighlight = highlight;
    return highlight;
  };

  const clear = () => {
    if (editorHighlight) {
      editorHighlight.textContent = "";
    }
    const lineNumbersNode = ensureLineNumbersContentElement();
    if (lineNumbersNode) {
      lineNumbersNode.textContent = "";
      lineNumbersNode.style.transform = "";
    }
    if (lineHighlight) {
      lineHighlight.style.display = "none";
    }
  };

  const updateLineHighlightPosition = () => {
    if (!isActive()) {
      return;
    }
    if (!editor || !lineHighlight || !highlightedLine) {
      return;
    }
    const computed = getComputedStyle(editor);
    const lineHeight = Number.parseFloat(computed.lineHeight) || 22;
    const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
    const maxLine = Math.max(1, readEditorValue().split("\n").length);
    const lineNumber = Math.min(highlightedLine, maxLine);
    const top = paddingTop + (lineNumber - 1) * lineHeight - editor.scrollTop;
    lineHighlight.style.height = `${lineHeight}px`;
    lineHighlight.style.transform = `translateY(${Math.round(top)}px)`;
    lineHighlight.style.display = "block";
  };

  const syncScroll = () => {
    if (!isActive()) {
      return;
    }
    if (!editor || !editorHighlight || !lineNumbers) {
      return;
    }
    const scrollTop = editor.scrollTop;
    const scrollLeft = editor.scrollLeft;
    editorHighlight.style.transform = `translate3d(${-scrollLeft}px, ${-scrollTop}px, 0)`;
    const lineNumbersNode = ensureLineNumbersContentElement();
    if (lineNumbersNode) {
      lineNumbersNode.style.transform = `translate3d(0, ${-scrollTop}px, 0)`;
    }
    updateLineHighlightPosition();
  };

  const refresh = () => {
    if (!isActive()) {
      clear();
      return;
    }
    if (!editorHighlight || !lineNumbers) {
      return;
    }
    const code = readEditorValue();
    editorHighlight.innerHTML = highlightPython(code);
    const lineCount = Math.max(1, code.split("\n").length);
    const lines = new Array(lineCount);
    for (let i = 0; i < lineCount; i += 1) {
      lines[i] = String(i + 1);
    }
    const lineNumbersNode = ensureLineNumbersContentElement();
    if (!lineNumbersNode) {
      return;
    }
    lineNumbersNode.textContent = lines.join("\n");
    syncScroll();
    updateLineHighlightPosition();
  };

  const scrollToLine = (lineNumber) => {
    if (!isActive()) {
      return;
    }
    if (!editor) {
      return;
    }
    const line = Math.max(1, Math.floor(Number(lineNumber) || 1));
    const computed = getComputedStyle(editor);
    const lineHeight = Number.parseFloat(computed.lineHeight) || 22;
    const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
    const lineTop = paddingTop + (line - 1) * lineHeight;
    const viewTop = editor.scrollTop;
    const viewBottom = viewTop + editor.clientHeight - lineHeight;
    if (lineTop < viewTop) {
      editor.scrollTop = Math.max(0, lineTop);
    } else if (lineTop > viewBottom) {
      editor.scrollTop = Math.max(0, lineTop - editor.clientHeight + lineHeight);
    }
    syncScroll();
  };

  const setLineHighlight = (lineNumber) => {
    if (!Number.isFinite(lineNumber)) {
      return;
    }
    highlightedLine = Math.max(1, Math.floor(lineNumber));
    ensureLineHighlightElement();
    updateLineHighlightPosition();
    scrollToLine(highlightedLine);
  };

  const clearLineHighlight = () => {
    highlightedLine = null;
    if (lineHighlight) {
      lineHighlight.style.display = "none";
    }
  };

  const applySettings = ({ tabSize, wordWrap } = {}) => {
    if (!editorHighlight) {
      return;
    }
    if (Number(tabSize) > 0) {
      editorHighlight.style.tabSize = Number(tabSize);
    }
    const wrapEnabled = Boolean(wordWrap);
    editorHighlight.style.whiteSpace = wrapEnabled ? "pre-wrap" : "pre";
    editorHighlight.style.overflowWrap = wrapEnabled ? "break-word" : "normal";
    editorHighlight.style.wordBreak = wrapEnabled ? "break-word" : "normal";
  };

  return {
    clear,
    refresh,
    syncScroll,
    scrollToLine,
    setLineHighlight,
    clearLineHighlight,
    updateLineHighlightPosition,
    applySettings
  };
}
