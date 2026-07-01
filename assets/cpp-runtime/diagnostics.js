/**
 * Парсер диагностики clang/em++ для cpp-runtime.
 *
 * Превращает текстовый вывод компилятора в структуру для UI:
 * кликабельные ссылки «файл:строка:колонка» (задел F4) и сводку.
 *
 * Формат строк clang:
 *   main.cpp:7:14: error: use of undeclared identifier 'cot'
 *   main.cpp:5:6: warning: unused variable 'x' [-Wunused-variable]
 *   /working/util.h:3:1: note: candidate function not viable
 *   In file included from main.cpp:2:
 *   2 errors generated.
 *
 * Парсер устойчив к шуму em++/emscripten (строки без позиции просто
 * попадают в `raw`, но не ломают разбор).
 */

const LINE_RE =
  /^(?<file>[^\s:][^:]*?):(?<line>\d+):(?<col>\d+):\s+(?<severity>error|warning|note|remark|fatal error):\s+(?<message>.*)$/;

// Ошибки компоновки (wasm-ld / em++ / lld) не имеют формата file:line:col —
// они не ложатся в LINE_RE. Ловим их отдельно, чтобы показать человеку внятный
// текст вместо сырого «Ошибка компиляции».
const LINK_ERR_RE =
  /^(?:wasm-ld|em\+\+|emcc|ld(?:\.lld)?|clang(?:\+\+)?):\s*(?:fatal\s+)?error:\s*(.+)$/i;

// Нет функции main() — точки входа. Аналог MSVC LNK2019 / clang «undefined
// symbol: main». emscripten в строгом режиме (IGNORE_MISSING_MAIN=0) даёт один
// из этих текстов. Символ может быть main или __main_argc_argv.
const MISSING_MAIN_RE =
  /undefined symbol:\s*_*main(?:_argc_argv)?\b|entry symbol not defined[^\n]*\bmain\b/i;

const SEVERITY_RANK = { "fatal error": 4, error: 3, warning: 2, note: 1, remark: 0 };

/**
 * @param {string} text — суммарный stdout+stderr компилятора.
 * @param {object} [opts]
 * @param {string} [opts.stripPrefix="/working/"] — префикс пути, который
 *        срезаем у имён файлов, чтобы получить имя как в редакторе (main.cpp).
 * @param {string} [opts.entry="main.cpp"] — имя точки входа; на него ссылается
 *        синтетическая диагностика «нет main()».
 * @param {string[]|Set<string>} [opts.internalFiles] — служебные файлы тулчейна
 *        (после срезки префикса), диагностику которых НЕ показываем пользователю.
 * @returns {{
 *   items: Array<{file:string, line:number, col:number, severity:string, message:string, raw:string}>,
 *   counts: {error:number, warning:number, note:number},
 *   firstError: object|null,
 *   summary: string|null
 * }}
 */
export function parseDiagnostics(text, opts = {}) {
  const stripPrefix = opts.stripPrefix ?? "/working/";
  const internalFiles =
    opts.internalFiles instanceof Set ? opts.internalFiles : new Set(opts.internalFiles || []);
  const items = [];
  const counts = { error: 0, warning: 0, note: 0 };
  let summary = null;

  const linkerErrors = [];

  const lines = String(text ?? "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;

    const m = LINE_RE.exec(line);
    if (m && m.groups) {
      let file = m.groups.file;
      if (stripPrefix && file.startsWith(stripPrefix)) {
        file = file.slice(stripPrefix.length);
      }
      // Диагностику служебных файлов тулчейна не показываем как код студента.
      if (internalFiles.has(file)) continue;
      const severity = m.groups.severity === "fatal error" ? "error" : m.groups.severity;
      const item = {
        file,
        line: Number(m.groups.line),
        col: Number(m.groups.col),
        severity,
        message: m.groups.message,
        raw: line
      };
      items.push(item);
      if (severity === "error") counts.error += 1;
      else if (severity === "warning") counts.warning += 1;
      else if (severity === "note") counts.note += 1;
      continue;
    }

    // «N errors generated.» / «1 warning generated.»
    if (/\b\d+\s+(error|warning)s?\s+generated\./.test(line)) {
      summary = line;
      continue;
    }

    const lk = LINK_ERR_RE.exec(line);
    if (lk) linkerErrors.push(lk[1].trim());
  }

  // Пост-обработка ошибок компоновки. Только если нет обычных ошибок компиляции
  // (иначе первопричина — в исходнике, её и показываем).
  if (counts.error === 0) {
    const fullText = String(text ?? "");
    if (MISSING_MAIN_RE.test(fullText)) {
      // Синтетическая диагностика уровня «нет точки входа» — как ошибка в main.cpp:1,
      // чтобы строка была кликабельной и вела в файл, где нужно завести main().
      const entry = opts.entry || "main.cpp";
      items.unshift({
        file: entry,
        line: 1,
        col: 1,
        severity: "error",
        message: "в программе нет функции main() — точки входа. Добавьте: int main() { … }",
        raw: "undefined symbol: main"
      });
      counts.error += 1;
    } else if (linkerErrors.length) {
      // Прочие ошибки компоновки — показываем первую человеку.
      summary = "Ошибка компоновки: " + linkerErrors[0];
    }
  }

  const firstError = items.find((it) => it.severity === "error") ?? null;
  return { items, counts, firstError, summary };
}

/**
 * Короткая человекочитаемая сводка для блока «Компиляция».
 */
export function summarizeDiagnostics(parsed) {
  const { counts } = parsed;
  if (counts.error > 0) {
    return `Ошибок: ${counts.error}` + (counts.warning ? `, предупреждений: ${counts.warning}` : "");
  }
  if (counts.warning > 0) {
    return `Сборка успешна, предупреждений: ${counts.warning}`;
  }
  return "Сборка успешна";
}

export { SEVERITY_RANK };
