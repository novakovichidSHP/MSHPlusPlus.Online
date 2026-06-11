# cpp-runtime — движок выполнения C++ (этап F1)

Изолированный слой, занимающий «место Skulpt» в архитектуре. Даёт приложению
чистый API поверх **emception** (clang/llvm в WASM). UI ничего не знает про
emscripten — только `compile / run / cancel`.

## Файлы
| Файл | Роль |
|---|---|
| `cpp-runtime.js` | Публичный фасад (main-thread ES-модуль). `createCppRuntime()`. |
| `exec-worker.js` | Терминируемый worker — гоняет скомпилированный модуль (для kill бесконечных циклов). |
| `diagnostics.js` | Парсер вывода clang → `file:line:col` (кликабельные ссылки, задел F4). |
| `diagnostics.test.mjs` | Unit-тесты парсера (`node --test`). |
| `vendor/comlink.min.mjs` | Comlink 4.4.1 — RPC к compiler worker'у. |
| `test.html` | Ручной тест-харнесс (compile/run/stdin/timeout/cancel). |

## API
```js
import { createCppRuntime } from "./cpp-runtime.js";

const rt = createCppRuntime({ baseUrl: "./toolchain/" });
await rt.init(ev => console.log(ev.phase));          // поднять компилятор

const res = await rt.compile([{ name: "main.cpp", content: src }]);
// res = { ok, diagnostics:{items,counts,firstError}, summary, durationMs }

if (res.ok) {
  const r = await rt.run({
    stdin: "5\n5 3 8 1 9\n",          // batch stdin (поле «Ввод»)
    timeoutMs: 60000,
    onStdout: s => append(s),
    onStderr: s => append(s),
  });
  // r = { exitCode, timedOut, cancelled, truncated, durationMs, error? }
}

rt.cancelRun();   // прервать выполнение (стоп-кнопка)
rt.dispose();     // освободить compiler + exec worker
```

Дефолтные флаги: `-O2 -std=c++20 -fexceptions` (+ технические
`-sSINGLE_FILE -sMODULARIZE -sEXPORT_NAME=createCppModule -sEXIT_RUNTIME`).
Язык — C++20; полнота библиотеки — по факту тулчейна (см. `docs/cpp-port/ТЗ_переработка.md`).

Лимиты (зеркало `CONFIG` основного приложения): `maxOutputBytes` 2 МБ,
`maxFiles` 30, `maxSingleFileBytes` 50 КБ, `maxTotalTextBytes` 250 КБ,
`runTimeoutMs` 60 с, `compileTimeoutMs` 30 с.

## ⚠️ Хостинг тулчейна — требование same-origin
Compiler worker (`emception.worker.bundle.worker.js`) определяет путь к sysroot
из **`self.location`** и фетчит `.wasm` / `.a` / brotli-пакет **относительно своего
URL**. Classic Worker нельзя создать с cross-origin URL. Поэтому:

- Артефакты тулчейна (worker + wasm + sysroot, ~**прибл. 600 МБ raw / ~120 МБ gz**)
  должны лежать **на том же origin**, что и приложение, в каталоге `baseUrl`.
- В репозиторий приложения они **не коммитятся** (вес, лимиты Git/Pages).
  `cpp-runtime` — это *код*; тулчейн — отдельный большой статический ассет.
- Источник артефактов: ветка `demo` репо `jprendes/emception`
  (локально: `C:\_Vibe_coding\_research\emc-demo`).

### Варианты размещения (решение — отдельной задачей деплоя)
1. **Тот же GitHub Pages сайт**, каталог `/toolchain/` (раздаётся как есть; gzip
   Pages отдаёт прозрачно). Проще всего, same-origin «бесплатно».
2. Отдельный хост/CDN с CORS — потребует трюка с blob-worker и абсолютным
   `__webpack_public_path__` внутри worker'а (НЕ для MVP).

Минимальный набор для раздачи (без Monaco-демо): `emception.worker.bundle.worker.js`,
оба `*.wasm`, brotli-пакет `*.br`, каталоги `brotli/` и `wasm-package/`, и `.a`
sysroot-архивы (подгружаются лениво при линковке).

## Локальная проверка (F1)
`test.html` рассчитан на same-origin с тулчейном. Для прогона против локальной
сборки: скопировать каталог `cpp-runtime/` в корень `emc-demo` и открыть
`http://localhost:8030/cpp-runtime/test.html` (там `baseUrl="../"` указывает на
корень `emc-demo`, где лежит worker и sysroot).

Сценарии: hello+stdin · sort+cin (batch) · ошибка компиляции (диагностика) ·
бесконечный цикл (таймаут) · cancel.
