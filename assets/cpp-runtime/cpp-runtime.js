/**
 * cpp-runtime — изолированный движок выполнения C++ в браузере.
 *
 * Занимает «место Skulpt» в архитектуре приложения: даёт чистый API
 * compile/run/cancel поверх emception (clang/llvm в WASM).
 *
 * Слои:
 *   • compiler worker (emception, Comlink) — долгоживущий, переиспользуется;
 *     фетчит sysroot относительно своего URL → ТРЕБУЕТ same-origin размещения
 *     артефактов тулчейна (baseUrl).
 *   • exec worker (./exec-worker.js, по одному на запуск) — терминируемый,
 *     гоняет скомпилированный модуль; так глушим бесконечные циклы.
 *
 * Пайплайн (доказан в F0):
 *   writeFile(*.cpp/*.h) → em++ … -sSINGLE_FILE -sMODULARIZE … -o out.js
 *   → читаем out.js → инстанс в exec-worker с batch stdin + прямым stdout.
 */

import * as Comlink from "./vendor/comlink.min.mjs";
import { parseDiagnostics, summarizeDiagnostics } from "./diagnostics.js";

export const DEFAULTS = {
  // Каталог с артефактами emception (worker, wasm, sysroot). Same-origin!
  baseUrl: "./toolchain/",
  workerFile: "emception.worker.bundle.worker.js",
  workingDir: "/working",
  entry: "main.cpp",
  // Язык — C++20; библиотека — по факту тулчейна (см. ТЗ).
  flags: ["-O2", "-std=c++20", "-fexceptions"],
  // Технические флаги модуля (не показываются пользователю).
  moduleFlags: [
    "-sSINGLE_FILE=1",
    "-sMODULARIZE=1",
    "-sEXPORT_NAME=createCppModule",
    "-sEXIT_RUNTIME=1"
  ],
  compileTimeoutMs: 30000,
  runTimeoutMs: 60000,
  initTimeoutMs: 120000,
  maxOutputBytes: 2_000_000,
  // Лимиты проекта (зеркало CONFIG основного приложения).
  maxFiles: 30,
  maxSingleFileBytes: 50000,
  maxTotalTextBytes: 250000
};

const SOURCE_RE = /\.(cpp|cc|cxx|c\+\+|c)$/i;

export class CppRuntimeError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "CppRuntimeError";
    this.code = code || "ERR";
  }
}

export function createCppRuntime(options = {}) {
  return new CppRuntime(options);
}

class CppRuntime {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this._emception = null;     // Comlink-прокси compiler worker
    this._worker = null;        // сам Worker компилятора
    this._execWorker = null;    // текущий exec worker
    this._lastModuleJs = null;  // JS последнего успешного модуля
    this._initPromise = null;
    this._diagBuffer = "";      // накопитель диагностики текущей компиляции
    this._collecting = false;
  }

  get ready() {
    return Boolean(this._emception);
  }

  /**
   * Поднимает compiler worker и инициализирует тулчейн.
   * @param {(ev:{phase:string,message?:string})=>void} [onProgress]
   */
  init(onProgress) {
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._doInit(onProgress).catch((err) => {
      this._initPromise = null; // дать шанс повторить
      throw err;
    });
    return this._initPromise;
  }

  async _doInit(onProgress) {
    const report = (phase, message) => onProgress && onProgress({ phase, message });
    report("spawn", "Запуск компилятора…");

    const workerUrl = new URL(this.options.baseUrl + this.options.workerFile, _baseHref());
    // Classic worker: артефакты тулчейна должны быть same-origin (см. README).
    this._worker = new Worker(workerUrl);
    this._emception = Comlink.wrap(this._worker);

    // Если воркер не загрузился (404 / ошибка скрипта) — не висим вечно на
    // «Загрузка компилятора…», а падаем с понятной ошибкой. Главный кейс:
    // тулчейн не развёрнут на origin (см. README, раздел про хостинг).
    const workerFailed = new Promise((_, reject) => {
      this._worker.addEventListener("error", () => {
        reject(new CppRuntimeError(
          `Не удалось загрузить компилятор (${workerUrl.href}). ` +
          `Тулчейн должен быть размещён на том же origin — см. assets/cpp-runtime/README.md.`,
          "TOOLCHAIN_UNAVAILABLE"
        ));
      });
    });

    // Диагностика компилятора стекается в буфер (em++ пишет в оба потока).
    // emception отдаёт текст по-строчно, но без гарантии завершающего \n →
    // нормализуем перенос на каждый чанк, иначе строки clang склеиваются и
    // парсер захватывает «сообщение + сниппет + caret» одной строкой.
    const sink = Comlink.proxy((chunk) => {
      if (!this._collecting) return;
      const text = String(chunk ?? "");
      this._diagBuffer += text.endsWith("\n") ? text : text + "\n";
    });

    const sequence = (async () => {
      await (this._emception.onstdout = sink);
      await (this._emception.onstderr = sink);
      report("toolchain", "Загрузка тулчейна…");
      await this._emception.init();
      report("ready", "Готово");
      return this;
    })();

    // Backstop-таймаут: тулчейн весит десятки МБ, но если за initTimeoutMs
    // ничего не пришло — тоже показываем ошибку, а не бесконечную загрузку.
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new CppRuntimeError(
        "Таймаут загрузки компилятора. Проверьте доступность тулчейна и сеть.",
        "TOOLCHAIN_TIMEOUT"
      )), this.options.initTimeoutMs);
    });

    return Promise.race([sequence, workerFailed, timeout]);
  }

  /**
   * Компилирует набор файлов в исполнимый JS-модуль.
   * @param {Array<{name:string, content:string}>} files
   * @param {object} [opts]
   * @param {string[]} [opts.flags] — переопределить флаги языка/оптимизации.
   * @param {string}   [opts.entry] — имя точки входа (по умолчанию main.cpp).
   * @returns {Promise<{ok:boolean, diagnostics:object, durationMs:number, summary:string}>}
   */
  async compile(files, opts = {}) {
    if (!this._emception) await this.init();
    this._validateFiles(files);

    const flags = opts.flags || this.options.flags;
    const dir = this.options.workingDir;
    const sources = [];

    // Записываем все единицы трансляции и заголовки в рабочий каталог.
    for (const f of files) {
      await this._emception.fileSystem.writeFile(`${dir}/${f.name}`, f.content);
      if (SOURCE_RE.test(f.name)) sources.push(f.name);
    }
    if (sources.length === 0) {
      throw new CppRuntimeError("Нет ни одного .cpp файла для компиляции", "NO_SOURCES");
    }

    const cmd = [
      "em++",
      ...flags,
      ...this.options.moduleFlags,
      ...sources,
      "-o",
      "out.js"
    ].join(" ");

    this._diagBuffer = "";
    this._collecting = true;
    const t0 = _now();
    let result;
    try {
      result = await this._withTimeout(
        this._emception.run(cmd),
        this.options.compileTimeoutMs,
        "COMPILE_TIMEOUT",
        "Превышен таймаут компиляции"
      );
    } finally {
      this._collecting = false;
    }
    const durationMs = _now() - t0;

    const diagnostics = parseDiagnostics(this._diagBuffer, {
      stripPrefix: dir.endsWith("/") ? dir : dir + "/"
    });
    const ok = result && result.returncode === 0;

    if (ok) {
      this._lastModuleJs = await this._emception.fileSystem.readFile(`${dir}/out.js`, {
        encoding: "utf8"
      });
    } else {
      this._lastModuleJs = null;
    }

    return {
      ok,
      diagnostics,
      summary: ok ? summarizeDiagnostics(diagnostics) : (diagnostics.firstError?.message || "Ошибка компиляции"),
      durationMs
    };
  }

  /**
   * Запускает последний успешно скомпилированный модуль.
   * @param {object} [opts]
   * @param {string}   [opts.stdin=""]           — заранее заданный ввод (batch).
   * @param {number}   [opts.timeoutMs]          — таймаут выполнения.
   * @param {(s:string)=>void} [opts.onStdout]   — порция stdout.
   * @param {(s:string)=>void} [opts.onStderr]   — порция stderr.
   * @returns {Promise<{exitCode:number|null, timedOut:boolean, cancelled:boolean,
   *                    truncated:boolean, durationMs:number, error?:string}>}
   */
  run(opts = {}) {
    if (!this._lastModuleJs) {
      return Promise.reject(new CppRuntimeError("Нет скомпилированного модуля", "NO_MODULE"));
    }
    this.cancelRun(); // на всякий случай гасим предыдущий запуск

    const timeoutMs = opts.timeoutMs ?? this.options.runTimeoutMs;
    const moduleJs = this._lastModuleJs;

    return new Promise((resolve) => {
      const worker = new Worker(new URL("./exec-worker.js", import.meta.url));
      this._execWorker = worker;

      let exitCode = null;
      let truncated = false;
      let settled = false;
      const t0 = _now();

      const finish = (extra) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        if (this._execWorker === worker) this._execWorker = null;
        resolve({
          exitCode,
          timedOut: false,
          cancelled: false,
          truncated,
          durationMs: _now() - t0,
          ...extra
        });
      };

      const timer = setTimeout(() => finish({ timedOut: true }), timeoutMs);

      worker.onmessage = (e) => {
        const m = e.data || {};
        switch (m.type) {
          case "ready":
            worker.postMessage({
              moduleJs,
              stdin: opts.stdin || "",
              maxOutputBytes: this.options.maxOutputBytes
            });
            break;
          case "stdout":
            opts.onStdout && opts.onStdout(m.chunk);
            break;
          case "stderr":
            opts.onStderr && opts.onStderr(m.chunk);
            break;
          case "truncated":
            truncated = true;
            break;
          case "done":
            exitCode = m.exitCode ?? 0;
            finish({});
            break;
          case "error":
            finish({ error: m.message });
            break;
        }
      };
      worker.onerror = (e) => finish({ error: e.message || "worker error" });

      // Маркер отмены: cancelRun() выставит флаг через свойство worker'а.
      worker._onCancel = () => finish({ cancelled: true });
    });
  }

  /** Прерывает текущий запуск (бесконечный цикл и т.п.). */
  cancelRun() {
    const w = this._execWorker;
    if (w) {
      this._execWorker = null;
      if (typeof w._onCancel === "function") w._onCancel();
      w.terminate();
    }
  }

  /** Полностью освобождает ресурсы (compiler + exec worker). */
  dispose() {
    this.cancelRun();
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
      this._emception = null;
      this._initPromise = null;
    }
  }

  _validateFiles(files) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new CppRuntimeError("Пустой список файлов", "NO_FILES");
    }
    if (files.length > this.options.maxFiles) {
      throw new CppRuntimeError(`Слишком много файлов (>${this.options.maxFiles})`, "TOO_MANY_FILES");
    }
    let total = 0;
    for (const f of files) {
      if (!f || typeof f.name !== "string" || typeof f.content !== "string") {
        throw new CppRuntimeError("Некорректный файл в наборе", "BAD_FILE");
      }
      const bytes = new TextEncoder().encode(f.content).length;
      if (bytes > this.options.maxSingleFileBytes) {
        throw new CppRuntimeError(`Файл ${f.name} превышает лимит`, "FILE_TOO_BIG");
      }
      total += bytes;
    }
    if (total > this.options.maxTotalTextBytes) {
      throw new CppRuntimeError("Суммарный размер проекта превышает лимит", "PROJECT_TOO_BIG");
    }
  }

  _withTimeout(promise, ms, code, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new CppRuntimeError(message, code)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }
}

function _now() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function _baseHref() {
  // База для разрешения относительного baseUrl: каталог этого модуля.
  return import.meta.url;
}
