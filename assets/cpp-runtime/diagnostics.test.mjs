import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiagnostics, summarizeDiagnostics } from "./diagnostics.js";

test("парсит error с позицией и срезает /working/", () => {
  const out = `/working/main.cpp:7:14: error: use of undeclared identifier 'cot'
1 error generated.`;
  const p = parseDiagnostics(out);
  assert.equal(p.counts.error, 1);
  assert.equal(p.items[0].file, "main.cpp");
  assert.equal(p.items[0].line, 7);
  assert.equal(p.items[0].col, 14);
  assert.equal(p.items[0].severity, "error");
  assert.equal(p.firstError.message, "use of undeclared identifier 'cot'");
  assert.equal(p.summary, "1 error generated.");
});

test("различает warning/note и считает их", () => {
  const out = `main.cpp:5:6: warning: unused variable 'x' [-Wunused-variable]
main.cpp:5:6: note: candidate here
2 warnings generated.`;
  const p = parseDiagnostics(out);
  assert.equal(p.counts.warning, 1);
  assert.equal(p.counts.note, 1);
  assert.equal(p.counts.error, 0);
  assert.equal(p.firstError, null);
});

test("fatal error схлопывается в error", () => {
  const p = parseDiagnostics("main.cpp:1:10: fatal error: 'nope.h' file not found");
  assert.equal(p.counts.error, 1);
  assert.equal(p.items[0].severity, "error");
});

test("шум без позиции не ломает разбор", () => {
  const out = `In file included from main.cpp:2:
/working/util.h:3:1: error: expected ';'
em++: warning: linker stuff`;
  const p = parseDiagnostics(out);
  assert.equal(p.counts.error, 1);
  assert.equal(p.items[0].file, "util.h");
});

test("summarize: успех / ошибки / предупреждения", () => {
  assert.equal(summarizeDiagnostics(parseDiagnostics("")), "Сборка успешна");
  assert.equal(
    summarizeDiagnostics(parseDiagnostics("main.cpp:1:1: warning: w")),
    "Сборка успешна, предупреждений: 1"
  );
  assert.equal(
    summarizeDiagnostics(parseDiagnostics("main.cpp:1:1: error: e\nmain.cpp:2:2: warning: w")),
    "Ошибок: 1, предупреждений: 1"
  );
});

test("парсер не падает на null/undefined", () => {
  assert.equal(parseDiagnostics(null).items.length, 0);
  assert.equal(parseDiagnostics(undefined).counts.error, 0);
});

test("summarize: только ошибки (без предупреждений)", () => {
  assert.equal(summarizeDiagnostics(parseDiagnostics("main.cpp:1:1: error: e")), "Ошибок: 1");
});

test("нет main() → синтетическая ошибка в точке входа (аналог LNK2019)", () => {
  const out = `wasm-ld: error: undefined symbol: main
em++: error: linker command failed`;
  const p = parseDiagnostics(out, { entry: "prog.cpp" });
  assert.equal(p.counts.error, 1);
  assert.equal(p.items[0].file, "prog.cpp");
  assert.equal(p.items[0].line, 1);
  assert.equal(p.items[0].severity, "error");
  assert.match(p.items[0].message, /нет функции main/);
  assert.equal(p.firstError.message, p.items[0].message);
});

test("нет main(): entry-форма и символ __main_argc_argv", () => {
  assert.equal(
    parseDiagnostics("wasm-ld: error: entry symbol not defined (pass --no-entry to suppress): main").counts.error,
    1
  );
  assert.equal(
    parseDiagnostics("wasm-ld: error: undefined symbol: __main_argc_argv").counts.error,
    1
  );
});

test("нет main() по умолчанию адресуется в main.cpp", () => {
  const p = parseDiagnostics("wasm-ld: error: undefined symbol: main");
  assert.equal(p.items[0].file, "main.cpp");
});

test("прочая ошибка компоновки даёт человекочитаемую сводку", () => {
  const p = parseDiagnostics("wasm-ld: error: undefined symbol: foo");
  assert.equal(p.counts.error, 0);
  assert.equal(p.summary, "Ошибка компоновки: undefined symbol: foo");
});

test("диагностика служебных файлов тулчейна скрывается (internalFiles)", () => {
  const out = `__cppio.cpp:5:6: warning: unused parameter 'x'
main.cpp:2:2: error: expected ';'
format.h:100:1: warning: shadow`;
  const p = parseDiagnostics(out, { internalFiles: ["__cppio.cpp", "format.h"] });
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].file, "main.cpp");
  assert.equal(p.counts.error, 1);
  assert.equal(p.counts.warning, 0);
});

test("internalFiles работает и с срезкой префикса /working/", () => {
  const out = `/working/__cppio.cpp:5:6: warning: w
/working/main.cpp:1:1: warning: real`;
  const p = parseDiagnostics(out, { internalFiles: ["__cppio.cpp"] });
  assert.equal(p.counts.warning, 1);
  assert.equal(p.items[0].file, "main.cpp");
});

test("реальная ошибка в исходнике важнее ошибки компоновки", () => {
  // Если есть обычная ошибка компиляции — синтетику про main не добавляем.
  const out = `main.cpp:3:1: error: expected ';'
wasm-ld: error: undefined symbol: main`;
  const p = parseDiagnostics(out);
  assert.equal(p.counts.error, 1);
  assert.equal(p.firstError.message, "expected ';'");
});
