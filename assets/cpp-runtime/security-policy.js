/** Security policy shared by the compiler facade and the execution worker. */

const FORBIDDEN_JS_IDENTIFIERS = new Set([
  "EM_ASM", "EM_ASM_INT", "EM_ASM_DOUBLE", "EM_ASM_PTR", "EM_ASM_ARGS",
  "MAIN_THREAD_EM_ASM", "MAIN_THREAD_EM_ASM_INT", "MAIN_THREAD_EM_ASM_DOUBLE",
  "EM_JS", "EM_ASYNC_JS",
  "emscripten_run_script", "emscripten_run_script_int", "emscripten_run_script_string",
  "emscripten_async_run_script",
  "emscripten_asm_const_int", "emscripten_asm_const_double", "emscripten_asm_const_ptr"
]);

const CPP_SCAN_RE = /\.(?:cpp|cc|cxx|c\+\+|c|h|hpp|hxx|hh|h\+\+|ipp|tcc|inl)$/i;

const GENERATED_BRIDGE_PATTERNS = [
  // Debug builds from this Emscripten version may emit an empty placeholder.
  // Reject only a table that actually contains user-provided JS bodies; calls
  // into asm-const helpers are checked independently below.
  { api: "ASM_CONSTS", re: /\bASM_CONSTS\s*=\s*\{\s*[^}\s]/ },
  { api: "emscripten_run_script", re: /\b_?emscripten_(?:async_)?run_script(?:_int|_string)?\b/ },
  { api: "emscripten_asm_const", re: /\b_?emscripten_asm_const_(?:int|double|ptr)\b/ },
  // Emscripten keeps EM_JS bodies in a dedicated wasm/custom-section pipeline.
  // These markers vary by version, so accept both spellings used by emcc.
  { api: "EM_JS", re: /(?:__em_js__|\bem_js\b)/i }
];

/**
 * Replace comments and C/C++ string/character/raw-string literals with spaces,
 * preserving newlines and offsets so diagnostics still point at the source.
 */
export function stripCxxCommentsAndLiterals(source) {
  const text = String(source ?? "");
  const out = Array.from(text);
  let i = 0;
  const blank = (from, to) => {
    for (let j = from; j < to; j++) if (out[j] !== "\n" && out[j] !== "\r") out[j] = " ";
  };
  while (i < text.length) {
    if (text.startsWith("//", i)) {
      const end = text.indexOf("\n", i + 2);
      const stop = end < 0 ? text.length : end;
      blank(i, stop); i = stop; continue;
    }
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      blank(i, stop); i = stop; continue;
    }
    // C++ raw strings: optional encoding prefix followed by R"delimiter(... )delimiter".
    const raw = /^(?:u8|u|U|L)?R"([^ ()\\\t\r\n]{0,16})\(/.exec(text.slice(i));
    if (raw) {
      const terminator = `)${raw[1]}"`;
      const end = text.indexOf(terminator, i + raw[0].length);
      const stop = end < 0 ? text.length : end + terminator.length;
      blank(i, stop); i = stop; continue;
    }
    const quoted = /^(?:u8|u|U|L)?(["'])/.exec(text.slice(i));
    if (quoted) {
      const quote = quoted[1];
      let j = i + quoted[0].length;
      while (j < text.length) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === quote) { j++; break; }
        j++;
      }
      blank(i, j); i = j; continue;
    }
    i++;
  }
  return out.join("");
}

function collapseTokenPastes(source) {
  let current = source;
  // Resolve direct token concatenation such as emscripten_ ## run_script. This
  // is deliberately repeated because a name may be assembled from >2 tokens.
  for (let i = 0; i < 16; i++) {
    const next = current.replace(/\b([A-Za-z_]\w*)\s*##\s*([A-Za-z_]\w*)\b/g, "$1$2");
    if (next === current) break;
    current = next;
  }
  return current;
}

/** Find forbidden Emscripten JS bridge identifiers in user-authored C/C++. */
export function findForbiddenJs(files) {
  for (const f of files || []) {
    if (!f || typeof f.name !== "string" || !CPP_SCAN_RE.test(f.name)) continue;
    const clean = collapseTokenPastes(stripCxxCommentsAndLiterals(f.content));
    const tokenRe = /\b[A-Za-z_]\w*\b/g;
    let match;
    while ((match = tokenRe.exec(clean))) {
      if (!FORBIDDEN_JS_IDENTIFIERS.has(match[0])) continue;
      const before = clean.slice(0, match.index);
      const lines = before.split(/\r?\n/);
      return {
        name: f.name,
        line: lines.length,
        col: lines[lines.length - 1].length + 1,
        api: match[0]
      };
    }
  }
  return null;
}

/** Mandatory post-link check: generated JS must not contain JS bridge glue. */
export function inspectGeneratedModuleSecurity(moduleJs) {
  const text = String(moduleJs ?? "");
  for (const item of GENERATED_BRIDGE_PATTERNS) {
    if (item.re.test(text)) return { ok: false, api: item.api };
  }
  return { ok: true, api: null };
}

const NETWORK_GLOBALS = [
  "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "importScripts",
  "Worker", "SharedWorker", "BroadcastChannel", "indexedDB", "caches"
];

/**
 * Remove ambient network entry points before evaluating untrusted generated JS.
 * Non-configurable properties prevent EM_JS/ASM code from restoring them.
 */
export function lockDownNetworkCapabilities(scope = globalThis) {
  const blocked = function blockedNetworkCapability() {
    throw new Error("Network access is disabled for C++ programs");
  };
  // SINGLE_FILE Emscripten still instantiates its embedded wasm through
  // fetch(data:...). Keep precisely that non-network operation and reject every
  // URL that could reach the current origin or the Internet.
  const originalFetch = typeof scope.fetch === "function" ? scope.fetch.bind(scope) : null;
  const RequestCtor = typeof scope.Request === "function" ? scope.Request : null;
  const dataOnlyFetch = function dataOnlyFetch(input, init) {
    const url = typeof input === "string"
      ? input
      : (RequestCtor && input instanceof RequestCtor ? input.url : null);
    if (!originalFetch || typeof url !== "string" || !url.startsWith("data:")) {
      throw new Error("Network access is disabled for C++ programs");
    }
    return originalFetch(input, init);
  };
  try {
    Object.defineProperty(scope, "fetch", {
      value: dataOnlyFetch,
      writable: false,
      configurable: false,
      enumerable: false
    });
  } catch {
    try { scope.fetch = dataOnlyFetch; } catch { /* best effort on exotic hosts */ }
  }
  for (const name of NETWORK_GLOBALS) {
    try {
      Object.defineProperty(scope, name, {
        value: blocked,
        writable: false,
        configurable: false,
        enumerable: false
      });
    } catch {
      try { scope[name] = blocked; } catch { /* best effort on exotic hosts */ }
    }
  }
  return ["fetch", ...NETWORK_GLOBALS];
}
