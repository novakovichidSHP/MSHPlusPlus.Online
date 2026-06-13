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
