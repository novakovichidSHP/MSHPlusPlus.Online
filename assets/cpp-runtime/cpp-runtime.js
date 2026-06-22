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
  // -sASYNCIFY — для интерактивного std::cin: программа приостанавливается на чтении,
  // пока пользователь не введёт данные (см. __cppio.cpp / inlib.js ниже).
  moduleFlags: [
    "-sSINGLE_FILE=1",
    "-sMODULARIZE=1",
    "-sEXPORT_NAME=createCppModule",
    "-sEXIT_RUNTIME=1",
    "-sASYNCIFY=1",
    // FS всегда присутствует — даже если программа не делает файлового I/O, мы
    // кладём в её MEMFS файлы-данные проекта (см. exec-worker preRun /work).
    // FS экспортируем: при -sMODULARIZE он внутри замыкания, снаружи (наш preRun)
    // доступен только как Module.FS.
    "-sFORCE_FILESYSTEM=1",
    "-sEXPORTED_RUNTIME_METHODS=FS",
    "--js-library", "/working/__cppio_lib.js"
  ],
  compileTimeoutMs: 45000,
  runTimeoutMs: 60000,
  initTimeoutMs: 120000,
  maxOutputBytes: 2_000_000,
  // Лимиты проекта (зеркало CONFIG основного приложения).
  maxFiles: 30,
  maxSingleFileBytes: 50000,
  maxTotalTextBytes: 250000
};

const SOURCE_RE = /\.(cpp|cc|cxx|c\+\+|c)$/i;

// --- Интерактивный ввод std::cin (Asyncify) ---
// Доп. единица трансляции: подменяет буфер std::cin на async-streambuf ДО main
// (глобальный инициализатор; <iostream> в этой же TU гарантирует, что cin уже создан).
const CPPIO_SRC = `#include <iostream>
#include <streambuf>
#include <emscripten.h>
extern "C" int __cpp_input_ready();
extern "C" int __cpp_get_char();
extern "C" void __cpp_out_write(const char*, int);
namespace {
  class AsyncInBuf : public std::streambuf {
    char ch;
  protected:
    int underflow() override {
      // Пока ввода нет — приостанавливаем программу через emscripten_sleep
      // (каноничный примитив Asyncify): JS успевает получить ввод пользователя.
      while (!__cpp_input_ready()) {
        emscripten_sleep(15);
      }
      int r = __cpp_get_char();
      if (r < 0) return EOF;
      ch = static_cast<char>(r);
      setg(&ch, &ch, &ch + 1);
      return static_cast<unsigned char>(ch);
    }
  };
  // Свой буфер std::cout: каждый фрагмент/символ уходит в JS НЕМЕДЛЕННО, минуя
  // строковую буферизацию emscripten-TTY. Иначе промпт без '\\n' (напр. "Имя? ")
  // не показывался бы до перевода строки — и пользователь вводил бы вслепую.
  class AsyncOutBuf : public std::streambuf {
  protected:
    std::streamsize xsputn(const char* s, std::streamsize n) override {
      if (n > 0) __cpp_out_write(s, static_cast<int>(n));
      return n;
    }
    int overflow(int c) override {
      if (c != EOF) { char ch = static_cast<char>(c); __cpp_out_write(&ch, 1); }
      return c;
    }
  };
  struct CppIoInstaller {
    CppIoInstaller() {
      static AsyncInBuf ibuf; std::cin.rdbuf(&ibuf);
      static AsyncOutBuf obuf; std::cout.rdbuf(&obuf);
    }
  } __cpp_io_installer;
}
`;
// JS-библиотека (линкуется в out.js): синхронные импорты ввода/вывода.
// Приостановку даёт emscripten_sleep в C++ (надёжный Asyncify), а не эти функции.
const CPPIO_LIB = `mergeInto(LibraryManager.library, {
  __cpp_input_ready: function () { return Module.__inputReady ? Module.__inputReady() : 0; },
  __cpp_get_char: function () { return Module.__getCharSync ? Module.__getCharSync() : -1; },
  __cpp_out_write: function (ptr, len) { if (Module.__outWrite && len > 0) Module.__outWrite(HEAPU8.subarray(ptr, ptr + len)); }
});
`;
const CPPIO_SOURCE_NAME = "__cppio.cpp";
const CPPIO_LIB_NAME = "__cppio_lib.js";

// --- Бэкпорт C++20 <format> через header-only {fmt} ---
// Тулчейн несёт libc++14, в котором нет рабочего std::format (нужен libc++17+).
// Пока тяжёлая пересборка тулчейна заморожена (docs/cpp-port/TOOLCHAIN_REBUILD.md),
// даём std::format «малой кровью»: вендорим header-only {fmt} 10.2.1 и шимом
// проецируем fmt::format → std::format. Прелюдия force-include'ится ТОЛЬКО когда
// исходник реально использует std::format (детект FMT_DETECT_RE), чтобы не платить
// разбором тяжёлых хедеров в обычных компиляциях.
const FMT_HEADER_NAMES = ["core.h", "format.h", "format-inl.h"];
const FMT_SHIM_NAME = "__std_format.hpp";
// Кладём хедеры fmt ПЛОСКО в рабочий каталог: внутренние #include "core.h"/
// "format-inl.h" у fmt — кавычечные, резолвятся в cwd (=/working), как и __cppio.cpp.
// Так не нужны вложенные папки/-I (writeFile не гарантирует создание родителей).
const FMT_SHIM_SRC = `// Прелюдия: C++20 <format> поверх header-only {fmt} 10.2.1.
// Force-include из cpp-runtime только при использовании std::format.
#pragma once
#include <version>
#if !defined(__cpp_lib_format)
#  define FMT_HEADER_ONLY
#  include "format.h"        // vendored {fmt}, лежит рядом в /working
namespace std {
  using ::fmt::format;
  using ::fmt::vformat;
  using ::fmt::format_to;
  using ::fmt::format_to_n;
  using ::fmt::formatted_size;
  using ::fmt::make_format_args;
  using ::fmt::format_args;
  using ::fmt::format_string;
  using ::fmt::formatter;
  using ::fmt::format_error;
}
// Помечаем фичу как доступную, чтобы пользовательский #include <format>
// (на libc++14 пустой/неполный) не пытался переопределить наши имена.
#  define __cpp_lib_format 201907L
#endif
`;
// Достаточно поймать любое обращение к семейству std::format — все имена,
// которые шим вносит в std, начинаются с std::format, плюс vformat/make_format_args.
const FMT_DETECT_RE = /std::\s*(?:v?format|make_format_args)/;

// --- Бэкпорт C++20 <ranges>-АЛГОРИТМОВ (без ленивых views) ---
// В libc++14 тулчейна ranges-алгоритмов нет (проверено: sort/find/count/for_each/…
// все отсутствуют), поэтому шим добавляет их в std::ranges без коллизий. Ленивые
// views (filter/transform/take) здесь НЕ реализованы — это отдельный тяжёлый слой
// (range-v3, риск таймаута компиляции); views::iota/common в libc++14 уже есть.
// Реализация — тонкие range-обёртки над <algorithm> с поддержкой проекций (std::invoke),
// чтобы работали и проекции-указатели на член (ranges::sort(v, {}, &T::field)).
const RANGES_SHIM_NAME = "__std_ranges.hpp";
const RANGES_SHIM_SRC = `// Прелюдия: подмножество C++20 std::ranges-алгоритмов поверх <algorithm> (libc++14).
// Force-include из cpp-runtime только при использовании std::ranges::.
// Возвращаемые типы упрощены до итераторов/значений (не subrange/*_result) — на
// практике совместимо; ленивые views не входят (нужен range-v3).
#pragma once
#include <version>
#if !defined(__cpp_lib_ranges)
#include <algorithm>
#include <iterator>
#include <functional>
#include <utility>
namespace std { namespace ranges {
namespace __shim {
  struct identity {
    template <class T> constexpr T&& operator()(T&& t) const noexcept { return static_cast<T&&>(t); }
  };
}
// --- немодифицирующие ---
template <class R, class Pred, class Proj = __shim::identity>
bool all_of(R&& r, Pred pred, Proj proj = {}) {
  for (auto&& x : r) if (!std::invoke(pred, std::invoke(proj, x))) return false;
  return true;
}
template <class R, class Pred, class Proj = __shim::identity>
bool any_of(R&& r, Pred pred, Proj proj = {}) {
  for (auto&& x : r) if (std::invoke(pred, std::invoke(proj, x))) return true;
  return false;
}
template <class R, class Pred, class Proj = __shim::identity>
bool none_of(R&& r, Pred pred, Proj proj = {}) {
  for (auto&& x : r) if (std::invoke(pred, std::invoke(proj, x))) return false;
  return true;
}
template <class R, class Fun, class Proj = __shim::identity>
Fun for_each(R&& r, Fun f, Proj proj = {}) {
  for (auto&& x : r) std::invoke(f, std::invoke(proj, x));
  return f;
}
template <class R, class T, class Proj = __shim::identity>
auto find(R&& r, const T& value, Proj proj = {}) {
  auto first = std::begin(r); auto last = std::end(r);
  for (; first != last; ++first) if (std::invoke(proj, *first) == value) break;
  return first;
}
template <class R, class Pred, class Proj = __shim::identity>
auto find_if(R&& r, Pred pred, Proj proj = {}) {
  auto first = std::begin(r); auto last = std::end(r);
  for (; first != last; ++first) if (std::invoke(pred, std::invoke(proj, *first))) break;
  return first;
}
template <class R, class Pred, class Proj = __shim::identity>
auto find_if_not(R&& r, Pred pred, Proj proj = {}) {
  auto first = std::begin(r); auto last = std::end(r);
  for (; first != last; ++first) if (!std::invoke(pred, std::invoke(proj, *first))) break;
  return first;
}
template <class R, class T, class Proj = __shim::identity>
auto count(R&& r, const T& value, Proj proj = {}) {
  typename std::iterator_traits<decltype(std::begin(r))>::difference_type n = 0;
  for (auto&& x : r) if (std::invoke(proj, x) == value) ++n;
  return n;
}
template <class R, class Pred, class Proj = __shim::identity>
auto count_if(R&& r, Pred pred, Proj proj = {}) {
  typename std::iterator_traits<decltype(std::begin(r))>::difference_type n = 0;
  for (auto&& x : r) if (std::invoke(pred, std::invoke(proj, x))) ++n;
  return n;
}
// --- min/max ---
template <class R, class Comp = std::less<>, class Proj = __shim::identity>
auto max_element(R&& r, Comp comp = {}, Proj proj = {}) {
  auto first = std::begin(r), last = std::end(r);
  if (first == last) return first;
  auto best = first;
  for (++first; first != last; ++first)
    if (std::invoke(comp, std::invoke(proj, *best), std::invoke(proj, *first))) best = first;
  return best;
}
template <class R, class Comp = std::less<>, class Proj = __shim::identity>
auto min_element(R&& r, Comp comp = {}, Proj proj = {}) {
  auto first = std::begin(r), last = std::end(r);
  if (first == last) return first;
  auto best = first;
  for (++first; first != last; ++first)
    if (std::invoke(comp, std::invoke(proj, *first), std::invoke(proj, *best))) best = first;
  return best;
}
template <class R, class Comp = std::less<>, class Proj = __shim::identity>
auto max(R&& r, Comp comp = {}, Proj proj = {}) {
  auto it = ranges::max_element(r, comp, proj); return *it;
}
template <class R, class Comp = std::less<>, class Proj = __shim::identity>
auto min(R&& r, Comp comp = {}, Proj proj = {}) {
  auto it = ranges::min_element(r, comp, proj); return *it;
}
// --- сортировка/упорядоченные ---
template <class R, class Comp = std::less<>, class Proj = __shim::identity>
void sort(R&& r, Comp comp = {}, Proj proj = {}) {
  std::sort(std::begin(r), std::end(r),
    [&](auto&& a, auto&& b){ return std::invoke(comp, std::invoke(proj, a), std::invoke(proj, b)); });
}
template <class R, class Comp = std::less<>, class Proj = __shim::identity>
void stable_sort(R&& r, Comp comp = {}, Proj proj = {}) {
  std::stable_sort(std::begin(r), std::end(r),
    [&](auto&& a, auto&& b){ return std::invoke(comp, std::invoke(proj, a), std::invoke(proj, b)); });
}
template <class R> void reverse(R&& r) { std::reverse(std::begin(r), std::end(r)); }
template <class R> auto unique(R&& r) { return std::unique(std::begin(r), std::end(r)); }
template <class R, class Pred> auto unique(R&& r, Pred p) { return std::unique(std::begin(r), std::end(r), p); }
template <class R, class T, class Comp = std::less<>, class Proj = __shim::identity>
auto lower_bound(R&& r, const T& value, Comp comp = {}, Proj proj = {}) {
  return std::lower_bound(std::begin(r), std::end(r), value,
    [&](auto&& el, auto&& val){ return std::invoke(comp, std::invoke(proj, el), val); });
}
template <class R, class T, class Comp = std::less<>, class Proj = __shim::identity>
auto upper_bound(R&& r, const T& value, Comp comp = {}, Proj proj = {}) {
  return std::upper_bound(std::begin(r), std::end(r), value,
    [&](auto&& val, auto&& el){ return std::invoke(comp, val, std::invoke(proj, el)); });
}
template <class R, class T, class Comp = std::less<>, class Proj = __shim::identity>
bool binary_search(R&& r, const T& value, Comp comp = {}, Proj proj = {}) {
  auto it = ranges::lower_bound(r, value, comp, proj);
  return it != std::end(r) && !std::invoke(comp, value, std::invoke(proj, *it));
}
// --- модифицирующие/копирующие ---
template <class R, class O> auto copy(R&& r, O out) { return std::copy(std::begin(r), std::end(r), out); }
template <class R, class O, class F, class Proj = __shim::identity>
auto transform(R&& r, O out, F f, Proj proj = {}) {
  auto first = std::begin(r), last = std::end(r);
  for (; first != last; ++first, (void)++out) *out = std::invoke(f, std::invoke(proj, *first));
  return out;
}
template <class R, class T> void fill(R&& r, const T& v) { std::fill(std::begin(r), std::end(r), v); }
}} // namespace std::ranges
#endif
`;
// Ловим обращения к нашему семейству алгоритмов. views НЕ детектим — шим их не даёт.
const RANGES_DETECT_RE = /std::\s*ranges::/;

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
    this._fmtWritten = false;   // вендоренные хедеры {fmt} уже в ФС воркера?
    this._rangesWritten = false; // шим std::ranges уже в ФС воркера?
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

    // Доп. единица для интерактивного std::cin + js-library (см. moduleFlags).
    await this._emception.fileSystem.writeFile(`${dir}/${CPPIO_SOURCE_NAME}`, CPPIO_SRC);
    await this._emception.fileSystem.writeFile(`${dir}/${CPPIO_LIB_NAME}`, CPPIO_LIB);
    sources.push(CPPIO_SOURCE_NAME);

    // Бэкпорты C++20: если пользователь использует std::format / std::ranges —
    // подкладываем нужную прелюдию и force-include'им её. В обычных программах
    // ничего не добавляем (детект по исходникам).
    const extraFlags = [];
    const usesFormat = files.some((f) => SOURCE_RE.test(f.name) && FMT_DETECT_RE.test(f.content));
    if (usesFormat) {
      await this._ensureFmtVendor(dir);
      extraFlags.push("-include", `${dir}/${FMT_SHIM_NAME}`);
    }
    const usesRanges = files.some((f) => SOURCE_RE.test(f.name) && RANGES_DETECT_RE.test(f.content));
    if (usesRanges) {
      await this._ensureRangesShim(dir);
      extraFlags.push("-include", `${dir}/${RANGES_SHIM_NAME}`);
    }

    const cmd = [
      "em++",
      ...flags,
      ...extraFlags,
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
   * @param {Array<{name:string,content:string}>} [opts.files] — файлы-данные,
   *        кладутся в MEMFS программы (/work) для std::ifstream и т.п.
   * @param {number}   [opts.timeoutMs]          — таймаут выполнения.
   * @param {(s:string)=>void} [opts.onStdout]   — порция stdout.
   * @param {(s:string)=>void} [opts.onStderr]   — порция stderr.
   * @param {()=>void} [opts.onNeedInput]        — программа ждёт ввод (std::cin).
   * @returns {Promise<{exitCode:number|null, timedOut:boolean, cancelled:boolean,
   *                    truncated:boolean, outputFiles:Array<{name:string,content:string}>,
   *                    durationMs:number, error?:string}>}
   */
  run(opts = {}) {
    if (!this._lastModuleJs) {
      return Promise.reject(new CppRuntimeError("Нет скомпилированного модуля", "NO_MODULE"));
    }
    this.cancelRun(); // на всякий случай гасим предыдущий запуск

    const timeoutMs = opts.timeoutMs ?? this.options.runTimeoutMs;
    const moduleJs = this._lastModuleJs;

    return new Promise((resolve) => {
      const worker = new Worker(new URL("./exec-worker.js?b=17", import.meta.url));
      this._execWorker = worker;

      let exitCode = null;
      let truncated = false;
      let settled = false;
      let outputFiles = [];
      const t0 = _now();

      // Таймаут считает ТОЛЬКО время выполнения. Пока программа висит на std::cin
      // (need-input), часы остановлены — иначе живой ввод убивался бы лимитом.
      let timer = null;
      const armTimer = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => finish({ timedOut: true }), timeoutMs);
      };
      const stopTimer = () => {
        if (timer) { clearTimeout(timer); timer = null; }
      };

      const finish = (extra) => {
        if (settled) return;
        settled = true;
        stopTimer();
        worker.terminate();
        if (this._execWorker === worker) this._execWorker = null;
        resolve({
          exitCode,
          timedOut: false,
          cancelled: false,
          truncated,
          outputFiles,
          durationMs: _now() - t0,
          ...extra
        });
      };

      armTimer();

      worker.onmessage = (e) => {
        const m = e.data || {};
        switch (m.type) {
          case "ready":
            worker.postMessage({
              moduleJs,
              stdin: opts.stdin || "",
              files: Array.isArray(opts.files) ? opts.files : [],
              maxOutputBytes: this.options.maxOutputBytes
            });
            break;
          case "stdout":
            armTimer(); // программа активна — перезапускаем счётчик выполнения
            opts.onStdout && opts.onStdout(m.chunk);
            break;
          case "stderr":
            armTimer();
            opts.onStderr && opts.onStderr(m.chunk);
            break;
          case "need-input":
            // программа ждёт ввод (std::cin) — часы стоят, UI активирует поле ввода
            stopTimer();
            opts.onNeedInput && opts.onNeedInput();
            break;
          case "output-files":
            // файлы, созданные/изменённые программой в /work (файловый вывод)
            if (Array.isArray(m.files)) outputFiles = m.files;
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
      // provideInput() возобновляет выполнение → перезапускаем счётчик времени.
      worker._armTimer = armTimer;
    });
  }

  /** Передать строку ввода работающей программе (интерактивный std::cin). */
  provideInput(text) {
    if (this._execWorker) {
      this._execWorker.postMessage({ type: "input", text: String(text ?? "") });
      if (typeof this._execWorker._armTimer === "function") this._execWorker._armTimer();
    }
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

  /**
   * Лениво подкладывает header-only {fmt} в ФС воркера (один раз на жизнь рантайма).
   * Исходники лежат same-origin в ./vendor/fmt/; пишем их ПЛОСКО в рабочий каталог
   * вместе с прелюдией-шимом. Идемпотентно (флаг _fmtWritten).
   */
  async _ensureFmtVendor(dir) {
    if (this._fmtWritten) return;
    for (const name of FMT_HEADER_NAMES) {
      const url = new URL(`./vendor/fmt/${name}`, _baseHref());
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new CppRuntimeError(
          `Не удалось загрузить vendored-хедер ${name} (${resp.status})`,
          "FMT_VENDOR_FETCH"
        );
      }
      await this._emception.fileSystem.writeFile(`${dir}/${name}`, await resp.text());
    }
    await this._emception.fileSystem.writeFile(`${dir}/${FMT_SHIM_NAME}`, FMT_SHIM_SRC);
    this._fmtWritten = true;
  }

  /**
   * Кладёт шим std::ranges-алгоритмов в ФС воркера (один раз на жизнь рантайма).
   * Шим — собственный код (не вендоринг), хранится строкой; пишем плоско в рабочий каталог.
   */
  async _ensureRangesShim(dir) {
    if (this._rangesWritten) return;
    await this._emception.fileSystem.writeFile(`${dir}/${RANGES_SHIM_NAME}`, RANGES_SHIM_SRC);
    this._rangesWritten = true;
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
