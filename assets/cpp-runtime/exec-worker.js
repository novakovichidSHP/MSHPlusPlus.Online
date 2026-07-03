/**
 * exec-worker — изолированный запуск скомпилированной C++-программы
 * с ИНТЕРАКТИВНЫМ вводом (как в классической консоли).
 *
 * Живёт в отдельном Web Worker'е (classic), чтобы:
 *   • не блокировать UI во время выполнения;
 *   • жёстко прерывать программу через worker.terminate() из фасада.
 *
 * Интерактивный ввод: модуль скомпилирован с -sASYNCIFY + кастомный streambuf
 * (см. cpp-runtime: __cppio.cpp / inlib.js), который читает std::cin через
 * импорт __cpp_get_char → Module.__tryByte()/__waitByte(). Когда буфер ввода
 * пуст, программа ПРИОСТАНАВЛИВАЕТСЯ (Asyncify) и worker шлёт 'need-input';
 * главный поток присылает {type:'input', text}, выполнение продолжается.
 *
 * Контракт сообщений:
 *   IN : { moduleJs, stdin, files, maxOutputBytes } — старт (files — данные в /work)
 *        { type:'input', text }                — порция ввода от пользователя
 *   OUT: { type:'ready' }                      — worker загрузился
 *        { type:'stdout'|'stderr', chunk }     — вывод программы
 *        { type:'need-input' }                 — программа ждёт ввод (cin)
 *        { type:'output-files', files }        — файлы, записанные программой в /work
 *        { type:'truncated' }                  — достигнут лимит вывода
 *        { type:'done', exitCode }             — программа завершилась
 *        { type:'error', message }             — ошибка выполнения/инстанса
 */

import { applyDebugCommand, createDebugSession, evaluateDebugPoint } from "./debug-state.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let started = false;
let inputBytes = new Uint8Array(0);
let inputPtr = 0;
let debugSession = null;

// Добавить порцию пользовательского ввода в буфер (busy-poll в C++ его подхватит).
function feedInput(text) {
  const add = encoder.encode(String(text ?? ""));
  if (!add.length) return;
  const merged = new Uint8Array(inputBytes.length + add.length);
  merged.set(inputBytes);
  merged.set(add, inputBytes.length);
  inputBytes = merged;
}

self.onmessage = (event) => {
  const m = event.data || {};
  if (m.type === "input") {
    feedInput(m.text);
    return;
  }
  if (m.type === "debug-command") {
    if (applyDebugCommand(debugSession, m.command)) {
      self.postMessage({ type: "debug-resumed" });
    }
    return;
  }
  if (started) return;
  started = true;
  start(m);
};

// Рабочий каталог программы в MEMFS: туда кладём файлы-данные и оттуда
// собираем то, что программа записала (файловый вывод).
const WORKDIR = "/work";

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function postDebugPaused(frame) {
  self.postMessage({ type: "debug-paused", frame });
}

async function start({ moduleJs, stdin, files, maxOutputBytes, debug }) {
  if (typeof moduleJs !== "string") {
    self.postMessage({ type: "error", message: "exec-worker: нет moduleJs" });
    return;
  }
  inputBytes = encoder.encode(typeof stdin === "string" ? stdin : "");
  inputPtr = 0;
  debugSession = createDebugSession(debug);
  const cap = Number.isFinite(maxOutputBytes) ? maxOutputBytes : 2_000_000;

  // Файлы-данные проекта (вход) и снимок того, что мы записали — чтобы потом
  // отличить созданные/изменённые программой файлы от неизменённых входных.
  const inputFiles = Array.isArray(files) ? files : [];
  const inputSnapshot = new Map(); // name -> Uint8Array
  let runtimeFS = null;            // ссылка на FS модуля (захватываем в preRun)

  let outputBytes = 0;
  let truncated = false;
  let finished = false;

  // Собрать файлы, созданные/изменённые программой в /work (файловый вывод).
  function collectOutputFiles() {
    if (!runtimeFS) return [];
    let entries;
    try { entries = runtimeFS.readdir(WORKDIR); } catch (e) { return []; }
    const out = [];
    for (const name of entries) {
      if (name === "." || name === "..") continue;
      let data;
      try {
        const path = WORKDIR + "/" + name;
        if (runtimeFS.isDir(runtimeFS.stat(path).mode)) continue; // без подкаталогов
        data = runtimeFS.readFile(path); // Uint8Array
      } catch (e) { continue; }
      const prev = inputSnapshot.get(name);
      if (prev && sameBytes(prev, data)) continue; // неизменённый вход — пропускаем
      // СВОЙ декодер: общий `decoder` работает в потоковом режиме (__outWrite) и
      // может держать «хвост» от stdout — нельзя смешивать с содержимым файла.
      out.push({ name, content: new TextDecoder().decode(data) });
    }
    return out;
  }

  // ВАЖНО (доказано замером): при -sASYNCIFY+EXIT_RUNTIME, когда main
  // приостанавливается на std::cin (asyncify-разворот стека), ЛОЖНО срабатывают
  // сразу ТРИ сигнала: Module.quit(0), резолв промиса фабрики и ExitStatus-реджект.
  // А вот Module.onExit стреляет СТРОГО на реальном завершении программы (после
  // того как main по-настоящему вернулся). Поэтому «done» шлём ТОЛЬКО по onExit;
  // quit и резолв/ExitStatus-реджект фабрики НЕ считаем завершением.
  function finish(code) {
    if (finished) return;
    finished = true;
    const outFiles = collectOutputFiles();
    if (outFiles.length) self.postMessage({ type: "output-files", files: outFiles });
    self.postMessage({ type: "done", exitCode: code | 0 });
  }

  // Сырой вывод без добавления перевода строки (для посимвольного std::cout).
  function emitRaw(stream, text) {
    if (truncated) return;
    outputBytes += encoder.encode(text).length;
    if (outputBytes > cap) {
      truncated = true;
      self.postMessage({ type: "truncated" });
      return;
    }
    self.postMessage({ type: stream, chunk: text });
  }
  // Построчный вывод (Module.print/printErr вызываются по строкам → добавляем \n).
  function emit(stream, s) {
    emitRaw(stream, (s ?? "") + "\n");
  }

  // Опрос буфера ввода (C++ busy-poll через emscripten_sleep).
  // Когда данных нет — один раз сигналим UI 'need-input' (программа ждёт ввод).
  let needInputPosted = false;
  function inputReady() {
    if (inputPtr < inputBytes.length) {
      needInputPosted = false;
      return 1;
    }
    if (!needInputPosted) {
      needInputPosted = true;
      self.postMessage({ type: "need-input" });
    }
    return 0;
  }
  function getCharSync() {
    return inputPtr < inputBytes.length ? inputBytes[inputPtr++] : -1;
  }

  const moduleConfig = {
    // До main: монтируем рабочий каталог и кладём в него файлы-данные проекта,
    // чтобы std::ifstream("input.txt") и т.п. читали их. FS в области видимости
    // preRun. Захватываем ссылку на FS для последующего сбора вывода.
    // emscripten зовёт preRun-колбэк с Module-аргументом; при -sMODULARIZE FS
    // снаружи виден только как Module.FS (экспортирован через EXPORTED_RUNTIME_METHODS).
    preRun: [function (mod) {
      try {
        runtimeFS = (mod && mod.FS) || (typeof FS !== "undefined" ? FS : null);
        if (!runtimeFS) return;
        try { runtimeFS.mkdir(WORKDIR); } catch (e) { /* уже есть */ }
        runtimeFS.chdir(WORKDIR);
        for (const f of inputFiles) {
          const name = String((f && f.name) || "").trim();
          if (!name || name.includes("/")) continue;
          const bytes = encoder.encode(typeof f.content === "string" ? f.content : "");
          runtimeFS.writeFile(WORKDIR + "/" + name, bytes);
          inputSnapshot.set(name, bytes);
        }
      } catch (e) { /* FS недоступен — файловый I/O просто не работает */ }
    }],
    print: (s) => emit("stdout", s),
    printErr: (s) => emit("stderr", s),
    // C stdin (scanf/getchar) — батч из того же буфера, без паузы (EOF при пустом).
    stdin: () => (inputPtr < inputBytes.length ? inputBytes[inputPtr++] : null),
    // std::cin (через async streambuf + emscripten_sleep):
    __inputReady: inputReady,
    __getCharSync: getCharSync,
    // std::cout пишет сюда напрямую (посимвольно/фрагментами) — без буферизации,
    // чтобы промпт был виден ДО приостановки на вводе. Байты приходят готовым
    // срезом HEAPU8 (js-library извлекает их там, где HEAPU8 точно валиден).
    __outWrite: (bytes) => {
      if (truncated || !bytes || !bytes.length) return;
      emitRaw("stdout", decoder.decode(bytes, { stream: true }));
    },
    __debugPoll: (fileId, line, functionId, varsJson) => {
      const result = evaluateDebugPoint(debugSession, fileId, line, functionId, varsJson);
      if (result.enteredPause && result.frame) postDebugPaused(result.frame);
      return result.pause ? 1 : 0;
    },
    // ЕДИНСТВЕННЫЙ достоверный сигнал завершения программы.
    onExit: (code) => finish(code),
    // quit стреляет и на приостановке (cin), и на реальном выходе → НЕ финишим тут.
    quit: () => {},
    locateFile: (path) => path
  };

  try {
    (0, eval)(moduleJs);
    const factory = self.createCppModule;
    if (typeof factory !== "function") {
      self.postMessage({ type: "error", message: "exec-worker: createCppModule не определён" });
      return;
    }
    // НЕ await→done: ждём onExit. Резолв промиса и ExitStatus-реджект могут прийти
    // на приостановке (cin) — это НЕ завершение, поэтому их игнорируем. Сообщаем
    // только о РЕАЛЬНОЙ ошибке выполнения (не ExitStatus).
    factory(moduleConfig).then(
      () => { /* init/suspend — финал строго по onExit */ },
      (err) => {
        if (err && (err.name === "ExitStatus" || typeof err.status === "number")) {
          return; // штатный разворот стека (suspend/exit) — ждём onExit
        }
        if (!finished) {
          self.postMessage({
            type: "error",
            message: String((err && err.message) || err || "unknown runtime error")
          });
        }
      }
    );
  } catch (err) {
    if (err && (err.name === "ExitStatus" || typeof err.status === "number")) {
      finish(err.status);
      return;
    }
    self.postMessage({
      type: "error",
      message: String((err && err.message) || err || "unknown runtime error")
    });
  }
}

self.postMessage({ type: "ready" });
