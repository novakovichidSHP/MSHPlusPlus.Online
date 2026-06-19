import { gzipSync, gunzipSync, unzipSync } from "./skulpt-fflate.esm.js";
import { mergeUniqueIds } from "./utils/recent-utils.js";
import { getBaseName, createNumberedImportName } from "./utils/import-utils.js";
import { cloneFilesForProject, resolveLastActiveFile } from "./utils/remix-utils.js";
import { createCm6EditorAdapter } from "./editor-core/cm6-editor-adapter.js";
import { createCppRuntime } from "./cpp-runtime/cpp-runtime.js?v=5";
import { lineColToOffset } from "./cpp-runtime/source-position.js";

// Движок C++ (emception) — занимает место Skulpt. Инициализируется в initRuntime().
// baseUrl относителен расположению cpp-runtime.js (assets/cpp-runtime/) → ../../toolchain/
// разрешается в <корень-сайта>/toolchain/ независимо от того, где смонтирован сайт.
let cppEngine = null;
const CPP_TOOLCHAIN_BASE = "../../toolchain/";

const CONFIG = {
  RUN_TIMEOUT_MS: 60000,
  MAX_OUTPUT_BYTES: 2000000,
  MAX_FILES: 30,
  MAX_TOTAL_TEXT_BYTES: 250000,
  MAX_SINGLE_FILE_BYTES: 50000,
  TAB_SIZE: 4,
  WORD_WRAP: false
};
const MAIN_FILE = "main.cpp";
const EDITOR_FONT_MIN = 12;
const EDITOR_FONT_MAX = 20;
const EDITOR_FONT_STEP = 1;
const EDITOR_FONT_DEFAULT = 14;
const MOBILE_CARD_BREAKPOINT = "(max-width: 768px)";
const COMPACT_INPUT_BREAKPOINT = "(max-width: 1024px)";
const UI_CARDS = ["modules", "editor", "console"];
const MOBILE_ACTION_LABELS = {
  share: "🔗",
  export: "⬆️",
  import: "⬇️"
};
const CONSOLE_INPUT_PLACEHOLDER_DESKTOP = "Программа запросит ввод — введите строку и нажмите Enter…";
const CONSOLE_INPUT_PLACEHOLDER_MOBILE = "Введите строку, Enter — отправить…";

const VALID_FILENAME = /^[A-Za-z0-9._\-\u0400-\u04FF]+$/;
// \u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044F \u0438\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u043E\u0432 C++ (\u0435\u0434\u0438\u043D\u0438\u0446\u044B \u0442\u0440\u0430\u043D\u0441\u043B\u044F\u0446\u0438\u0438 + \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043A\u0438). \u0418\u043C\u044F \u0431\u0435\u0437 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044F \u2192 .cpp.
const SOURCE_EXTENSIONS = [".cpp", ".cc", ".cxx", ".c", ".hpp", ".hh", ".hxx", ".h"];
const DEFAULT_SOURCE_EXTENSION = ".cpp";
function hasSourceExtension(name) {
  const lower = String(name || "").toLowerCase();
  return SOURCE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
const encoder = typeof TextEncoder !== "undefined"
  ? new TextEncoder()
  : {
    encode: (text) => {
      const utf8 = unescape(encodeURIComponent(String(text)));
      const bytes = new Uint8Array(utf8.length);
      for (let i = 0; i < utf8.length; i += 1) {
        bytes[i] = utf8.charCodeAt(i);
      }
      return bytes;
    }
  };
const decoder = typeof TextDecoder !== "undefined"
  ? new TextDecoder()
  : {
    decode: (input) => {
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      return decodeURIComponent(escape(binary));
    }
  };
const supportsPointerEvents = "PointerEvent" in window;
const supportsPassiveEvents = (() => {
  let supported = false;
  try {
    const noop = () => { };
    const opts = Object.defineProperty({}, "passive", {
      get() {
        supported = true;
        return true;
      }
    });
    window.addEventListener("test-passive", noop, opts);
    window.removeEventListener("test-passive", noop, opts);
  } catch (error) {
    supported = false;
  }
  return supported;
})();
const touchEventOptions = supportsPassiveEvents ? { passive: false } : false;
const RUN_STATUS_LABELS = {
  idle: "Ожидание",
  loading: "Загрузка компилятора…",
  compiling: "Компиляция…",
  running: "Выполняется",
  done: "Готово",
  error: "Ошибка",
  stopped: "Остановлено"
};
const IMAGE_ASSET_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".bmp"
]);

const state = {
  db: null,
  mode: "landing",
  editorAdapter: null,
  uiCard: "editor",
  project: null,
  snapshot: null,
  activeFile: null,
  settings: {
    tabSize: CONFIG.TAB_SIZE,
    wordWrap: CONFIG.WORD_WRAP,
    editorFontSize: EDITOR_FONT_DEFAULT
  },
  runtimeReady: false,
  running: false,
  stdinResolver: null,
  runToken: 0,
  runtimeBlocked: false,
  stdinQueue: [],
  stdinWaiting: false,
  runTimeout: null,
  outputBytes: 0,
  saveTimer: null,
  draftTimer: null,
  editorResizeTimer: null,
  editorScrollSyncRaf: null,
  embed: {
    active: false,
    display: "side",
    mode: "allowEither",
    autorun: false,
    readonly: false
  }
};


const els = {
  guard: document.getElementById("guard"),
  guardReload: document.getElementById("guard-reload"),
  modal: document.getElementById("modal"),
  toasts: document.getElementById("toasts"),
  viewLanding: document.getElementById("view-landing"),
  viewIde: document.getElementById("view-ide"),
  snapshotBanner: document.getElementById("snapshot-banner"),
  newProject: document.getElementById("new-project"),
  clearRecent: document.getElementById("clear-recent"),
  trashRecent: document.getElementById("trash-recent"),
  recentList: document.getElementById("recent-list"),
  heroCodeText: document.getElementById("hero-code-text"),
  projectTitle: document.getElementById("project-title"),
  projectMode: document.getElementById("project-mode"),
  topbarRight: document.querySelector(".topbar-right"),
  topActions: document.querySelector(".top-actions"),
  saveIndicator: document.getElementById("save-indicator"),
  restartIdeButtons: document.querySelectorAll("[data-action=\"restart-ide\"]"),
  restartInline: document.getElementById("restart-ide-inline"),
  runBtn: document.getElementById("run-btn"),
  stopBtn: document.getElementById("stop-btn"),
  clearBtn: document.getElementById("clear-btn"),
  themeToggle: document.getElementById("theme-toggle"),
  shareBtn: document.getElementById("share-btn"),
  exportBtn: document.getElementById("export-btn"),
  importBtn: document.getElementById("import-btn"),
  remixBtn: document.getElementById("remix-btn"),
  resetBtn: document.getElementById("reset-btn"),
  tabSizeBtn: document.getElementById("tab-size-btn"),
  wrapBtn: document.getElementById("wrap-btn"),
  fontDecBtn: document.getElementById("font-dec-btn"),
  fontIncBtn: document.getElementById("font-inc-btn"),
  hotkeysBtn: document.getElementById("hotkeys-btn"),
  sidebar: document.getElementById("sidebar"),
  editorPane: document.getElementById("editor-pane"),
  consolePane: document.getElementById("console-pane"),
  mobileNav: document.getElementById("mobile-nav"),
  mobileNavButtons: Array.from(document.querySelectorAll("#mobile-nav .mobile-nav-btn")),
  fileList: document.getElementById("file-list"),
  assetList: document.getElementById("asset-list"), // Панель "Ресурсы" скрыта - см. комментарий перед onAssetUpload()
  fileCreate: document.getElementById("file-create"),
  fileRename: document.getElementById("file-rename"),
  fileDuplicate: document.getElementById("file-duplicate"),
  fileDelete: document.getElementById("file-delete"),
  assetInput: document.getElementById("asset-input"), // Законсервировано - см. комментарий перед onAssetUpload()
  fileTabs: document.getElementById("file-tabs"),
  lineNumbers: document.getElementById("line-numbers"),
  editorHighlight: document.getElementById("editor-highlight"),
  editor: document.getElementById("editor"),
  editorStack: document.querySelector(".editor-stack"),
  editorWrap: document.querySelector(".editor-wrap"),
  importInput: document.getElementById("import-input"),
  consoleOutput: document.getElementById("console-output"),
  consoleInput: document.getElementById("console-input"),
  runStatus: document.getElementById("run-status"),
  consoleLayoutToggle: document.getElementById("console-layout-toggle"),
  workspace: document.querySelector(".workspace"),
  renameBtn: document.getElementById("rename-btn")
};

/**
 * Generates a UUID v4 string.
 * Uses crypto.randomUUID if available, falls back to crypto.getRandomValues,
 * and finally to Math.random() on older browsers.
 * @returns {string} A UUID v4 identifier
 */
function createUuid() {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    if (typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
    }
  }
  const rand = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${rand()}${rand()}-${rand()}-${rand()}-${rand()}-${rand()}${rand()}${rand()}`;
}

const memoryDb = {
  projects: new Map(),
  blobs: new Map(),
  drafts: new Map(),
  recent: new Map(),
  trash: new Map()
};

const HERO_SNIPPETS = [
  "std::cout << \"Привет!\";",
  "std::cout << 2 + 3;",
  "int age = 10;\nstd::cout << age;",
  "std::string name = \"Маша\";\nstd::cout << name;",
  "for (int i = 0; i < 5; ++i)\n    std::cout << i;",
  "int total = 0;\nfor (int n = 1; n <= 5; ++n)\n    total += n;\nstd::cout << total;",
  "std::string text = \"кот\";\nstd::cout << text.size();",
  "std::cout << (3 > 2 ? \"Да\" : \"Нет\");",
  "int x = 7;\nif (x % 2 == 0)\n    std::cout << \"Чет\";\nelse\n    std::cout << \"Нечет\";",
  "std::vector<int> v = {1, 2, 3};\nstd::cout << v[0];",
  "std::vector<int> a = {2, 4, 6};\nint s = 0;\nfor (int x : a) s += x;\nstd::cout << s;",
  "for (char c : std::string(\"кот\"))\n    std::cout << c << ' ';",
  "int a = 5, b = 8;\nstd::cout << std::max(a, b);",
  "int n;\nstd::cin >> n;\nstd::cout << n * n;",
  "std::string name;\nstd::getline(std::cin, name);\nstd::cout << \"Привет, \" << name;",
  "std::sort(v.begin(), v.end());\nstd::cout << v.front();",
  "int n = 4;\nstd::cout << n * n;",
  "std::cout << \"C++ в браузере\";"
];
const heroTyping = {
  index: 0,
  offset: 0,
  deleting: false,
  timer: null,
  order: [],
  orderIndex: 0
};

/**
 * Extracts the appropriate key for a given object from a database store.
 * @param {string} storeName - Store name: "projects", "blobs", "drafts", or "recent"
 * @param {Object} value - The object to extract key from
 * @returns {string|null} The key for this object or null if not found
 */
function getStoreKey(storeName, value) {
  if (!value) {
    return null;
  }
  if (storeName === "projects") {
    return value.projectId;
  }
  if (storeName === "blobs") {
    return value.blobId;
  }
  if (storeName === "drafts") {
    return value.key;
  }
  if (storeName === "recent") {
    return value.key;
  }
  if (storeName === "trash") {
    return value.key;
  }
  return null;
}

function getMemoryStore(storeName) {
  return memoryDb[storeName] || null;
}

function safeLocalGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function safeLocalSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    return false;
  }
}

// --- Тема (светлая/тёмная) ---
const THEME_STORAGE_KEY = "shp-theme";
const THEME_ICON_MOON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
const THEME_ICON_SUN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

function getStoredTheme() {
  const stored = safeLocalGet(THEME_STORAGE_KEY);
  if (stored === "dark" || stored === "light") {
    return stored;
  }
  if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function currentTheme() {
  return document.body.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = next === "dark" ? "dark" : "";
  if (els.themeToggle) {
    // в светлой теме показываем луну (клик → тёмная), в тёмной — солнце
    els.themeToggle.innerHTML = next === "dark" ? THEME_ICON_SUN : THEME_ICON_MOON;
  }
  callEditorAdapterMethod("setTheme", next);
}

function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  safeLocalSet(THEME_STORAGE_KEY, next);
  applyTheme(next);
}

function getEditorValue() {
  if (state.editorAdapter) {
    return state.editorAdapter.getValue();
  }
  return els.editor?.value || "";
}

function getEditorSelection() {
  if (state.editorAdapter) {
    return state.editorAdapter.getSelection();
  }
  return {
    start: Number(els.editor?.selectionStart || 0),
    end: Number(els.editor?.selectionEnd || 0)
  };
}

function getEditorScroll() {
  if (state.editorAdapter) {
    return state.editorAdapter.getScroll();
  }
  return {
    top: Number(els.editor?.scrollTop || 0),
    left: Number(els.editor?.scrollLeft || 0)
  };
}

function callEditorAdapterMethod(method, ...args) {
  if (!state.editorAdapter || typeof state.editorAdapter[method] !== "function") {
    return undefined;
  }
  return state.editorAdapter[method](...args);
}

function initEditorAdapter({ preserve = false } = {}) {
  const preservedValue = preserve && state.editorAdapter
    ? state.editorAdapter.getValue()
    : getEditorValue();
  const preservedSelection = preserve && state.editorAdapter
    ? state.editorAdapter.getSelection()
    : getEditorSelection();
  const preservedScroll = preserve && state.editorAdapter
    ? state.editorAdapter.getScroll()
    : getEditorScroll();
  const readOnly = Boolean(els.editor?.readOnly);

  if (state.editorAdapter) {
    state.editorAdapter.destroy();
    state.editorAdapter = null;
  }

  state.editorAdapter = createCm6EditorAdapter({
    editor: els.editor,
    editorStack: els.editorStack,
    editorWrap: els.editorWrap,
    editorHighlight: els.editorHighlight,
    lineNumbers: els.lineNumbers
  });
  state.editorAdapter.init({
    initialValue: preservedValue,
    readOnly,
    settings: state.settings
  });
  state.editorAdapter.setSelection(preservedSelection);
  state.editorAdapter.setScroll(preservedScroll);
  callEditorAdapterMethod("setTheme", currentTheme());
}

init();

/**
 * Application initialization: opens database, sets up UI, loads settings, and starts router.
 * Called once on page load. Shows loading guard while initializing.
 * @async
 */
async function init() {
  showGuard(true);
  bindUi();
  startHeroTyping();
  state.db = await openDb();
  if (!state.db) {
    showToast("Storage fallback: changes will not persist in this browser.");
  }
  initEditorAdapter();
  applyTheme(getStoredTheme());
  loadSettings();
  // Раскладка по макету: консоль справа (3 колонки) по умолчанию.
  setConsoleLayout(safeLocalGet("shp-console-right") !== "false");
  /**
   * Binds all UI event handlers: buttons, hotkeys, editor, file list, etc.
   * Must be called before any UI interactions.
   */
  initRuntime();
  window.addEventListener("hashchange", router);
  await router();
}

/**
 * Binds UI handlers for IDE controls, editor and console interactions.
 * Also registers responsive listeners for viewport changes.
 * @returns {void}
 */
function bindUi() {
  if (els.guardReload) {
    els.guardReload.addEventListener("click", () => location.reload());
  }
  els.newProject.addEventListener("click", () => createProjectAndOpen());
  els.clearRecent.addEventListener("click", clearRecentProjects);
  if (els.trashRecent) {
    els.trashRecent.addEventListener("click", openTrashModal);
  }
  if (els.renameBtn) {
    els.renameBtn.addEventListener("click", renameProject);
  }
  if (els.restartIdeButtons && els.restartIdeButtons.length) {
    els.restartIdeButtons.forEach((button) => {
      button.addEventListener("click", restartIdeWithCacheClear);
    });
  }

  els.runBtn.addEventListener("click", runActiveFile);
  els.stopBtn.addEventListener("click", stopRun);
  els.clearBtn.addEventListener("click", clearConsole);
  if (els.themeToggle) {
    els.themeToggle.addEventListener("click", toggleTheme);
  }
  els.shareBtn.addEventListener("click", shareProject);
  els.exportBtn.addEventListener("click", exportProject);
  if (els.importBtn) {
    els.importBtn.addEventListener("click", () => {
      if (state.mode !== "project" || state.embed.readonly || !els.importInput) {
        return;
      }
      els.importInput.value = "";
      els.importInput.click();
    });
  }
  if (els.importInput) {
    els.importInput.addEventListener("change", (event) => {
      const files = Array.from(event.target.files || []);
      if (!files.length) {
        return;
      }
      importFiles(files);
    });
  }
  els.remixBtn.addEventListener("click", remixSnapshot);
  els.resetBtn.addEventListener("click", resetSnapshot);
  els.tabSizeBtn.addEventListener("click", toggleTabSize);
  els.wrapBtn.addEventListener("click", toggleWrap);
  if (els.fontDecBtn) {
    els.fontDecBtn.addEventListener("click", () => changeEditorFontSize(-EDITOR_FONT_STEP));
  }
  if (els.fontIncBtn) {
    els.fontIncBtn.addEventListener("click", () => changeEditorFontSize(EDITOR_FONT_STEP));
  }
  if (els.hotkeysBtn) {
    els.hotkeysBtn.addEventListener("click", showHotkeysModal);
  }
  if (els.mobileNavButtons && els.mobileNavButtons.length) {
    els.mobileNavButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const card = button.dataset.card;
        setUiCard(card);
      });
    });
  }
  if (els.consoleLayoutToggle) {
    els.consoleLayoutToggle.addEventListener("click", toggleConsoleLayout);
  }
  els.fileCreate.addEventListener("click", () => createFile());
  els.fileRename.addEventListener("click", () => renameFile());
  els.fileDuplicate.addEventListener("click", () => duplicateFile());
  els.fileDelete.addEventListener("click", () => deleteFile());
  if (els.assetInput) {
    // Обработчик остаётся в коде для возможности восстановления функционала
    els.assetInput.addEventListener("change", onAssetUpload);
  }

  els.editor.addEventListener("input", onEditorInput);
  els.editor.addEventListener("keydown", onEditorKeydown);
  els.editor.addEventListener("scroll", onEditorScroll);
  els.editor.addEventListener("select", scheduleEditorScrollSync);
  document.addEventListener("selectionchange", onDocumentSelectionChange);
  window.addEventListener("resize", () => {
    scheduleEditorResizeSync();
    applyResponsiveCardState();
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", applyResponsiveCardState);
    window.visualViewport.addEventListener("scroll", applyResponsiveCardState);
  }

  // Живой (интерактивный) ввод как в классической консоли: программа запускается,
  // доходит до std::cin → приостанавливается и просит ввод; пользователь печатает
  // строку и жмёт Enter — она тут же уходит в работающую программу.
  // Shift+Enter — буквальный перенос строки (на случай многострочной порции).
  enableConsoleInput();
  els.consoleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendConsoleLine();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!els.modal.classList.contains("hidden")) {
      return;
    }
    // Run code
    if (event.key === "F8" || (event.altKey && event.key === "r")) {
      event.preventDefault();
      runActiveFile();
    }
    // Stop execution
    if (event.altKey && event.key === "x") {
      event.preventDefault();
      stopRun();
    }
    // Clear console
    if (event.altKey && event.key === "c") {
      event.preventDefault();
      clearConsole();
    }
    // Focus on editor (Alt+1)
    if (event.altKey && event.key === "1") {
      event.preventDefault();
      if (state.editorAdapter) {
        state.editorAdapter.focus();
      } else {
        els.editor.focus();
      }
    }
    // Focus on console input (Alt+2)
    if (event.altKey && event.key === "2") {
      event.preventDefault();
      els.consoleInput.focus();
    }
  });
}

function scheduleEditorResizeSync() {
  if (state.editorResizeTimer) {
    clearTimeout(state.editorResizeTimer);
  }
  state.editorResizeTimer = setTimeout(() => {
    state.editorResizeTimer = null;
    refreshEditorDecorations();
    scheduleEditorScrollSync();
  }, 80);
}

function onDocumentSelectionChange() {
  if (document.activeElement === els.editor) {
    scheduleEditorScrollSync();
  }
}

function onEditorScroll() {
  // Apply sync immediately on native scroll events for cross-browser parity
  // (Firefox/WebKit can dispatch wheel/scroll phases differently than Chromium).
  syncEditorScroll();
  scheduleEditorScrollSync();
}

function scheduleEditorScrollSync() {
  if (state.editorScrollSyncRaf) {
    return;
  }
  const raf = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : (callback) => setTimeout(callback, 16);
  state.editorScrollSyncRaf = raf(() => {
    state.editorScrollSyncRaf = null;
    syncEditorScroll();
  });
}

function isMobileViewport() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(MOBILE_CARD_BREAKPOINT).matches
    : false;
}

function isCompactViewport() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(COMPACT_INPUT_BREAKPOINT).matches
    : false;
}

function getCardElement(card) {
  if (card === "modules") {
    return els.sidebar;
  }
  if (card === "editor") {
    return els.editorPane;
  }
  if (card === "console") {
    return els.consolePane;
  }
  return null;
}

function isCardAvailable(card) {
  const element = getCardElement(card);
  if (!element || element.classList.contains("hidden")) {
    return false;
  }
  return true;
}

function getFallbackCard(preferred) {
  const candidates = [];
  if (preferred && UI_CARDS.includes(preferred)) {
    candidates.push(preferred);
  }
  candidates.push("editor", "console", "modules");
  for (const card of candidates) {
    if (isCardAvailable(card)) {
      return card;
    }
  }
  return "editor";
}

function setUiCard(card) {
  if (!UI_CARDS.includes(card)) {
    return;
  }
  state.uiCard = card;
  applyResponsiveCardState();
}

/**
 * Applies responsive card visibility/state for mobile breakpoints.
 * Updates active card, mobile navigation state and editor sync after layout updates.
 * @returns {void}
 */
function applyResponsiveCardState() {
  const mobile = isMobileViewport();
  const compact = isCompactViewport();
  applyMobileTopbarState(mobile);
  applyConsoleInputPlaceholder(compact);
  const keyboardOpen = mobile && isVirtualKeyboardOpen();
  document.body.classList.toggle("keyboard-open", keyboardOpen);
  if (els.mobileNav) {
    els.mobileNav.classList.toggle("hidden", !mobile || keyboardOpen);
  }
  const activeCard = mobile ? getFallbackCard(state.uiCard || "editor") : null;
  if (mobile) {
    state.uiCard = activeCard;
  }

  UI_CARDS.forEach((card) => {
    const element = getCardElement(card);
    if (!element) {
      return;
    }
    if (!mobile) {
      element.classList.remove("card-hidden-mobile", "card-active");
      return;
    }
    const isActive = card === activeCard;
    element.classList.toggle("card-active", isActive);
    element.classList.toggle("card-hidden-mobile", !isActive);
  });

  if (els.mobileNavButtons && els.mobileNavButtons.length) {
    els.mobileNavButtons.forEach((button) => {
      const card = button.dataset.card;
      const available = isCardAvailable(card);
      const active = mobile && card === state.uiCard;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.disabled = !available;
    });
  }

  if (mobile && state.uiCard === "editor") {
    refreshEditorDecorations();
    scheduleEditorScrollSync();
  }
}

function isVirtualKeyboardOpen() {
  if (typeof window === "undefined" || !window.visualViewport) {
    return false;
  }
  const delta = window.innerHeight - window.visualViewport.height;
  return delta > 140;
}

function setMobileButtonLabel(button, mobileLabel) {
  if (!button) {
    return;
  }
  if (!button.dataset.desktopLabel) {
    button.dataset.desktopLabel = button.textContent.trim();
  }
  const desktopLabel = button.dataset.desktopLabel;
  if (isMobileViewport()) {
    button.textContent = mobileLabel;
    button.classList.add("mobile-icon-btn");
    button.setAttribute("aria-label", desktopLabel);
    button.title = desktopLabel;
  } else {
    button.textContent = desktopLabel;
    button.classList.remove("mobile-icon-btn");
    button.removeAttribute("aria-label");
    button.title = "";
  }
}

function applyMobileTopbarState(mobile) {
  setMobileButtonLabel(els.shareBtn, MOBILE_ACTION_LABELS.share);
  setMobileButtonLabel(els.exportBtn, MOBILE_ACTION_LABELS.export);
  setMobileButtonLabel(els.importBtn, MOBILE_ACTION_LABELS.import);
  if (els.restartInline) {
    els.restartInline.classList.toggle("hidden", !mobile);
  }
}

function applyConsoleInputPlaceholder(compact) {
  if (!els.consoleInput) {
    return;
  }
  els.consoleInput.placeholder = compact
    ? CONSOLE_INPUT_PLACEHOLDER_MOBILE
    : CONSOLE_INPUT_PLACEHOLDER_DESKTOP;
}

function startHeroTyping() {
  if (!els.heroCodeText || heroTyping.timer) {
    return;
  }

  const shuffleOrder = () => {
    heroTyping.order = HERO_SNIPPETS.map((_, idx) => idx);
    for (let i = heroTyping.order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [heroTyping.order[i], heroTyping.order[j]] = [heroTyping.order[j], heroTyping.order[i]];
    }
    heroTyping.orderIndex = 0;
  };

  const nextSnippetIndex = () => {
    if (!heroTyping.order.length || heroTyping.orderIndex >= heroTyping.order.length) {
      shuffleOrder();
    }
    const idx = heroTyping.order[heroTyping.orderIndex];
    heroTyping.orderIndex += 1;
    return idx;
  };

  shuffleOrder();
  heroTyping.index = nextSnippetIndex();

  const tick = () => {
    const snippet = HERO_SNIPPETS[heroTyping.index];
    const speed = heroTyping.deleting ? 14 : 28;

    heroTyping.offset = heroTyping.deleting
      ? Math.max(0, heroTyping.offset - 1)
      : Math.min(snippet.length, heroTyping.offset + 1);

    els.heroCodeText.textContent = snippet.slice(0, heroTyping.offset);

    let delay = speed;
    if (!heroTyping.deleting && heroTyping.offset === snippet.length) {
      heroTyping.deleting = true;
      delay = 700;
    } else if (heroTyping.deleting && heroTyping.offset === 0) {
      heroTyping.deleting = false;
      heroTyping.index = nextSnippetIndex();
      delay = 250;
    }

    heroTyping.timer = setTimeout(tick, delay);
  };

  tick();
}

function showGuard(show) {
  els.guard.classList.toggle("hidden", !show);
}

function setGuardMessage(title, message) {
  const heading = els.guard.querySelector("h2");
  const text = els.guard.querySelector("p");
  if (heading) {
    heading.textContent = title;
  }
  if (text) {
    text.textContent = message;
  }
}

function showView(view) {
  els.viewLanding.classList.toggle("hidden", view !== "landing");
  /**
   * Handles URL hash changes and navigates to the appropriate view.
   * Routes: "/"=home, "/p/{projectId}"=edit project, "/s/{shareId}"=view snapshot, "/embed"=embed mode.
   * @async
   */
  els.viewIde.classList.toggle("hidden", view !== "ide");
  state.mode = view === "landing" ? "landing" : state.mode;
}

/**
 * Resolves hash route and opens the corresponding IDE/landing mode.
 * Supports project, snapshot and embed routes.
 * @async
 * @returns {Promise<void>}
 */
async function router() {
  const { route, id } = parseHash();
  if (route === "landing") {
    showView("landing");
    await renderRecent();
    return;
  }

  showView("ide");
  resetEmbed();

  if (route === "project") {
    await openProject(id);
  } else if (route === "snapshot") {
    await openSnapshot(id, query.get("p"));
  } else if (route === "embed") {
    applyEmbedSettings(query);
    const payload = query.get("p");
    const shareId = query.get("s");
    if (payload && shareId) {
      await openSnapshot(shareId, payload);
    } else {
      await openEphemeralProject();
    }
  } else {
    /**
     * Parses the current URL hash into route components (action, projectId, etc.).
     * @returns {{action: string, projectId: string|null, shareId: string|null, query: Object}}
     */
    showToast("Неизвестный маршрут, переход на главную.");
    location.hash = "#/";
  }
}

function parseHash() {
  const hash = location.hash.replace(/^#/, "");
  if (!hash || hash === "/") {
    return { route: "landing", query: new URLSearchParams() };
  }

  const [pathPart, queryString] = hash.split("?");
  const path = pathPart.startsWith("/") ? pathPart.slice(1) : pathPart;
  const parts = path.split("/").filter(Boolean);
  const query = new URLSearchParams(queryString || "");

  if (parts[0] === "p") {
    return { route: "project", id: parts[1], query };
  }
  if (parts[0] === "s") {
    return { route: "snapshot", id: parts[1], query };
  }
  if (parts[0] === "embed") {
    return { route: "embed", query };
  }
  return { route: "landing", query };
}
function resetEmbed() {
  state.embed = {
    active: false,
    display: "side",
    mode: "allowEither",
    autorun: false,
    readonly: false
  };
  els.editor.closest(".editor-pane").classList.remove("hidden");
  els.sidebar.classList.remove("hidden");
  els.consoleOutput.closest(".console-pane").classList.remove("hidden");
  applyResponsiveCardState();
}

function applyEmbedSettings(query) {
  state.embed.active = true;
  state.embed.display = query.get("display") || "side";
  state.embed.mode = query.get("mode") || "allowEither";
  state.embed.autorun = query.get("autorun") === "1";
  state.embed.readonly = query.get("readonly") === "0" ? false : true;
  if (state.embed.mode !== "allowEither") {
    state.embed.readonly = true;
  }

  const hideEditor = state.embed.display === "output" || state.embed.mode === "consoleOnly";
  const hideConsole = state.embed.mode === "runOnly";

  els.editor.closest(".editor-pane").classList.toggle("hidden", hideEditor);
  /**
   * Opens an existing project by ID and switches to edit mode.
   * @async
   * @param {string} projectId - The project ID to open
   */
  els.sidebar.classList.toggle("hidden", hideEditor);
  els.consoleOutput.closest(".console-pane").classList.toggle("hidden", hideConsole);
  applyResponsiveCardState();
}

async function openProject(projectId) {
  let project = projectId ? await dbGet("projects", projectId) : null;
  if (!project) {
    const defaultTitle = await getDefaultProjectTitle();
    project = createDefaultProject(projectId, defaultTitle);
    await saveProject(project);
  }
  state.project = project;
  state.snapshot = null;
  state.activeFile = project.lastActiveFile || project.files[0]?.name || null;
  /**
   * Creates a new project with default files and opens it in edit mode.
   * @async
   */
  ensureMainProject();
  state.activeFile = MAIN_FILE;

  setMode("project");
  renderProject();
  await rememberRecent(project.projectId);
}

function formatDefaultProjectTitle(index) {
  const safeIndex = Number.isFinite(index) && index > 0 ? Math.floor(index) : 1;
  return `Мой МШПроект - ${safeIndex}`;
}

async function getProjectsCount() {
  if (!state.db) {
    const store = getMemoryStore("projects");
    return store ? store.size : 0;
  }
  try {
    return await new Promise((resolve) => {
      const tx = state.db.transaction("projects", "readonly");
      const store = tx.objectStore("projects");
      const request = store.count();
      request.onsuccess = () => resolve(Number(request.result || 0));
      request.onerror = () => resolve(0);
    });
  } catch (error) {
    console.warn("IndexedDB count failed", error);
    state.db = null;
    const store = getMemoryStore("projects");
    return store ? store.size : 0;
  }
}

async function getRecentCount() {
  const list = await getRecent();
  return list.length;
}

async function getDefaultProjectTitle() {
  const count = await getRecentCount();
  return formatDefaultProjectTitle(count + 1);
}

async function createProjectAndOpen(options = {}) {
  const requestedTitle = String(options.initialTitle || "").trim();
  const defaultTitle = requestedTitle || await getDefaultProjectTitle();
  const promptOptions = {
    title: "Название проекта",
    placeholder: defaultTitle,
    confirmText: "Создать",
    fallbackValue: defaultTitle
  };
  if (requestedTitle) {
    promptOptions.value = defaultTitle;
  }
  const name = await promptModal({
    ...promptOptions
  });
  if (name === null) {
    return null;
  }
  const trimmed = name.trim();
  const project = createDefaultProject(undefined, trimmed || defaultTitle);
  if (Array.isArray(options.files)) {
    project.files = cloneFilesForProject(options.files, MAIN_FILE);
  }
  project.lastActiveFile = resolveLastActiveFile(project.files, options.lastActiveFile, MAIN_FILE);
  project.assets = [];
  await saveProject(project);
  location.hash = `#/p/${project.projectId}`;
  return project;
}

async function openEphemeralProject() {
  const defaultTitle = await getDefaultProjectTitle();
  const project = createDefaultProject(undefined, defaultTitle);
  /**
   * Creates a default project structure with main.py.
   * @param {string} projectId - Unique project identifier
   * @param {string} title - Project title
   * @returns {Object} Project object with files array
   */
  state.project = project;
  state.snapshot = null;
  state.activeFile = project.lastActiveFile || project.files[0]?.name || null;
  ensureMainProject();
  state.activeFile = MAIN_FILE;
  setMode("project");
  renderProject();
}

function createDefaultProject(projectId, title) {
  const id = projectId || createUuid();
  return {
    projectId: id,
    title: title || formatDefaultProjectTitle(1),
    files: [
      {
        name: MAIN_FILE,
        content: ""
      }
    ],
    assets: [],
    lastActiveFile: MAIN_FILE,
    updatedAt: Date.now()
  };
}

function ensureMainFileRecord(files) {
  if (!Array.isArray(files)) {
    return false;
  }
  const mainIndex = files.findIndex((file) => file.name === MAIN_FILE);
  if (mainIndex === -1) {
    files.unshift({ name: MAIN_FILE, content: "" });
    return true;
  }
  if (mainIndex > 0) {
    const [main] = files.splice(mainIndex, 1);
    files.unshift(main);
    return true;
  }
  return false;
}

function ensureMainProject() {
  if (!state.project) {
    return;
  }
  const changed = ensureMainFileRecord(state.project.files);
  const hasLastActive = state.project.files.some((file) => file.name === state.project.lastActiveFile);
  if (!state.project.lastActiveFile || !hasLastActive) {
    state.project.lastActiveFile = MAIN_FILE;
  }
  if (changed) {
    scheduleSave();
  }
}

function ensureMainSnapshot() {
  if (!state.snapshot) {
    /**
     * Opens a shared snapshot by shareId and optional payload, switching to snapshot mode (read-only).
     * Creates draft for local edits.
     * @async
     * @param {string} shareId - The snapshot share ID
     * @param {string} payload - Compressed/encoded project data
     */
    return;
  }
  const { baseline, draft } = state.snapshot;
  const hasMainInBaseline = baseline.files.some((file) => file.name === MAIN_FILE);
  const hasMainInOverlay = Object.prototype.hasOwnProperty.call(draft.overlayFiles, MAIN_FILE);
  if (!hasMainInBaseline && !hasMainInOverlay) {
    draft.overlayFiles[MAIN_FILE] = "";
  }
  draft.deletedFiles = draft.deletedFiles.filter((name) => name !== MAIN_FILE);
  if (!draft.draftLastActiveFile || draft.draftLastActiveFile === MAIN_FILE) {
    draft.draftLastActiveFile = MAIN_FILE;
  }
  scheduleDraftSave();
}

async function openSnapshot(shareId, payload) {
  if (!payload) {
    showToast("В ссылке нет payload снимка.");
    location.hash = "#/";
    return;
  }

  try {
    const baseline = await decodePayload(payload);
    const draftKey = `draft:s:${shareId}`;
    const draft = (await dbGet("drafts", draftKey)) || {
      key: draftKey,
      overlayFiles: {},
      deletedFiles: [],
      draftLastActiveFile: null,
      updatedAt: Date.now()
    };

    state.snapshot = {
      shareId,
      baseline,
      draft
    };

    state.project = null;
    state.activeFile = draft.draftLastActiveFile || baseline.lastActiveFile || baseline.files[0]?.name || null;
    ensureMainSnapshot();
    state.activeFile = MAIN_FILE;

    setMode("snapshot");
    renderSnapshot();
  } catch (error) {
    console.error(error);
    showToast("Не удалось открыть снимок.");
    location.hash = "#/";
  }
}

function setMode(mode) {
  state.mode = mode;
  const isProject = mode === "project";
  const isSnapshot = mode === "snapshot";
  if (!isSnapshot) {
    clearTimeout(state.draftTimer);
  }

  els.projectMode.textContent = isProject ? "Проект" : "Снимок";
  els.snapshotBanner.classList.toggle("hidden", !isSnapshot);
  if (els.topbarRight) {
    els.topbarRight.classList.toggle("snapshot-mode", isSnapshot);
  }
  els.shareBtn.classList.toggle("hidden", !isProject);
  els.exportBtn.classList.toggle("hidden", !isProject);
  if (els.importBtn) {
    els.importBtn.classList.toggle("hidden", !isProject);
  }
  els.remixBtn.classList.toggle("hidden", !isSnapshot);
  els.resetBtn.classList.toggle("hidden", !isSnapshot);
  els.remixBtn.classList.toggle("snapshot-accent", isSnapshot);
  els.resetBtn.classList.toggle("snapshot-accent", isSnapshot);
  els.saveIndicator.classList.toggle("hidden", !isProject);
  if (els.renameBtn) {
    els.renameBtn.classList.toggle("hidden", !isProject);
  }

  const disableEdits = state.embed.readonly;
  els.editor.readOnly = disableEdits;
  if (state.editorAdapter) {
    state.editorAdapter.setReadOnly(disableEdits);
  }
  els.fileCreate.disabled = disableEdits;
  els.fileRename.disabled = disableEdits;
  els.fileDuplicate.disabled = disableEdits;
  els.fileDelete.disabled = disableEdits;
  if (els.assetInput) {
    els.assetInput.disabled = disableEdits || !isProject;
  }
  if (isMobileViewport()) {
    state.uiCard = "editor";
  }
  applyResponsiveCardState();
}

function renderProject() {
  els.projectTitle.textContent = state.project.title;
  ensureMainFileRecord(state.project.files);
  renderFiles(state.project.files);
  renderAssets(state.project.assets || []);
  updateFileActionState();
  updateEditorContent();
  updateTabs();
  updateSaveIndicator("Сохранено");
  if (state.embed.active && state.embed.autorun) {
    setTimeout(() => runActiveFile(), 200);
  }
  applyResponsiveCardState();
}

function renderSnapshot() {
  const baseline = state.snapshot.baseline;
  els.projectTitle.textContent = baseline.title || "Общий снимок";
  renderFiles(getEffectiveFiles());
  renderAssets([]);
  updateFileActionState();
  updateEditorContent();
  updateTabs();
  updateSaveIndicator("Локальный черновик");
  if (state.embed.active && state.embed.autorun) {
    setTimeout(() => runActiveFile(), 200);
  }
  applyResponsiveCardState();
}

function renderFiles(files) {
  els.fileList.innerHTML = "";
  files.forEach((file) => {
    const item = document.createElement("div");
    item.className = "file-item" + (file.name === state.activeFile ? " active" : "");
    const dot = String(file.name).lastIndexOf(".");
    const base = dot > 0 ? file.name.slice(0, dot) : file.name;
    const ext = dot > 0 ? file.name.slice(dot) : "";
    item.innerHTML =
      '<svg class="file-ico" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>' +
      '<span class="file-name"></span><span class="file-ext"></span>';
    item.querySelector(".file-name").textContent = base;
    item.querySelector(".file-ext").textContent = ext;
    item.addEventListener("click", () => setActiveFile(file.name));
    els.fileList.appendChild(item);
  });
}

function renderAssets(assets) {
  if (!els.assetList) {
    return; // Asset panel is hidden/deprecated
  }
  els.assetList.innerHTML = "";
  if (!assets.length) {
    const empty = document.createElement("div");
    empty.className = "asset-item";
    empty.innerHTML = "<span>Нет ресурсов</span>";
    els.assetList.appendChild(empty);
    return;
  }
  assets.forEach((asset) => {
    const item = document.createElement("div");
    item.className = "asset-item";
    const label = document.createElement("span");
    label.textContent = asset.name;
    const remove = document.createElement("button");
    remove.className = "btn small";
    remove.textContent = "Удалить";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      removeAsset(asset.name);
    });
    item.append(label, remove);
    els.assetList.appendChild(item);
  });
}

function updateTabs() {
  const files = getCurrentFiles();
  els.fileTabs.innerHTML = "";
  files.forEach((file) => {
    const tab = document.createElement("div");
    tab.className = "tab" + (file.name === state.activeFile ? " active" : "");
    tab.textContent = file.name;
    tab.dataset.name = file.name;
    tab.addEventListener("click", () => setActiveFile(file.name));
    els.fileTabs.appendChild(tab);
  });
}

function setActiveFile(name) {
  state.activeFile = name;
  if (state.mode === "project") {
    state.project.lastActiveFile = name;
    scheduleSave();
  } else if (state.mode === "snapshot") {
    state.snapshot.draft.draftLastActiveFile = name;
    scheduleDraftSave();
  }
  updateFileActionState();
  renderFiles(getCurrentFiles());
  updateTabs();
  updateEditorContent();
}

function updateFileActionState() {
  const locked = state.activeFile === MAIN_FILE;
  if (els.fileRename) {
    els.fileRename.disabled = locked || state.embed.readonly;
  }
  if (els.fileDelete) {
    els.fileDelete.disabled = locked || state.embed.readonly;
  }
}

function updateEditorContent() {
  const file = getFileByName(state.activeFile);
  const next = file ? file.content : "";
  if (state.editorAdapter) {
    state.editorAdapter.setValue(next);
    state.editorAdapter.focus();
  } else {
    els.editor.value = next;
    els.editor.focus();
  }
  refreshEditorDecorations();
  syncEditorScroll();
}

function onEditorInput(event) {
  const file = getFileByName(state.activeFile);
  if (!file || state.embed.readonly) {
    refreshEditorDecorations();
    return;
  }

  const content = event?.target === els.editor
    ? String(els.editor?.value || "")
    : getEditorValue();
  if (state.mode === "project") {
    file.content = content;
    scheduleSave();
  } else if (state.mode === "snapshot") {
    updateDraftFile(state.activeFile, content);
  }
  refreshEditorDecorations();
  syncEditorScroll();
}

function onEditorKeydown(event) {
  if (!state.editorAdapter || typeof state.editorAdapter.handleKeydown !== "function") {
    return;
  }
  state.editorAdapter.handleKeydown(event, { tabSize: state.settings.tabSize });
}

function syncEditorScroll() {
  callEditorAdapterMethod("syncDecorationsScroll");
}

function setEditorLineHighlight(lineNumber) {
  if (!Number.isFinite(lineNumber)) {
    return;
  }
  callEditorAdapterMethod("setLineHighlight", lineNumber);
}

function clearEditorLineHighlight() {
  callEditorAdapterMethod("clearLineHighlight");
}

function scrollEditorToLine(lineNumber) {
  callEditorAdapterMethod("scrollToLine", lineNumber);
}

function updateLineHighlightPosition() {
  callEditorAdapterMethod("syncDecorationsScroll");
}

function refreshEditorDecorations() {
  callEditorAdapterMethod("refreshDecorations");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function getDefaultModuleName() {
  const files = getCurrentFiles();
  const existing = new Set(files.map((file) => String(file.name || "").toLowerCase()));
  let index = 1;
  let candidate = `module${index}${DEFAULT_SOURCE_EXTENSION}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `module${index}${DEFAULT_SOURCE_EXTENSION}`;
  }
  return candidate;
}
async function createFile() {
  if (state.embed.readonly) {
    showToast("Режим только чтение.");
    return;
  }
  const defaultName = getDefaultModuleName();
  const name = await promptModal({
    title: "Создать модуль",
    placeholder: defaultName,
    fallbackValue: defaultName,
    confirmText: "Создать"
  });
  if (!name) {
    return;
  }
  const trimmed = name.trim();
  const normalized = normalizeCppFileName(trimmed);
  if (!normalized) {
    showToast("Поддерживаются модули .cpp/.cc/.h/.hpp.");
    return;
  }
  if (!validateFileName(normalized)) {
    showToast("Некорректное имя модуля.");
    return;
  }
  if (getFileByName(normalized)) {
    showToast("Модуль уже существует.");
    return;
  }
  if (getCurrentFiles().length >= CONFIG.MAX_FILES) {
    showToast("Достигнут лимит модулей.");
    return;
  }

  if (state.mode === "project") {
    state.project.files.push({ name: normalized, content: "" });
    state.project.lastActiveFile = normalized;
    scheduleSave();
  } else if (state.mode === "snapshot") {
    const { draft } = state.snapshot;
    draft.overlayFiles[normalized] = "";
    draft.deletedFiles = draft.deletedFiles.filter((item) => item !== normalized);
    draft.draftLastActiveFile = normalized;
    scheduleDraftSave();
  }

  setActiveFile(normalized);
  renderFiles(getCurrentFiles());
  updateTabs();
}

async function renameFile() {
  if (state.embed.readonly) {
    showToast("Режим только чтение.");
    return;
  }
  if (!state.activeFile) {
    return;
  }
  if (state.activeFile === MAIN_FILE) {
    showToast("main.cpp нельзя переименовать.");
    return;
  }
  const nextName = await promptModal({
    title: "Переименовать модуль",
    value: state.activeFile,
    confirmText: "Переименовать"
  });
  if (!nextName) {
    return;
  }
  const trimmed = nextName.trim();
  const normalized = normalizeCppFileName(trimmed);
  if (!normalized) {
    showToast("Поддерживаются модули .cpp/.cc/.h/.hpp.");
    return;
  }
  if (normalized === state.activeFile) {
    return;
  }
  if (!validateFileName(normalized)) {
    showToast("Некорректное имя модуля.");
    return;
  }
  if (getFileByName(normalized)) {
    showToast("Модуль уже существует.");
    return;
  }

  if (state.mode === "project") {
    const file = getFileByName(state.activeFile);
    file.name = normalized;
    state.project.lastActiveFile = normalized;
    scheduleSave();
  } else if (state.mode === "snapshot") {
    renameSnapshotFile(state.activeFile, normalized);
  }

  setActiveFile(normalized);
  renderFiles(getCurrentFiles());
  updateTabs();
}

function renameSnapshotFile(oldName, newName) {
  const { baseline, draft } = state.snapshot;
  const baseFile = baseline.files.find((file) => file.name === oldName);
  const overlayContent = draft.overlayFiles[oldName];

  if (baseFile) {
    draft.deletedFiles = draft.deletedFiles.filter((name) => name !== newName);
    draft.deletedFiles.push(oldName);
    const content = overlayContent ?? baseFile.content;
    draft.overlayFiles[newName] = content;
    delete draft.overlayFiles[oldName];
  } else {
    draft.overlayFiles[newName] = overlayContent ?? "";
    delete draft.overlayFiles[oldName];
  }
  draft.deletedFiles = draft.deletedFiles.filter((name) => name !== newName);
  draft.draftLastActiveFile = newName;
  scheduleDraftSave();
}

async function deleteFile() {
  if (state.embed.readonly) {
    showToast("Режим только чтение.");
    return;
  }
  const name = state.activeFile;
  if (!name) {
    return;
  }
  if (name === MAIN_FILE) {
    showToast("main.cpp нельзя удалить.");
    return;
  }
  const ok = await confirmModal({
    title: "Удалить модуль",
    message: `Удалить модуль ${name}?`,
    confirmText: "Удалить"
  });
  if (!ok) {
    return;
  }

  if (state.mode === "project") {
    state.project.files = state.project.files.filter((file) => file.name !== name);
    if (!state.project.files.length) {
      state.project.files.push({ name: MAIN_FILE, content: "" });
    }
    state.project.lastActiveFile = state.project.files[0].name;
    scheduleSave();
  } else if (state.mode === "snapshot") {
    const { baseline, draft } = state.snapshot;
    const baseFile = baseline.files.find((file) => file.name === name);
    if (baseFile) {
      if (!draft.deletedFiles.includes(name)) {
        draft.deletedFiles.push(name);
      }
    }
    delete draft.overlayFiles[name];
    draft.draftLastActiveFile = null;
    scheduleDraftSave();
  }

  setActiveFile(getCurrentFiles()[0]?.name || null);
  renderFiles(getCurrentFiles());
  updateTabs();
  updateEditorContent();
}

async function duplicateFile() {
  if (state.embed.readonly) {
    showToast("Режим только чтение.");
    return;
  }
  const file = getFileByName(state.activeFile);
  if (!file) {
    return;
  }
  const dot = file.name.lastIndexOf(".");
  const baseName = dot > 0 ? file.name.slice(0, dot) : file.name;
  const ext = dot > 0 ? file.name.slice(dot) : DEFAULT_SOURCE_EXTENSION;
  let index = 1;
  let newName = `${baseName}_copy${ext}`;
  while (getFileByName(newName)) {
    index += 1;
    newName = `${baseName}_copy${index}${ext}`;
  }

  if (state.mode === "project") {
    state.project.files.push({ name: newName, content: file.content });
    scheduleSave();
  } else if (state.mode === "snapshot") {
    state.snapshot.draft.overlayFiles[newName] = file.content;
    scheduleDraftSave();
  }

  setActiveFile(newName);
  renderFiles(getCurrentFiles());
  updateTabs();
}

function validateFileName(name) {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return false;
  }
  return VALID_FILENAME.test(name);
}

function normalizeCppFileName(name) {
  if (!name) {
    return null;
  }
  const trimmed = String(name).trim();
  if (!trimmed) {
    return null;
  }
  if (!trimmed.includes(".")) {
    return `${trimmed}${DEFAULT_SOURCE_EXTENSION}`;
  }
  if (!hasSourceExtension(trimmed)) {
    return null;
  }
  return trimmed;
}

function getCurrentFiles() {
  if (state.mode === "project") {
    return state.project.files;
  }
  if (state.mode === "snapshot") {
    return getEffectiveFiles();
  }
  return [];
}

function getFileByName(name) {
  const files = getCurrentFiles();
  return files.find((file) => file.name === name);
}

function getEffectiveFiles() {
  const { baseline, draft } = state.snapshot;
  const map = new Map();
  baseline.files.forEach((file) => map.set(file.name, { ...file }));
  draft.deletedFiles.forEach((name) => map.delete(name));
  Object.entries(draft.overlayFiles).forEach(([name, content]) => {
    map.set(name, { name, content });
  });
  const list = Array.from(map.values());
  ensureMainFileRecord(list);
  return list;
}

function updateDraftFile(name, content) {
  const { baseline, draft } = state.snapshot;
  const baseFile = baseline.files.find((file) => file.name === name);
  const baselineContent = baseFile ? baseFile.content : null;

  if (baselineContent !== null && content === baselineContent) {
    delete draft.overlayFiles[name];
  } else {
    draft.overlayFiles[name] = content;
  }

  draft.deletedFiles = draft.deletedFiles.filter((item) => item !== name);
  draft.draftLastActiveFile = name;
  scheduleDraftSave();
}

/**
 * ЗАКОНСЕРВИРОВАНО: загрузка ресурсов (изображений). Панель «Ресурсы» скрыта;
 * функция оставлена в коде для возможного восстановления в будущем.
 */
async function onAssetUpload(event) {
  if (state.mode !== "project") {
    showToast("Ресурсы доступны только в проектах.");
    return;
  }
  const files = Array.from(event.target.files || []);
  if (!files.length) {
    return;
  }
  for (const file of files) {
    await addAsset(file);
  }
  event.target.value = "";
}

async function addAsset(file) {
  const name = file.name;
  if (!validateFileName(name)) {
    showToast(`Некорректное имя ресурса: ${name}`);
    return;
  }
  if (state.project.assets.find((asset) => asset.name === name)) {
    showToast(`Ресурс уже существует: ${name}`);
    return;
  }
  const blobId = createUuid();
  await dbPut("blobs", { blobId, data: file });
  state.project.assets.push({ name, mime: file.type || "application/octet-stream", blobId });
  scheduleSave();
  renderAssets(state.project.assets);
}

async function removeAsset(name) {
  if (state.mode !== "project") {
    return;
  }
  const asset = state.project.assets.find((item) => item.name === name);
  if (!asset) {
    return;
  }
  await dbDelete("blobs", asset.blobId);
  state.project.assets = state.project.assets.filter((item) => item.name !== name);
  scheduleSave();
  renderAssets(state.project.assets);
}
function toggleTabSize() {
  state.settings.tabSize = state.settings.tabSize === 4 ? 2 : 4;
  saveSettings();
  applyEditorSettings();
}

function toggleWrap() {
  state.settings.wordWrap = !state.settings.wordWrap;
  saveSettings();
  applyEditorSettings();
}

function clampEditorFontSize(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return EDITOR_FONT_DEFAULT;
  }
  return Math.max(EDITOR_FONT_MIN, Math.min(EDITOR_FONT_MAX, Math.round(numeric)));
}

function changeEditorFontSize(delta) {
  const next = clampEditorFontSize((state.settings.editorFontSize || EDITOR_FONT_DEFAULT) + delta);
  if (next === state.settings.editorFontSize) {
    return;
  }
  state.settings.editorFontSize = next;
  saveSettings();
  applyEditorSettings();
}





function applyEditorSettings() {
  const fontSize = clampEditorFontSize(state.settings.editorFontSize);
  state.settings.editorFontSize = fontSize;
  if (els.editorWrap) {
    els.editorWrap.style.setProperty("--code-font-size", `${fontSize}px`);
    els.editorWrap.style.setProperty("--editor-font-size", String(fontSize));
  }
  if (els.editor) {
    els.editor.style.tabSize = state.settings.tabSize;
    els.editor.wrap = state.settings.wordWrap ? "soft" : "off";
    els.editor.style.whiteSpace = state.settings.wordWrap ? "pre-wrap" : "pre";
    els.editor.style.overflowWrap = state.settings.wordWrap ? "break-word" : "normal";
    els.editor.style.wordBreak = state.settings.wordWrap ? "break-word" : "normal";
  }
  if (state.editorAdapter) {
    state.editorAdapter.applySettings({
      tabSize: state.settings.tabSize,
      wordWrap: state.settings.wordWrap,
      editorFontSize: fontSize
    });
  }
  els.tabSizeBtn.textContent = `Таб: ${state.settings.tabSize}`;
  els.wrapBtn.textContent = `Перенос: ${state.settings.wordWrap ? "Вкл" : "Выкл"}`;
  if (els.fontDecBtn) {
    els.fontDecBtn.disabled = fontSize <= EDITOR_FONT_MIN;
  }
  if (els.fontIncBtn) {
    els.fontIncBtn.disabled = fontSize >= EDITOR_FONT_MAX;
  }
  refreshEditorDecorations();
  syncEditorScroll();
}

function loadSettings() {
  const raw = safeLocalGet("shp-settings");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      state.settings = { ...state.settings, ...parsed };
    } catch (error) {
      console.warn("Failed to parse settings", error);
    }
  }
  // Tab size and word wrap are locked to defaults (wrap disabled).
  state.settings.tabSize = CONFIG.TAB_SIZE;
  state.settings.wordWrap = CONFIG.WORD_WRAP;
  state.settings.editorFontSize = clampEditorFontSize(state.settings.editorFontSize);
  applyEditorSettings();
}

function saveSettings() {
  safeLocalSet("shp-settings", JSON.stringify(state.settings));
}

function updateSaveIndicator(text) {
  els.saveIndicator.textContent = text;
}

function scheduleSave() {
  if (state.mode !== "project" || state.embed.active) {
    return;
  }
  updateSaveIndicator("Сохранение...");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    await saveProject(state.project);
    updateSaveIndicator("Сохранено");
  }, 400);
}

function scheduleDraftSave() {
  if (state.mode !== "snapshot") {
    return;
  }
  clearTimeout(state.draftTimer);
  state.draftTimer = setTimeout(async () => {
    if (state.mode !== "snapshot" || !state.snapshot || !state.snapshot.draft) {
      return;
    }
    const draft = state.snapshot.draft;
    draft.updatedAt = Date.now();
    await dbPut("drafts", draft);
  }, 400);
}

async function saveProject(project) {
  project.updatedAt = Date.now();
  await dbPut("projects", project);
}

async function rememberRecent(projectId) {
  const list = await getRecent();
  const next = [projectId, ...list.filter((id) => id !== projectId)].slice(0, 12);
  await dbPut("recent", { key: "recent", list: next });
}

async function renderRecent() {
  const recent = await getRecent();
  els.recentList.innerHTML = "";
  if (!recent.length) {
    const empty = document.createElement("div");
    empty.className = "recent-card";
    empty.innerHTML = "<h3>Пока нет проектов</h3><small>Создайте новый проект, чтобы начать работу.</small>";
    els.recentList.appendChild(empty);
    return;
  }

  for (const id of recent) {
    const project = await dbGet("projects", id);
    if (!project) {
      continue;
    }
    const card = document.createElement("div");
    card.className = "recent-card";
    const title = document.createElement("h3");
    title.textContent = project.title || "Без названия";
    const meta = document.createElement("small");
    meta.textContent = `Обновлено ${new Date(project.updatedAt).toLocaleString()}`;
    const open = document.createElement("button");
    open.className = "btn small recent-open";
    open.textContent = "Открыть";
    open.addEventListener("click", () => {
      location.hash = `#/p/${project.projectId}`;
    });
    const remove = document.createElement("button");
    remove.className = "btn small square danger";
    remove.textContent = "🗑";
    remove.title = "Удалить";
    remove.addEventListener("click", async () => {
      const ok = await confirmModal({
        title: "Удалить проект?",
        message: "Проект будет перемещен в корзину.",
        confirmText: "Удалить"
      });
      if (!ok) {
        return;
      }
      const trash = await getTrash();
      const merged = mergeUniqueIds([project.projectId], trash);
      await dbPut("trash", { key: "trash", list: merged });
      const nextRecent = recent.filter((item) => item !== project.projectId);
      await dbPut("recent", { key: "recent", list: nextRecent });
      await renderRecent();
    });
    const actions = document.createElement("div");
    actions.className = "recent-actions-row";
    actions.append(open, remove);
    card.append(title, meta, actions);
    els.recentList.appendChild(card);
  }
}

async function clearRecentProjects() {
  const recent = await getRecent();
  if (!recent.length) {
    return;
  }
  const ok = await confirmModal({
    title: "Очистить список?",
    message: "Проекты будут перемещены в корзину.",
    confirmText: "Очистить"
  });
  if (!ok) {
    return;
  }
  const trash = await getTrash();
  const merged = mergeUniqueIds(recent, trash);
  await dbPut("trash", { key: "trash", list: merged });
  await dbPut("recent", { key: "recent", list: [] });
  await renderRecent();
}

async function getRecent() {
  const record = await dbGet("recent", "recent");
  return record?.list || [];
}

async function getTrash() {
  const record = await dbGet("trash", "trash");
  return record?.list || [];
}

async function setTrash(list) {
  await dbPut("trash", { key: "trash", list });
}

async function restoreFromTrash(projectId) {
  const project = await dbGet("projects", projectId);
  const recent = await getRecent();
  if (project) {
    const nextRecent = [projectId, ...recent.filter((id) => id !== projectId)].slice(0, 12);
    await dbPut("recent", { key: "recent", list: nextRecent });
  }
  const trash = await getTrash();
  await setTrash(trash.filter((id) => id !== projectId));
  await renderRecent();
}

async function deleteFromTrash(projectId) {
  await dbDelete("projects", projectId);
  const trash = await getTrash();
  await setTrash(trash.filter((id) => id !== projectId));
  const recent = await getRecent();
  if (recent.includes(projectId)) {
    await dbPut("recent", { key: "recent", list: recent.filter((id) => id !== projectId) });
    await renderRecent();
  }
}

async function emptyTrash() {
  const trash = await getTrash();
  if (!trash.length) {
    return;
  }
  for (const id of trash) {
    await dbDelete("projects", id);
  }
  await setTrash([]);
  const recent = await getRecent();
  if (recent.length) {
    const nextRecent = recent.filter((id) => !trash.includes(id));
    await dbPut("recent", { key: "recent", list: nextRecent });
  }
  await renderRecent();
}

async function openTrashModal() {
  const trash = await getTrash();
  if (!trash.length) {
    const html = `
      <div class="modal-card">
        <h3>Корзина</h3>
        <p>Корзина пуста.</p>
        <div class="modal-actions">
          <button class="btn ghost" data-action="close">Закрыть</button>
        </div>
      </div>
    `;
    openModal(html, (action) => {
      if (action === "close") {
        closeModal();
      }
    });
    return;
  }

  const items = [];
  for (const id of trash) {
    const project = await dbGet("projects", id);
    const title = project?.title || "Без названия";
    const updated = project?.updatedAt
      ? `Обновлено ${new Date(project.updatedAt).toLocaleString()}`
      : "Проект не найден";
    items.push(`
      <div class="trash-item">
        <div class="trash-meta">
          <div class="trash-title">${escapeHtml(title)}</div>
          <div class="trash-sub">${escapeHtml(updated)}</div>
        </div>
        <div class="trash-actions">
          <button class="btn small" data-action="restore:${id}">Восстановить</button>
          <button class="btn small danger" data-action="delete:${id}">Удалить</button>
        </div>
      </div>
    `);
  }

  const html = `
    <div class="modal-card">
      <h3>Корзина</h3>
      <div class="trash-list">${items.join("")}</div>
      <div class="modal-actions">
        <button class="btn ghost" data-action="close">Закрыть</button>
        <button class="btn danger" data-action="empty">Очистить корзину</button>
      </div>
    </div>
  `;

  openModal(html, async (action) => {
    if (action === "close") {
      closeModal();
      return;
    }
    if (action === "empty") {
      const ok = await confirmModal({
        title: "Очистить корзину?",
        message: "Проекты будут удалены навсегда.",
        confirmText: "Удалить"
      });
      if (ok) {
        await emptyTrash();
        closeModal();
      }
      return;
    }
    if (action && action.startsWith("restore:")) {
      const projectId = action.slice("restore:".length);
      await restoreFromTrash(projectId);
      closeModal();
      openTrashModal();
      return;
    }
    if (action && action.startsWith("delete:")) {
      const projectId = action.slice("delete:".length);
      const ok = await confirmModal({
        title: "Удалить проект?",
        message: "Проект будет удален навсегда.",
        confirmText: "Удалить"
      });
      if (ok) {
        await deleteFromTrash(projectId);
        closeModal();
        openTrashModal();
      }
    }
  });
}

async function shareProject() {
  if (state.mode !== "project") {
    return;
  }
  const files = state.project.files;
  const assets = state.project.assets || [];
  if (assets.length) {
    showToast("Шеринг недоступен при наличии ресурсов. Используйте экспорт.");
    return;
  }
  if (!validateShareLimits(files)) {
    return;
  }

  const payloadData = {
    title: state.project.title,
    files: files.map((file) => ({ name: file.name, content: file.content })),
    lastActiveFile: state.project.lastActiveFile || files[0]?.name || null
  };
  const payloadJson = JSON.stringify(payloadData);
  const payloadBytes = encoder.encode(payloadJson);

  const { payload, shareId } = await buildPayload(payloadBytes);
  const url = `${location.origin}${location.pathname}#/s/${shareId}?p=${payload}`;
  const safeUrl = escapeHtml(url);
  const modalBody = `
    <div class="modal-card">
      <h3>Ссылка на снимок</h3>
      <p>Неизменяемая ссылка на текущий снимок проекта.</p>
      <input class="modal-input" value="${safeUrl}" readonly />
      <div class="modal-actions">
        <button class="btn ghost" data-action="close">Закрыть</button>
        <button class="btn primary" data-action="copy">Скопировать</button>
      </div>
    </div>
  `;
  openModal(modalBody, (action) => {
    if (action === "copy") {
      copyToClipboard(url);
    }
    closeModal();
  });
}

function validateShareLimits(files) {
  if (files.length > CONFIG.MAX_FILES) {
    showToast("Шеринг недоступен: слишком много модулей.");
    return false;
  }
  let totalBytes = 0;
  for (const file of files) {
    const bytes = encoder.encode(file.content || "").length;
    if (bytes > CONFIG.MAX_SINGLE_FILE_BYTES) {
      showToast(`Шеринг недоступен: модуль ${file.name} слишком большой.`);
      return false;
    }
    totalBytes += bytes;
    if (totalBytes > CONFIG.MAX_TOTAL_TEXT_BYTES) {
      showToast("Шеринг недоступен: проект слишком большой.");
      return false;
    }
  }
  return true;
}

async function buildPayload(payloadBytes) {
  let prefix = "u";
  let bodyBytes = payloadBytes;
  try {
    const compressed = await compressBytes(payloadBytes);
    if (compressed && compressed.length < payloadBytes.length) {
      prefix = "g";
      bodyBytes = compressed;
    }
  } catch (error) {
    console.warn("Compression failed", error);
  }
  const payload = `${prefix}.${base64UrlEncode(bodyBytes)}`;
  const shareId = await computeShareId(bodyBytes);
  return { payload, shareId };
}

async function decodePayload(payload) {
  const [prefix, data] = payload.split(".");
  const bytes = base64UrlDecode(data || payload);
  if (prefix === "g") {
    try {
      const decompressed = await decompressBytes(bytes);
      return JSON.parse(decoder.decode(decompressed));
    } catch (error) {
      console.warn("Decompression failed", error);
    }
  }
  return JSON.parse(decoder.decode(bytes));
}

async function compressBytes(bytes) {
  if ("CompressionStream" in window && typeof Blob !== "undefined" && Blob.prototype && Blob.prototype.stream) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    const response = new Response(stream);
    return new Uint8Array(await response.arrayBuffer());
  }
  return gzipSync(bytes);
}

async function decompressBytes(bytes) {
  if ("DecompressionStream" in window && typeof Blob !== "undefined" && Blob.prototype && Blob.prototype.stream) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const response = new Response(stream);
    return new Uint8Array(await response.arrayBuffer());
  }
  return gunzipSync(bytes);
}

async function computeShareId(bytes) {
  if (typeof crypto !== "undefined" && crypto.subtle && crypto.subtle.digest) {
    try {
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      return base64UrlEncode(new Uint8Array(hash)).slice(0, 12);
    } catch (error) {
      // Fall back to non-crypto hash.
    }
  }
  const h1 = hashBytesFNV1a(bytes, 0x811c9dc5);
  const h2 = hashBytesFNV1a(bytes, 0x811c9dc5 ^ 0xdeadbeef);
  const hex = h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
  return hex.slice(0, 12);
}

function hashBytesFNV1a(bytes, seed) {
  let hash = seed >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
    hash >>>= 0;
  }
  return hash >>> 0;
}

function base64UrlEncode(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(text) {
  const pad = text.length % 4 ? "=".repeat(4 - (text.length % 4)) : "";
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function readBlobData(blob) {
  if (!blob) {
    return new Uint8Array();
  }
  if (blob instanceof Uint8Array) {
    return blob;
  }
  if (ArrayBuffer.isView(blob)) {
    return new Uint8Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
  }
  if (blob instanceof ArrayBuffer) {
    return new Uint8Array(blob);
  }
  if (blob.arrayBuffer) {
    const buffer = await blob.arrayBuffer();
    return new Uint8Array(buffer);
  }
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result || []));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Starts remix flow for current snapshot draft into a persistent project.
 * If user cancels naming modal, snapshot state remains unchanged.
 * @async
 * @returns {Promise<void>}
 */
async function remixSnapshot() {
  if (state.mode !== "snapshot") {
    return;
  }
  const files = getEffectiveFiles();
  const project = await createProjectAndOpen({
    initialTitle: state.snapshot.baseline.title || "Ремикс",
    files,
    lastActiveFile: state.activeFile || files[0]?.name || MAIN_FILE
  });
  if (project) {
    showToast("Ремикс создан: проект сохранён в постоянных.");
  }
}

/**
 * Resets snapshot draft to baseline after confirmation and re-renders snapshot mode.
 * @async
 * @returns {Promise<void>}
 */
async function resetSnapshot() {
  if (state.mode !== "snapshot") {
    return;
  }
  const ok = await confirmModal({
    title: "Сбросить снимок",
    message: "Удалить локальные правки и вернуть общий снимок?",
    confirmText: "Сбросить"
  });
  if (!ok) {
    return;
  }
  const draftKey = state.snapshot.draft.key;
  await dbDelete("drafts", draftKey);
  state.snapshot.draft = {
    key: draftKey,
    overlayFiles: {},
    deletedFiles: [],
    draftLastActiveFile: null,
    updatedAt: Date.now()
  };
  const baselineLastActive = state.snapshot.baseline.lastActiveFile;
  const hasBaselineLastActive = state.snapshot.baseline.files.some((file) => file.name === baselineLastActive);
  state.activeFile = hasBaselineLastActive ? baselineLastActive : MAIN_FILE;
  ensureMainSnapshot();
  renderSnapshot();
}

async function restartIdeWithCacheClear() {
  const ok = await confirmModal({
    title: "Перезапуск IDE",
    message: "IDE будет перезапущена. Локальные данные и кеш будут очищены. Несохранённые изменения пропадут.",
    confirmText: "Перезапустить"
  });
  if (!ok) {
    return;
  }
  setGuardMessage("Перезапуск", "Очищаем кеш и перезагружаем IDE...");
  showGuard(true);
  try {
    if (state.db) {
      try {
        state.db.close();
      } catch (error) {
        console.warn("Failed to close db", error);
      }
    }
    if ("indexedDB" in window) {
      await new Promise((resolve) => {
        let request = null;
        try {
          request = indexedDB.deleteDatabase("mshp-ide-skulpt");
        } catch (error) {
          console.warn("IndexedDB delete failed", error);
          resolve();
          return;
        }
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    }
    if ("caches" in window) {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch (error) {
        console.warn("CacheStorage delete failed", error);
      }
    }
    try {
      if ("sessionStorage" in window) {
        sessionStorage.clear();
      }
    } catch (error) {
      console.warn("SessionStorage clear failed", error);
    }
    try {
      if ("localStorage" in window) {
        const keys = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (key && (key.startsWith("shp-") || key.startsWith("mshp-"))) {
            keys.push(key);
          }
        }
        keys.forEach((key) => localStorage.removeItem(key));
      }
    } catch (error) {
      console.warn("LocalStorage clear failed", error);
    }
  } finally {
    location.reload();
  }
}

async function renameProject() {
  if (state.mode !== "project" || !state.project) {
    return;
  }
  const currentTitle = state.project.title || "Без названия";
  const modalBody = `
    <div class="modal-card">
      <h3>Переименовать проект</h3>
      <input type="text" id="rename-input" class="modal-input" value="${currentTitle.replace(/"/g, "&quot;")}" placeholder="Введите название..." />
      <div class="modal-actions">
        <button class="btn ghost" data-action="close">Отмена</button>
        <button class="btn primary" data-action="confirm">Сохранить</button>
      </div>
    </div>
  `;
  openModal(modalBody, async (action) => {
    if (action === "confirm") {
      const input = document.getElementById("rename-input");
      const newTitle = input ? input.value.trim() : "";
      if (newTitle && newTitle !== currentTitle) {
        state.project.title = newTitle;
        state.project.updatedAt = Date.now();
        await saveProject(state.project);
        renderProject();
        showToast("Проект переименован");
      }
    }
    closeModal();
  });

  // Handle Enter key for rename modal
  const input = document.getElementById("rename-input");
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const confirmBtn = els.modal.querySelector('[data-action="confirm"]');
        if (confirmBtn) confirmBtn.click();
      }
    });
    setTimeout(() => input.focus(), 100);
  }
}

async function exportProject() {
  if (state.mode !== "project") {
    return;
  }
  const modalBody = `
    <div class="modal-card">
      <h3>Экспорт проекта</h3>
      <p>Выберите формат экспорта.</p>
      <div class="modal-actions">
        <button class="btn ghost" data-action="close">Отмена</button>
        <button class="btn" data-action="json">JSON</button>
        <button class="btn primary" data-action="zip">ZIP</button>
      </div>
    </div>
  `;
  openModal(modalBody, async (action) => {
    if (action === "json") {
      await exportAsJson();
    }
    if (action === "zip") {
      await exportAsZip();
    }
    closeModal();
  });
}

async function importFiles(files) {
  if (state.mode !== "project" || state.embed.readonly) {
    return;
  }
  const imports = [];
  let skipped = 0;
  for (const file of files) {
    const name = String(file.name || "");
    const lower = name.toLowerCase();
    if (hasSourceExtension(lower)) {
      const content = await file.text();
      imports.push({ name, content });
      continue;
    }
    if (lower.endsWith(".zip")) {
      const buffer = await file.arrayBuffer();
      const items = extractPyFromZip(new Uint8Array(buffer));
      imports.push(...items);
      continue;
    }
    if (lower.endsWith(".json")) {
      const text = await file.text();
      const items = extractPyFromJson(text);
      if (!items) {
        showToast("Некорректный JSON для импорта.");
        return;
      }
      imports.push(...items);
      continue;
    }
    skipped += 1;
  }
  if (!imports.length) {
    showToast("Не найдено файлов .cpp/.h для импорта.");
    return;
  }
  if (skipped) {
    showToast("Некоторые файлы пропущены (поддерживаются .cpp/.h/.hpp, .zip, .json).");
  }
  await applyImportedFiles(imports);
}

function extractPyFromZip(bytes) {
  const out = [];
  let entries = {};
  try {
    entries = unzipSync(bytes);
  } catch (error) {
    console.warn("Zip import failed", error);
    showToast("Не удалось прочитать ZIP архив.");
    return out;
  }
  for (const [entryName, data] of Object.entries(entries)) {
    if (!entryName || entryName.endsWith("/")) {
      continue;
    }
    if (!hasSourceExtension(entryName)) {
      continue;
    }
    const base = getBaseName(entryName);
    const content = decoder.decode(data);
    out.push({ name: base, content });
  }
  return out;
}

function extractPyFromJson(text) {
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    return null;
  }
  if (!payload || payload.version !== 1 || !payload.project || !Array.isArray(payload.project.files)) {
    return null;
  }
  const out = [];
  let skippedAssets = false;
  if (Array.isArray(payload.project.assets) && payload.project.assets.length) {
    skippedAssets = true;
  }
  for (const file of payload.project.files) {
    if (!file || !file.name) {
      continue;
    }
    const name = String(file.name);
    if (!hasSourceExtension(name)) {
      continue;
    }
    out.push({ name, content: String(file.content || "") });
  }
  if (skippedAssets) {
    showToast("Ресурсы из JSON сейчас не импортируются.");
  }
  return out;
}

function isNameTaken(name, added) {
  return Boolean(getFileByName(name) || added.has(name));
}

async function applyImportedFiles(imports) {
  const added = new Set();
  let changed = false;
  let applyAllAction = null;
  for (const item of imports) {
    const normalized = normalizeCppFileName(item.name);
    if (!normalized || !validateFileName(normalized)) {
      showToast(`Некорректное имя файла: ${item.name}`);
      continue;
    }
    if (isNameTaken(normalized, added)) {
      const decision = await resolveImportConflict(normalized, applyAllAction, added);
      if (decision.action === "cancelAll") {
        return;
      }
      if (decision.applyAll && decision.action !== "none") {
        applyAllAction = decision.action;
      }
      if (decision.action === "skip") {
        continue;
      }
      if (decision.action === "replace") {
        const target = getFileByName(normalized);
        if (target) {
          target.content = item.content || "";
          changed = true;
        }
        continue;
      }
      if (decision.action === "rename") {
        const finalName = decision.newName;
        if (!finalName) {
          continue;
        }
        state.project.files.push({ name: finalName, content: item.content || "" });
        added.add(finalName);
        changed = true;
        continue;
      }
    } else {
      state.project.files.push({ name: normalized, content: item.content || "" });
      added.add(normalized);
      changed = true;
    }
  }
  if (changed) {
    renderProject();
    scheduleSave();
  }
}

async function resolveImportConflict(name, applyAllAction, added) {
  if (applyAllAction === "replace") {
    return { action: "replace", applyAll: false };
  }
  if (applyAllAction === "rename") {
    const autoName = createNumberedImportName(name, (candidate) => isNameTaken(candidate, added));
    return { action: "rename", applyAll: false, newName: autoName };
  }
  if (applyAllAction === "cancel") {
    return { action: "cancelAll", applyAll: false };
  }
  return new Promise((resolve) => {
    const autoName = createNumberedImportName(name, (candidate) => isNameTaken(candidate, added));
    const html = `
      <div class="modal-card modal-card-fit">
        <h3>Файл уже существует</h3>
        <p>Модуль <span class="modal-file-name">${escapeHtml(name)}</span> уже есть. Что сделать?</p>
        <label class="modal-check">
          <input type="checkbox" id="import-apply-all" />
          Применить ко всем конфликтам
        </label>
        <input class="modal-input" id="import-new-name" value="${escapeHtml(autoName)}" />
        <div class="modal-actions">
          <button class="btn ghost" data-action="cancel">Отмена</button>
          <button class="btn" data-action="replace">Заменить</button>
          <button class="btn primary" data-action="rename">Импортировать с новым именем</button>
        </div>
      </div>
    `;
    openModal(html, (action) => {
      const applyAll = Boolean(els.modal.querySelector("#import-apply-all")?.checked);
      if (action === "replace") {
        closeModal();
        resolve({ action: "replace", applyAll });
        return;
      }
      if (action === "rename") {
        const input = els.modal.querySelector("#import-new-name");
        const value = input ? input.value : "";
        const normalized = normalizeCppFileName(value);
        if (!normalized || !validateFileName(normalized) || isNameTaken(normalized, added)) {
          showToast("Некорректное или занятое имя файла.");
          return;
        }
        closeModal();
        resolve({ action: "rename", applyAll, newName: normalized });
        return;
      }
      closeModal();
      resolve({ action: applyAll ? "cancelAll" : "skip", applyAll });
    });
    const input = els.modal.querySelector("#import-new-name");
    if (input) {
      input.focus();
      input.select();
    }
  });
}

async function exportAsJson() {
  const assets = [];
  for (const asset of state.project.assets) {
    const blobRecord = await dbGet("blobs", asset.blobId);
    if (!blobRecord) {
      continue;
    }
    const buffer = await readBlobData(blobRecord.data);
    const base64 = base64UrlEncode(buffer);
    assets.push({
      name: asset.name,
      mime: asset.mime,
      dataBase64: base64
    });
  }
  const payload = {
    version: 1,
    project: {
      title: state.project.title,
      files: state.project.files,
      assets
    }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `${state.project.title || "proekt"}.json`);
}

async function exportAsZip() {
  const entries = [];
  state.project.files.forEach((file) => {
    entries.push({ name: file.name, data: encoder.encode(file.content || "") });
  });
  for (const asset of state.project.assets) {
    const blobRecord = await dbGet("blobs", asset.blobId);
    if (!blobRecord) {
      continue;
    }
    const buffer = await readBlobData(blobRecord.data);
    entries.push({ name: asset.name, data: buffer });
  }

  const zipBytes = createZip(entries);
  const blob = new Blob([zipBytes], { type: "application/zip" });
  downloadBlob(blob, `${state.project.title || "proekt"}.zip`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createZip(entries) {
  const fileHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    fileHeaders.push(localHeader, data);
    centralHeaders.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralSize = centralHeaders.reduce((sum, part) => sum + part.length, 0);
  const centralOffset = offset;

  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  endView.setUint16(20, 0, true);

  return concatArrays([...fileHeaders, ...centralHeaders, endRecord]);
}

function concatArrays(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
}

function crc32(data) {
  let crc = 0 ^ -1;
  for (let i = 0; i < data.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();
function clearConsole() {
  els.consoleOutput.textContent = "";
  state.outputBytes = 0;
}

/** Метка сегмента консоли (КОМПИЛЯЦИЯ / ВЫВОД ПРОГРАММЫ) — как в макете. */
function appendConsoleLabel(text) {
  const label = document.createElement("div");
  label.className = "seg-label";
  label.textContent = text;
  els.consoleOutput.appendChild(label);
  els.consoleOutput.scrollTop = els.consoleOutput.scrollHeight;
}

/** Строка консоли в стиле макета (.c-prompt / .c-ok / .c-dim). */
function appendConsoleStyled(text, className) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = String(text ?? "");
  els.consoleOutput.appendChild(span);
  els.consoleOutput.appendChild(document.createElement("br"));
  els.consoleOutput.scrollTop = els.consoleOutput.scrollHeight;
}

function appendConsole(text, isError) {
  if (state.outputBytes >= CONFIG.MAX_OUTPUT_BYTES) {
    return;
  }
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!normalized) {
    return;
  }
  const chunkBytes = encoder.encode(normalized).length;
  state.outputBytes += chunkBytes;
  if (state.outputBytes > CONFIG.MAX_OUTPUT_BYTES) {
    els.consoleOutput.appendChild(document.createTextNode("\n[вывод обрезан]\n"));
    return;
  }
  if (isError) {
    const span = document.createElement("span");
    span.className = "console-error";
    appendConsoleText(span, normalized);
    els.consoleOutput.appendChild(span);
  } else {
    appendConsoleText(els.consoleOutput, normalized);
  }
  els.consoleOutput.scrollTop = els.consoleOutput.scrollHeight;
}

function appendConsoleText(target, text) {
  const parts = String(text).split("\n");
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i]) {
      target.appendChild(document.createTextNode(parts[i]));
    }
    if (i < parts.length - 1) {
      target.appendChild(document.createElement("br"));
    }
  }
}

function updateRunStatus(status) {
  const key = String(status || "").toLowerCase();
  els.runStatus.textContent = RUN_STATUS_LABELS[key] || status;
  els.runStatus.dataset.state = key; // цвет пилюли по состоянию (CSS)
}

function enableConsoleInput() {
  // Поле ввода доступно всегда; реально строки уходят в программу только во время
  // выполнения (sendConsoleLine проверяет state.running).
  if (els.consoleInput) els.consoleInput.disabled = false;
}

/**
 * Отправляет одну строку живого ввода работающей программе (интерактивный std::cin).
 * Эхо строки в консоль (как печатает терминал) + передача в движок. Вне выполнения
 * (state.running === false) ничего не делает.
 */
function sendConsoleLine() {
  if (!state.running || !cppEngine) {
    return;
  }
  const line = els.consoleInput ? els.consoleInput.value : "";
  appendConsoleStyled(line, "c-input"); // эхо введённой строки
  cppEngine.provideInput(line + "\n");
  if (els.consoleInput) els.consoleInput.value = "";
  setConsoleInputWaiting(false);
}

function setConsoleInputWaiting(waiting) {
  state.stdinWaiting = waiting;
  if (!els.consoleInput) {
    return;
  }
  els.consoleInput.classList.toggle("awaiting-input", waiting);
  if (waiting && isMobileViewport()) {
    setUiCard("console");
  }
  if (waiting) {
    els.consoleInput.focus();
    els.consoleInput.select();
  }
}











function initRuntime() {
  // Старт C++-движка (emception). Тулчейн ~25 МБ грузится асинхронно — до готовности
  // запуск заблокирован, статус «Загрузка компилятора…». UX/вёрстка не меняются.
  cppEngine = createCppRuntime({
    baseUrl: CPP_TOOLCHAIN_BASE,
    runTimeoutMs: CONFIG.RUN_TIMEOUT_MS,
    maxOutputBytes: CONFIG.MAX_OUTPUT_BYTES,
    maxFiles: CONFIG.MAX_FILES,
    maxSingleFileBytes: CONFIG.MAX_SINGLE_FILE_BYTES,
    maxTotalTextBytes: CONFIG.MAX_TOTAL_TEXT_BYTES
  });
  state.runtimeReady = false;
  state.runtimeBlocked = false;
  updateRunStatus("loading");
  showGuard(false);
  cppEngine.init().then(() => {
    state.runtimeReady = true;
    updateRunStatus("idle");
  }).catch((error) => {
    state.runtimeBlocked = true;
    setGuardMessage("Компилятор не загрузился", String((error && error.message) || error));
    showGuard(true);
  });
}










function normalizeAssetName(name) {
  if (!name) {
    return "";
  }
  let normalized = String(name);
  if (normalized.startsWith("/project/")) {
    normalized = normalized.slice("/project/".length);
  }
  if (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  return normalized;
}

function getAssetExtension(name) {
  const normalized = normalizeAssetName(name);
  const idx = normalized.lastIndexOf(".");
  if (idx === -1) {
    return "";
  }
  return normalized.slice(idx).toLowerCase();
}


function guessImageMime(name) {
  switch (getAssetExtension(name)) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    default:
      return "application/octet-stream";
  }
}





const TEXT_ASSET_EXTENSIONS = new Set([
  ".py",
  ".cpp",
  ".cc",
  ".cxx",
  ".c",
  ".h",
  ".hpp",
  ".hh",
  ".hxx",
  ".txt",
  ".json",
  ".csv",
  ".md",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".svg"
]);

function decodeAssetBytes(bytes, name) {
  if (!bytes || !bytes.length) {
    return "";
  }
  const lowerName = String(name || "").toLowerCase();
  const dotIndex = lowerName.lastIndexOf(".");
  const ext = dotIndex >= 0 ? lowerName.slice(dotIndex) : "";
  if (!TEXT_ASSET_EXTENSIONS.has(ext)) {
    return bytesToBinaryString(bytes);
  }
  if (typeof TextDecoder !== "undefined") {
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch (error) {
      return bytesToBinaryString(bytes);
    }
  }
  return bytesToBinaryString(bytes);
}

function bytesToBinaryString(bytes) {
  let result = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    result += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return result;
}


function getActiveTabName() {
  if (!els.fileTabs) {
    return null;
  }
  const tab = els.fileTabs.querySelector(".tab.active");
  if (tab && tab.dataset.name) {
    return tab.dataset.name;
  }
  return tab ? tab.textContent : null;
}


function setConsoleLayout(right) {
  if (!els.workspace) {
    return;
  }
  const next = Boolean(right);
  els.workspace.classList.toggle("console-right", next);
  safeLocalSet("shp-console-right", String(next));
  if (els.consoleLayoutToggle) {
    els.consoleLayoutToggle.textContent = next ? "Консоль снизу" : "Консоль справа";
    els.consoleLayoutToggle.setAttribute("aria-pressed", String(next));
  }
  applyResponsiveCardState();
}

function toggleConsoleLayout() {
  if (!els.workspace) {
    return;
  }
  setConsoleLayout(!els.workspace.classList.contains("console-right"));
}


/**
 * Компилирует и запускает main.cpp через cpp-runtime, обновляя состояние IDE.
 * Handles stdin/stdout/stderr wiring and mobile card focus.
 * @async
 * @returns {Promise<void>}
 */
async function runActiveFile() {
  if (state.runtimeBlocked || !state.runtimeReady) {
    showGuard(true);
    return;
  }

  clearEditorLineHighlight();
  const entryName = MAIN_FILE;
  const file = getFileByName(entryName);
  if (!file) {
    showToast("Нет main.cpp.");
    return;
  }
  if (state.activeFile !== MAIN_FILE) {
    setActiveFile(MAIN_FILE);
  }
  clearEditorLineHighlight();

  // Все .cpp/.h/.hpp проекта идут в компиляцию; точка входа — main.cpp.
  const files = getCurrentFiles().map((f) => ({
    name: f.name,
    content: String(f.content ?? "")
  }));

  if (isMobileViewport()) {
    setUiCard("console");
  }
  clearConsole();
  if (els.consoleInput) els.consoleInput.value = "";

  const runToken = state.runToken + 1;
  state.runToken = runToken;
  els.stopBtn.disabled = false;
  updateRunStatus("compiling");

  // --- Компиляция ---
  let compileResult;
  try {
    compileResult = await cppEngine.compile(files, { entry: entryName });
  } catch (error) {
    if (state.runToken !== runToken) return;
    appendConsole(`\n${String((error && error.message) || error)}\n`, true);
    hardStop("error");
    return;
  }
  if (state.runToken !== runToken) return;

  printCompileDiagnostics(compileResult);
  if (!compileResult.ok) {
    hardStop("error");
    return;
  }

  // --- Выполнение (интерактивный ввод) ---
  // Запускаем с пустым stdin. Когда программа доходит до std::cin и буфер пуст,
  // движок шлёт onNeedInput → подсвечиваем поле ввода; пользователь вводит строку
  // вживую (Enter → provideInput), программа продолжается. Как в обычной консоли.
  appendConsoleLabel("Вывод программы");
  updateRunStatus("running");
  state.running = true;
  let runResult;
  try {
    runResult = await cppEngine.run({
      stdin: "",
      onStdout: (text) => appendConsole(text, false),
      onStderr: (text) => appendConsole(text, true),
      onNeedInput: () => setConsoleInputWaiting(true)
    });
  } catch (error) {
    // Сбрасываем running только если это всё ещё НАШ прогон: иначе затрём
    // state.running=true у более нового прогона, перехватившего управление,
    // и его интерактивный ввод перестанет приниматься (sendConsoleLine).
    if (state.runToken !== runToken) return;
    state.running = false;
    appendConsole(`\n${String((error && error.message) || error)}\n`, true);
    hardStop("error");
    return;
  }
  if (state.runToken !== runToken) return;
  state.running = false;
  setConsoleInputWaiting(false);

  if (runResult.timedOut) {
    appendConsole(`\nПревышен лимит времени выполнения (${Math.round(CONFIG.RUN_TIMEOUT_MS / 1000)} с).\n`, true);
    updateRunStatus("error");
  } else if (runResult.error) {
    appendConsole(`\n${runResult.error}\n`, true);
    updateRunStatus("error");
  } else {
    appendConsoleStyled(`Программа завершена с кодом ${runResult.exitCode ?? 0}`,
      runResult.exitCode ? "console-error" : "c-dim");
    updateRunStatus("done");
  }
  if (runResult.truncated) {
    appendConsole(`\n[вывод обрезан]\n`, true);
  }

  els.stopBtn.disabled = true;
}

/**
 * Печатает диагностику компилятора (clang) в консоль: ошибки/предупреждения
 * в формате file:line:col, либо краткую сводку при успехе с предупреждениями.
 */
function printCompileDiagnostics(result) {
  const diagnostics = (result && result.diagnostics) || { items: [], counts: {} };
  const items = (diagnostics.items || []).filter(
    (item) => item.severity === "error" || item.severity === "warning"
  );
  const secs = ((result && result.durationMs ? result.durationMs : 0) / 1000).toFixed(1);

  // Сегмент «Компиляция» (как в макете): команда + результат.
  appendConsoleLabel("Компиляция");
  appendConsoleStyled("$ clang++ -std=c++20 -O2 main.cpp", "c-prompt");

  if (result && result.ok) {
    const warn = (diagnostics.counts && diagnostics.counts.warning) || 0;
    appendConsoleStyled(
      `✓ Сборка успешна · ${secs} с` + (warn ? `, предупреждений: ${warn}` : ""),
      "c-ok"
    );
    for (const item of items) {
      appendDiagnosticLine(item);
    }
    return;
  }
  appendConsoleStyled(`✗ Ошибка компиляции · ${secs} с`, "console-error");
  for (const item of items) {
    appendDiagnosticLine(item);
  }
  if (!items.length && result && result.summary) {
    appendConsole(`${result.summary}\n`, true);
  }
}

/**
 * Добавляет в консоль кликабельную строку диагностики:
 * клик → переход к строке/колонке в редакторе (F4).
 */
function appendDiagnosticLine(item) {
  const span = document.createElement("span");
  span.className = item.severity === "error" ? "console-error" : "";
  span.textContent = `${item.file}:${item.line}:${item.col}: ${item.severity}: ${item.message}`;
  span.style.cursor = "pointer";
  span.style.textDecoration = "underline dotted";
  span.title = "Перейти к строке";
  span.addEventListener("click", () => jumpToDiagnostic(item));
  els.consoleOutput.appendChild(span);
  els.consoleOutput.appendChild(document.createElement("br"));
  els.consoleOutput.scrollTop = els.consoleOutput.scrollHeight;
}

/**
 * Переводит редактор на позицию диагностики (file:line:col) и подсвечивает строку.
 */
function jumpToDiagnostic(item) {
  if (!item || !Number.isFinite(item.line)) {
    return;
  }
  if (item.file && item.file !== state.activeFile && getFileByName(item.file)) {
    setActiveFile(item.file);
  }
  setEditorLineHighlight(item.line);
  scrollEditorToLine(item.line);
  const value = state.editorAdapter ? state.editorAdapter.getValue() : "";
  const offset = lineColToOffset(value, item.line, item.col);
  if (offset != null) {
    callEditorAdapterMethod("setSelection", { start: offset, end: offset });
  }
  callEditorAdapterMethod("focus");
}

// function createStepDebugger etc. removed and archived to archive/step-execution.js

function stopRun() {
  state.runToken += 1;
  // cancelStepSession(); // Removed
  softInterrupt("Stopped by user.");
  hardStop("stopped");
}

function softInterrupt(message) {
  appendConsole(`\n${message}\n`, true);
}


function hardStop(status = "stopped") {
  if (state.runTimeout) {
    clearTimeout(state.runTimeout);
    state.runTimeout = null;
  }
  if (cppEngine) {
    cppEngine.cancelRun();
  }
  state.running = false;
  state.stdinQueue = [];
  setConsoleInputWaiting(false);
  state.stdinResolver = null;
  updateRunStatus(status);
  enableConsoleInput();
  els.stopBtn.disabled = true;
}







function openModal(html, onAction) {
  els.modal.innerHTML = html;
  els.modal.classList.remove("hidden");
  els.modal.setAttribute("aria-hidden", "false");

  const buttons = els.modal.querySelectorAll("[data-action]");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-action");
      if (onAction) {
        onAction(action);
      }
    });
  });
}

function closeModal() {
  els.modal.classList.add("hidden");
  els.modal.setAttribute("aria-hidden", "true");
  els.modal.innerHTML = "";
}

function showHotkeysModal() {
  const title = "\u0413\u043e\u0440\u044f\u0447\u0438\u0435 \u043a\u043b\u0430\u0432\u0438\u0448\u0438";
  const runLabel = "\u0437\u0430\u043f\u0443\u0441\u043a";
  const html = `
    <div class="modal-card">
      <h3>${title}</h3>
      <ul class="hotkeys-list">
        <li><strong>F8</strong> или <strong>Alt+R</strong> — ${runLabel}</li>
        <li><strong>Alt+X</strong> — Остановить выполнение</li>
        <li><strong>Alt+C</strong> — Очистить консоль</li>
        <li><strong>Alt+1</strong> — Фокус на редактор кода</li>
        <li><strong>Alt+2</strong> — Фокус на консоль (для input)</li>
        <li style="margin-top: 10px; border-top: 1px solid var(--border); padding-top: 10px;"><strong>Редактор кода:</strong></li>
        <li><strong>Tab</strong> — Отступ</li>
        <li><strong>Alt+/</strong> — Комментировать строку</li>
        <li><strong>Alt+↑</strong> — Переместить строку вверх</li>
        <li><strong>Alt+↓</strong> — Переместить строку вниз</li>
        <li><strong>Ctrl+D</strong> — Дублировать строку</li>
        <li><strong>Ctrl+Shift+K</strong> — Удалить строку</li>
        <li><strong>Ctrl+L</strong> — Выделить строку</li>
      </ul>
      <div class="modal-actions">
        <button class="btn primary" data-action="close">\u041e\u043a</button>
      </div>
    </div>
  `;
  openModal(html, () => {
    closeModal();
  });
  const button = els.modal.querySelector("[data-action=\"close\"]");
  if (button) {
    button.focus();
  }
}

async function promptModal({ title, placeholder, value, confirmText, fallbackValue }) {
  return new Promise((resolve) => {
    const safeTitle = escapeHtml(String(title || ""));
    const safePlaceholder = escapeHtml(String(placeholder || ""));
    const safeValue = escapeHtml(String(value || ""));
    const safeConfirm = escapeHtml(String(confirmText || "OK"));
    let resolved = false;
    const finish = (action) => {
      if (resolved) {
        return;
      }
      resolved = true;
      if (action === "confirm") {
        const input = els.modal.querySelector(".modal-input");
        let valueText = input ? input.value : "";
        if (!valueText.trim() && fallbackValue !== undefined && fallbackValue !== null) {
          valueText = String(fallbackValue);
        }
        closeModal();
        resolve(valueText);
      } else {
        closeModal();
        resolve(null);
      }
    };
    const html = `
      <div class="modal-card">
        <h3>${safeTitle}</h3>
        <input class="modal-input" value="${safeValue}" placeholder="${safePlaceholder}" />
        <div class="modal-actions">
          <button class="btn ghost" data-action="cancel">Отмена</button>
          <button class="btn primary" data-action="confirm">${safeConfirm}</button>
        </div>
      </div>
    `;
    openModal(html, (action) => finish(action));
    const input = els.modal.querySelector(".modal-input");
    if (input) {
      input.focus();
      if (value) {
        input.select();
      }
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish("confirm");
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish("cancel");
        }
      });
    }
  });
}

async function confirmModal({ title, message, confirmText }) {
  return new Promise((resolve) => {
    const safeTitle = escapeHtml(String(title || ""));
    const safeMessage = escapeHtml(String(message || ""));
    const safeConfirm = escapeHtml(String(confirmText || "Confirm"));
    let resolved = false;
    const finish = (action) => {
      if (resolved) {
        return;
      }
      resolved = true;
      els.modal.removeEventListener("keydown", onKeyDown);
      closeModal();
      resolve(action === "confirm");
    };
    const onKeyDown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish("confirm");
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish("cancel");
      }
    };
    const html = `
      <div class="modal-card">
        <h3>${safeTitle}</h3>
        <p>${safeMessage}</p>
        <div class="modal-actions">
          <button class="btn ghost" data-action="cancel">Отмена</button>
          <button class="btn danger" data-action="confirm">${safeConfirm}</button>
        </div>
      </div>
    `;
    openModal(html, (action) => finish(action));
    const confirmButton = els.modal.querySelector('[data-action="confirm"]');
    if (confirmButton) {
      confirmButton.focus();
    }
    els.modal.addEventListener("keydown", onKeyDown);
  });
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  els.toasts.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      showToast("Ссылка скопирована.");
      return;
    }
  } catch (error) {
    // Fall back to manual copy.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (error) {
    ok = false;
  }
  textarea.remove();
  if (ok) {
    showToast("Ссылка скопирована.");
  } else {
    showToast("Не удалось скопировать.");
  }
}

async function openDb() {
  if (!("indexedDB" in window)) {
    return null;
  }
  return new Promise((resolve) => {
    let request = null;
    try {
      request = indexedDB.open("mshp-ide-skulpt", 2);
    } catch (error) {
      console.warn("IndexedDB open failed", error);
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "projectId" });
      }
      if (!db.objectStoreNames.contains("blobs")) {
        db.createObjectStore("blobs", { keyPath: "blobId" });
      }
      if (!db.objectStoreNames.contains("drafts")) {
        db.createObjectStore("drafts", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("recent")) {
        db.createObjectStore("recent", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("trash")) {
        db.createObjectStore("trash", { keyPath: "key" });
      }
    };
    request.onerror = () => {
      console.warn("IndexedDB error", request.error);
      resolve(null);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function dbGet(storeName, key) {
  if (!state.db) {
    const store = getMemoryStore(storeName);
    return store ? store.get(key) || null : null;
  }
  try {
    return await new Promise((resolve, reject) => {
      const tx = state.db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn("IndexedDB get failed", error);
    state.db = null;
    const store = getMemoryStore(storeName);
    return store ? store.get(key) || null : null;
  }
}

async function dbPut(storeName, value) {
  if (!state.db) {
    const store = getMemoryStore(storeName);
    const key = getStoreKey(storeName, value);
    if (store && key) {
      store.set(key, value);
      return true;
    }
    return false;
  }
  try {
    return await new Promise((resolve, reject) => {
      const tx = state.db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.put(value);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn("IndexedDB put failed", error);
    state.db = null;
    const store = getMemoryStore(storeName);
    const key = getStoreKey(storeName, value);
    if (store && key) {
      store.set(key, value);
      return true;
    }
    return false;
  }
}

async function dbDelete(storeName, key) {
  if (!state.db) {
    const store = getMemoryStore(storeName);
    if (store) {
      store.delete(key);
    }
    return true;
  }
  try {
    return await new Promise((resolve, reject) => {
      const tx = state.db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn("IndexedDB delete failed", error);
    state.db = null;
    const store = getMemoryStore(storeName);
    if (store) {
      store.delete(key);
    }
    return true;
  }
}
