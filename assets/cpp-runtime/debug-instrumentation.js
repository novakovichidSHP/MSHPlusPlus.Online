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

function stripLineComment(line) {
  const idx = line.indexOf("//");
  return idx === -1 ? line : line.slice(0, idx);
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

function extractDeclaredVariables(trimmed) {
  const m = SIMPLE_DECL_RE.exec(trimmed);
  if (!m || !m.groups) return [];
  const type = m.groups.type.replace(/\s+/g, " ");
  return splitDeclarators(m.groups.rest)
    .map((item) => {
      const raw = item.split("=")[0].trim();
      if (/^[*&]/.test(raw)) return null;
      const clean = raw.replace(/^[\s]+/, "");
      const name = clean.match(/^([A-Za-z_]\w*)/)?.[1];
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
    const out = [...DEBUG_PREAMBLE];
    let depth = 0;
    let currentFunction = "<global>";
    const stack = [];
    const scopeVars = [];

    for (let i = 0; i < lines.length; i += 1) {
      const original = lines[i];
      const code = stripLineComment(original);
      const trimmed = code.trim();
      const lineNumber = i + 1;
      const nextFunction = detectFunctionName(trimmed, currentFunction);
      const opens = countChar(code, "{");
      const closes = countChar(code, "}");
      const inFunction = depth > 0 || (opens > closes && nextFunction !== currentFunction);

      if (inFunction && isHookCandidate(trimmed)) {
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
