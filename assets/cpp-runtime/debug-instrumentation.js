const DEBUG_SOURCE_RE = /\.(cpp|cc|cxx|c\+\+|c|h|hpp|hxx|hh|h\+\+)$/i;

const CONTROL_PREFIX_RE = /^(?:if|else|for|while|do|switch|case|default|try|catch)\b/;
const FUNCTION_HEADER_RE =
  /(?:^|[\s:*&<>~])([A-Za-z_][\w:]*)\s*\([^;{}]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:->\s*[^{}]+)?\s*\{\s*$/;
const SIMPLE_DECL_RE =
  /^\s*(?:(?:const|volatile)\s+)?(?<type>std::string|bool|char|double|float|int|long\s+long|long|short)\s+(?<rest>[^;]+);/;
const DEBUG_PREAMBLE = [
  "#include <string>",
  "#ifndef __CPP_DEBUG_HELPERS",
  "#define __CPP_DEBUG_HELPERS",
  "[[maybe_unused]] static inline std::string __cpp_debug_json_escape(const std::string& value) {",
  "  std::string out;",
  "  for (char ch : value) {",
  "    if (ch == '\\\\') out += \"\\\\\\\\\";",
  "    else if (ch == '\"') out += \"\\\\\\\"\";",
  "    else if (ch == '\\n') out += \"\\\\n\";",
  "    else if (ch == '\\r') out += \"\\\\r\";",
  "    else if (ch == '\\t') out += \"\\\\t\";",
  "    else out += ch;",
  "  }",
  "  return out;",
  "}",
  "[[maybe_unused]] static inline std::string __cpp_debug_value(const std::string& value) { return __cpp_debug_json_escape(value); }",
  "[[maybe_unused]] static inline std::string __cpp_debug_value(char value) { return __cpp_debug_json_escape(std::string(1, value)); }",
  "[[maybe_unused]] static inline std::string __cpp_debug_value(bool value) { return value ? \"true\" : \"false\"; }",
  "template <typename T> [[maybe_unused]] static inline std::string __cpp_debug_value(T value) { return std::to_string(value); }",
  "#endif",
  'extern "C" void __cpp_debug_point(int, int, int, const char*);'
];

export function createDebugKey(file, line) {
  return `${file}:${line}`;
}

function sanitizeCppLine(line, state) {
  const source = String(line || "");
  let out = "";
  let i = 0;
  while (i < source.length) {
    if (state.quote) {
      let escaped = false;
      while (i < source.length) {
        const current = source[i];
        out += " ";
        i += 1;
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === state.quote) {
          state.quote = null;
          break;
        }
      }
      if (state.quote && !escaped) state.quote = null; // invalid unterminated literal
      continue;
    }
    if (state.rawEnd) {
      const end = source.indexOf(state.rawEnd, i);
      if (end === -1) return out + " ".repeat(source.length - i);
      out += " ".repeat(end + state.rawEnd.length - i);
      i = end + state.rawEnd.length;
      state.rawEnd = null;
      continue;
    }
    if (state.blockComment) {
      const end = source.indexOf("*/", i);
      if (end === -1) return out + " ".repeat(source.length - i);
      out += " ".repeat(end + 2 - i);
      i = end + 2;
      state.blockComment = false;
      continue;
    }

    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      return out + " ".repeat(source.length - i);
    }
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      state.blockComment = true;
      continue;
    }

    // C++ raw string: R"tag(contents)tag" (including u8R/uR/UR/LR prefixes,
    // because scanning starts at the R itself). The delimiter cannot contain
    // whitespace, parentheses or backslashes and is at most 16 characters.
    if (ch === "R" && next === '"') {
      const open = source.indexOf("(", i + 2);
      if (open !== -1) {
        const delimiter = source.slice(i + 2, open);
        if (delimiter.length <= 16 && !/[\s()\\]/.test(delimiter)) {
          state.rawEnd = `)${delimiter}"`;
          out += "0" + " ".repeat(open - i);
          i = open + 1;
          continue;
        }
      }
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      // Keep a harmless placeholder so declaration parsing still recognizes
      // direct initialization such as `std::string name("Ann")`.
      out += "0";
      i += 1;
      let escaped = false;
      while (i < source.length) {
        const current = source[i];
        out += " ";
        i += 1;
        if (escaped) {
          escaped = false;
        } else if (current === "\\") {
          escaped = true;
        } else if (current === quote) {
          break;
        }
      }
      if (escaped) state.quote = quote; // escaped newline continues the literal
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}

function tokenizeCpp(lines) {
  const tokens = [];
  const tokenRe = /[A-Za-z_]\w*|[{}()[\];]/g;
  lines.forEach((line, index) => {
    tokenRe.lastIndex = 0;
    let match;
    while ((match = tokenRe.exec(line))) {
      tokens.push({ value: match[0], line: index + 1 });
    }
  });
  return tokens;
}

function matchingToken(tokens, start, open, close) {
  if (tokens[start]?.value !== open) return start;
  let depth = 0;
  for (let i = start; i < tokens.length; i += 1) {
    if (tokens[i].value === open) depth += 1;
    else if (tokens[i].value === close && --depth === 0) return i;
  }
  return tokens.length - 1;
}

function statementEnd(tokens, start) {
  if (start >= tokens.length) return start;
  const value = tokens[start].value;
  if (value === "{") return matchingToken(tokens, start, "{", "}") + 1;

  if (["if", "for", "while", "switch", "catch"].includes(value)) {
    const open = tokens.findIndex((token, index) => index > start && token.value === "(");
    if (open === -1) return start + 1;
    const bodyStart = matchingToken(tokens, open, "(", ")") + 1;
    let end = statementEnd(tokens, bodyStart);
    if (value === "if" && tokens[end]?.value === "else") {
      end = statementEnd(tokens, end + 1);
    }
    return end;
  }

  if (value === "do") {
    let end = statementEnd(tokens, start + 1);
    if (tokens[end]?.value === "while") {
      const open = end + 1;
      end = matchingToken(tokens, open, "(", ")") + 1;
      if (tokens[end]?.value === ";") end += 1;
    }
    return end;
  }

  let parens = 0;
  let brackets = 0;
  for (let i = start; i < tokens.length; i += 1) {
    const token = tokens[i].value;
    if (token === "(") parens += 1;
    else if (token === ")") parens = Math.max(0, parens - 1);
    else if (token === "[") brackets += 1;
    else if (token === "]") brackets = Math.max(0, brackets - 1);
    else if (token === "{" && parens === 0 && brackets === 0) {
      i = matchingToken(tokens, i, "{", "}");
    } else if (token === ";" && parens === 0 && brackets === 0) {
      return i + 1;
    } else if (token === "}" && parens === 0 && brackets === 0) {
      return i;
    }
  }
  return tokens.length;
}

function unsafeHookLines(lines) {
  const tokens = tokenizeCpp(lines);
  const unsafe = new Set();
  const markRange = (start, end) => {
    if (start >= tokens.length || end <= start) return;
    for (let line = tokens[start].line; line <= tokens[end - 1].line; line += 1) unsafe.add(line);
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const value = tokens[i].value;
    if (["if", "for", "while", "switch", "catch"].includes(value)) {
      if (value === "catch") unsafe.add(tokens[i].line); // keep `try` adjacent to its handler
      const open = tokens.findIndex((token, index) => index > i && token.value === "(");
      if (open === -1) continue;
      const bodyStart = matchingToken(tokens, open, "(", ")") + 1;
      const bodyEnd = statementEnd(tokens, bodyStart);
      if (tokens[bodyStart]?.value !== "{") markRange(bodyStart, bodyEnd);
      if (value === "if" && tokens[bodyEnd]?.value === "else") {
        unsafe.add(tokens[bodyEnd].line); // hook between `if` and `else` is invalid
        const elseStart = bodyEnd + 1;
        const elseEnd = statementEnd(tokens, elseStart);
        if (tokens[elseStart]?.value !== "{") markRange(elseStart, elseEnd);
      }
    } else if (value === "do") {
      const bodyStart = i + 1;
      const bodyEnd = statementEnd(tokens, bodyStart);
      if (tokens[bodyStart]?.value !== "{") markRange(bodyStart, bodyEnd);
      if (tokens[bodyEnd]?.value === "while") {
        const trailerEnd = statementEnd(tokens, bodyEnd);
        markRange(bodyEnd, trailerEnd);
      }
    } else if (value === "else") {
      unsafe.add(tokens[i].line);
    }
  }
  return unsafe;
}

function countChar(text, ch) {
  let count = 0;
  for (const c of text) {
    if (c === ch) count += 1;
  }
  return count;
}

function isHookCandidate(trimmed) {
  if (!trimmed) return false;
  if (trimmed.startsWith("#")) return false;
  if (trimmed === "{" || trimmed === "}" || trimmed === "};") return false;
  if (/^(?:public|private|protected)\s*:/.test(trimmed)) return false;
  if (/^(?:namespace|class|struct|enum)\b/.test(trimmed)) return false;
  if (/^\}\s*(?:else|while|catch)\b/.test(trimmed)) return false;
  if (trimmed.endsWith("{") && !CONTROL_PREFIX_RE.test(trimmed)) return false;
  return /[;{}]$/.test(trimmed) || CONTROL_PREFIX_RE.test(trimmed) || /^return\b/.test(trimmed);
}

function detectFunctionName(trimmed, fallback) {
  const m = FUNCTION_HEADER_RE.exec(trimmed);
  if (!m) return fallback;
  const name = m[1].split("::").pop();
  if (!name || CONTROL_PREFIX_RE.test(name)) return fallback;
  return name;
}

function escapeCppString(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function splitDeclarators(rest) {
  const out = [];
  let current = "";
  let depth = 0;
  for (const ch of String(rest || "")) {
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current);
  return out;
}

function hasTopLevelEquals(text) {
  let depth = 0;
  for (const ch of String(text || "")) {
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    else if (ch === "=" && depth === 0) return true;
  }
  return false;
}

function parseInitializedScalarDeclarator(item) {
  const raw = String(item || "").trim();
  if (!raw || /^[*&]/.test(raw)) return null;
  const m = /^([A-Za-z_]\w*)(?<suffix>[\s\S]*)$/.exec(raw);
  if (!m || !m.groups) return null;
  const name = m[1];
  const suffix = m.groups.suffix.trimStart();
  if (suffix.startsWith("[")) return null;
  const initialized = hasTopLevelEquals(raw)
    || suffix.startsWith("{")
    || (suffix.startsWith("(") && !/^\(\s*\)\s*$/.test(suffix));
  return initialized ? name : null;
}

function extractDeclaredVariables(trimmed) {
  const m = SIMPLE_DECL_RE.exec(trimmed);
  if (!m || !m.groups) return [];
  const type = m.groups.type.replace(/\s+/g, " ");
  return splitDeclarators(m.groups.rest)
    .map((item) => {
      const name = parseInitializedScalarDeclarator(item);
      return name ? { name, type } : null;
    })
    .filter(Boolean);
}

function extractFunctionParams(trimmed) {
  const open = trimmed.indexOf("(");
  const close = trimmed.lastIndexOf(")");
  if (open < 0 || close <= open) return [];
  return splitDeclarators(trimmed.slice(open + 1, close))
    .map((item) => {
      const raw = item.split("=")[0].trim();
      if (!raw || raw === "void" || raw.includes("*")) return null;
      const m = /^(?:(?:const|volatile)\s+)?(?<type>std::string|bool|char|double|float|int|long\s+long|long|short)\s*&?\s*(?<name>[A-Za-z_]\w*)$/.exec(raw);
      if (!m || !m.groups) return null;
      return { name: m.groups.name, type: m.groups.type.replace(/\s+/g, " ") };
    })
    .filter(Boolean);
}

function buildVarsExpression(vars) {
  if (!vars.length) return 'std::string("")';
  const parts = ['std::string("{")'];
  vars.forEach((variable, index) => {
    if (index) parts.push(' + ","');
    const name = escapeCppString(variable.name);
    parts.push(` + "\\"${name}\\":\\"" + __cpp_debug_value(${variable.name}) + "\\""`);
  });
  parts.push(' + "}"');
  return parts.join("");
}

export function buildDebugInstrumentation(files, options = {}) {
  const sourceFiles = (files || []).filter((file) => DEBUG_SOURCE_RE.test(file?.name || ""));
  const fileIds = new Map(sourceFiles.map((file, index) => [file.name, index + 1]));
  const functions = [{ id: 0, name: "<global>" }];
  const functionIds = new Map([["<global>", 0]]);
  const points = [];

  const getFunctionId = (name) => {
    const key = name || "<global>";
    if (functionIds.has(key)) return functionIds.get(key);
    const id = functions.length;
    functionIds.set(key, id);
    functions.push({ id, name: key });
    return id;
  };

  const instrumentedFiles = (files || []).map((file) => {
    if (!DEBUG_SOURCE_RE.test(file?.name || "")) {
      return { ...file };
    }
    const fileId = fileIds.get(file.name);
    const lines = String(file.content || "").split(/\r?\n/);
    const lexerState = { blockComment: false, rawEnd: null, quote: null };
    const sanitizedLines = lines.map((line) => sanitizeCppLine(line, lexerState));
    const unsafeLines = unsafeHookLines(sanitizedLines);
    const out = [...DEBUG_PREAMBLE];
    let depth = 0;
    let currentFunction = "<global>";
    const stack = [];
    const scopeVars = [];

    for (let i = 0; i < lines.length; i += 1) {
      const original = lines[i];
      const code = sanitizedLines[i];
      const trimmed = code.trim();
      const lineNumber = i + 1;
      const nextFunction = detectFunctionName(trimmed, currentFunction);
      const opens = countChar(code, "{");
      const closes = countChar(code, "}");
      const inFunction = depth > 0 || (opens > closes && nextFunction !== currentFunction);

      if (inFunction && !unsafeLines.has(lineNumber) && isHookCandidate(trimmed)) {
        const fnId = getFunctionId(currentFunction);
        const indent = original.match(/^\s*/)?.[0] || "";
        const visibleVars = scopeVars.flatMap((scope) => scope.vars);
        out.push(`${indent}{ auto __cpp_debug_vars = ${buildVarsExpression(visibleVars)}; __cpp_debug_point(${fileId}, ${lineNumber}, ${fnId}, __cpp_debug_vars.c_str()); }`);
        points.push({
          id: points.length + 1,
          file: file.name,
          fileId,
          line: lineNumber,
          functionId: fnId,
          functionName: currentFunction
        });
      }

      out.push(original);

      const entersFunction = nextFunction !== currentFunction && opens > closes;
      const functionParams = entersFunction ? extractFunctionParams(trimmed) : [];
      if (entersFunction) {
        stack.push(currentFunction);
        currentFunction = nextFunction;
      }
      const declaredVars = inFunction ? extractDeclaredVariables(trimmed) : [];
      depth += opens - closes;
      if (opens > 0) {
        for (let j = 0; j < opens; j += 1) {
          scopeVars.push({ depth: depth - opens + j + 1, vars: [] });
        }
      }
      if (functionParams.length) {
        if (!scopeVars.length) scopeVars.push({ depth: Math.max(1, depth), vars: [] });
        scopeVars[scopeVars.length - 1].vars.push(...functionParams);
      }
      if (declaredVars.length) {
        if (!scopeVars.length) scopeVars.push({ depth: Math.max(1, depth), vars: [] });
        scopeVars[scopeVars.length - 1].vars.push(...declaredVars);
      }
      while (depth < stack.length && stack.length) {
        currentFunction = stack.pop();
      }
      while (scopeVars.length && scopeVars[scopeVars.length - 1].depth > depth) {
        scopeVars.pop();
      }
      if (depth <= 0) {
        depth = 0;
        currentFunction = "<global>";
        stack.length = 0;
        scopeVars.length = 0;
      }
    }

    return { ...file, content: out.join("\n") };
  });

  return {
    files: instrumentedFiles,
    map: {
      version: 1,
      points,
      files: sourceFiles.map((file) => ({ id: fileIds.get(file.name), name: file.name })),
      functions
    },
    breakpoints: Array.from(options.breakpoints || [])
  };
}
