/**
 * exec-worker — изолированный запуск скомпилированной C++-программы.
 *
 * Живёт в отдельном Web Worker'е (classic), чтобы:
 *   • не блокировать UI во время выполнения;
 *   • жёстко прерывать бесконечные циклы через worker.terminate() из фасада.
 *
 * Контракт сообщений:
 *   IN : { moduleJs, stdin, maxOutputBytes }
 *   OUT: { type:'ready' }                       — worker загрузился
 *        { type:'stdout', chunk }               — порция вывода программы
 *        { type:'stderr', chunk }               — порция stderr программы
 *        { type:'truncated' }                   — достигнут лимит вывода
 *        { type:'done', exitCode }              — программа завершилась
 *        { type:'error', message }              — ошибка выполнения/инстанса
 *
 * Модуль компилируется с -sSINGLE_FILE=1 (wasm встроен → без fetch),
 * -sMODULARIZE=1 -sEXPORT_NAME=createCppModule, -sEXIT_RUNTIME=1.
 */

const encoder = new TextEncoder();

self.onmessage = async (event) => {
  const { moduleJs, stdin, maxOutputBytes } = event.data || {};
  if (typeof moduleJs !== "string") {
    self.postMessage({ type: "error", message: "exec-worker: нет moduleJs" });
    return;
  }

  const inputBytes = encoder.encode(typeof stdin === "string" ? stdin : "");
  const cap = Number.isFinite(maxOutputBytes) ? maxOutputBytes : 2_000_000;

  let inputPtr = 0;
  let outputBytes = 0;
  let truncated = false;
  let exitCode = 0;
  let exitSeen = false;

  function emit(stream, s) {
    if (truncated) return;
    const line = (s ?? "") + "\n";
    outputBytes += encoder.encode(line).length;
    if (outputBytes > cap) {
      truncated = true;
      self.postMessage({ type: "truncated" });
      return;
    }
    self.postMessage({ type: stream, chunk: line });
  }

  const moduleConfig = {
    print: (s) => emit("stdout", s),
    printErr: (s) => emit("stderr", s),
    // batch stdin: отдаём байты заранее заданного буфера, затем EOF (null)
    stdin: () => (inputPtr < inputBytes.length ? inputBytes[inputPtr++] : null),
    // перехватываем код выхода (EXIT_RUNTIME=1 → exit() после main)
    onExit: (code) => {
      exitSeen = true;
      exitCode = code | 0;
    },
    quit: (code) => {
      exitSeen = true;
      exitCode = code | 0;
    },
    // глушим попытки загрузки внешних ресурсов (их быть не должно при SINGLE_FILE)
    locateFile: (path) => path
  };

  try {
    // moduleJs определяет глобальную фабрику createCppModule (MODULARIZE).
    // Косвенный eval → выполнение в глобальной области worker'а.
    (0, eval)(moduleJs);

    const factory = self.createCppModule;
    if (typeof factory !== "function") {
      self.postMessage({ type: "error", message: "exec-worker: createCppModule не определён" });
      return;
    }

    // INVOKE_RUN по умолчанию → main() исполняется во время инициализации.
    await factory(moduleConfig);
    self.postMessage({ type: "done", exitCode: exitSeen ? exitCode : 0 });
  } catch (err) {
    // emscripten при exit() может бросать ExitStatus — это штатное завершение.
    if (err && (err.name === "ExitStatus" || typeof err.status === "number")) {
      self.postMessage({ type: "done", exitCode: err.status | 0 });
      return;
    }
    self.postMessage({
      type: "error",
      message: String((err && err.message) || err || "unknown runtime error")
    });
  }
};

self.postMessage({ type: "ready" });
