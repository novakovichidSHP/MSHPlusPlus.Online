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
`-sSINGLE_FILE -sMODULARIZE -sEXPORT_NAME=createCppModule -sEXIT_RUNTIME
-sDYNAMIC_EXECUTION=0`).
Язык — C++20; полнота библиотеки — по факту тулчейна (см. `docs/cpp-port/ТЗ_переработка.md`).

Лимиты (зеркало `CONFIG` основного приложения): `maxOutputBytes` 2 МБ,
`maxFiles` 30, `maxSingleFileBytes` 50 КБ, `maxTotalTextBytes` 250 КБ,
`runTimeoutMs` 60 с, `compileTimeoutMs` 45 с. Лимиты файлов применяются в
`exec-worker` по `stat` до `readFile`, декодирования и `postMessage`; пропуски
возвращаются как `outputFilesLimited` и `outputFilesLimitDetails`.

## Граница безопасности пользовательского C++

Вызовы JavaScript через Emscripten (`EM_ASM`, `EM_JS`,
`emscripten_run_script*` и связанные bridge API) запрещены несколькими слоями:

1. token-level проверка C/C++-исходников и заголовков (включая macro aliases и
   прямой `##` token-pasting, но без ложных совпадений в строках/комментариях);
2. `-sDYNAMIC_EXECUTION=0` при линковке;
3. обязательная проверка готового `out.js` на generated bridge glue до запуска;
4. immutable capability guard в `exec-worker`: сетевые/межконтекстные API
   (`XMLHttpRequest`, sockets, nested workers, storage/channel globals) недоступны, а `fetch` разрешён только для
   `data:` URL, необходимого для загрузки встроенного SINGLE_FILE wasm.

Эти слои защищают same-origin worker в текущей архитектуре. Для более сильной
изоляции от неизвестных возможностей JavaScript-движка потребуется отдельный
opaque-origin sandbox; это отдельное архитектурное изменение, не замена текущим
проверкам.

Compile timeout является жёсткой отменой: compiler worker завершается, Comlink,
диагностика, FS-кэш и служебные shim-флаги сбрасываются. Следующая компиляция
создаёт чистый worker, поэтому просроченный clang не может дописать общий
`out.js` или смешать диагностику с новой сборкой.

## ⚠️ Хостинг тулчейна — требование same-origin
Compiler worker (`emception.worker.bundle.worker.js`) определяет путь к sysroot
из **`self.location`** и фетчит `.wasm` / `.a` / brotli-пакет **относительно своего
URL**. Classic Worker нельзя создать с cross-origin URL. Поэтому:

- Артефакты тулчейна должны лежать **на том же origin**, что и приложение, в каталоге `baseUrl`.
- В репозиторий приложения они **не коммитятся** (вес, лимиты Git/Pages).
  `cpp-runtime` — это *код*; тулчейн — отдельный большой статический ассет.
- Источник артефактов: ветка `demo` репо `jprendes/emception`
  (локально: `C:\_Vibe_coding\_research\emc-demo`; разложено в `/toolchain/`, gitignored).

### Что и сколько грузит клиент (ЗАМЕРЕНО 2026-06-11)
| Этап | Файлы | Вес |
|---|---|---|
| Init (раз за сессию) | worker (530 КБ) + 2 wasm (950 КБ) + brotli-пак `*.br` (23.5 МБ) | **~25 МБ** |
| Линковка 1-й программы | sysroot `.a` под используемые либы (типичный STL: 10 шт — c, c++, c++abi, compiler_rt, GL, al, html5, stubs, dlmalloc, sockets) | **10.9 МБ raw / 3.6 МБ gz** |
| **Холодная 1-я компиляция** | сумма выше | **≈ 28 МБ (gz) / ~36 МБ (raw)** |
| Каждая следующая компиляция | всё из кэша | **~0 сети** |

`.br`-пак = clang + заголовки + ФС-скелет; **статические либы `.a` НЕ внутри него**, тянутся
линковщиком по требованию (`wasm-ld`), только нужные данной программе. Более «тяжёлые» хедеры
(`<thread>`, `<regex>`…) подтянут дополнительные `.a`. Всё кэшируется браузером (хеш-имена +
Service Worker → офлайн).

### Варианты размещения (решение — отдельной задачей деплоя)
1. **Тот же GitHub Pages сайт**, каталог `/toolchain/` — same-origin «бесплатно». Хост-футпринт:
   `.br` 23.5 МБ + 249 `.a` (332 МБ raw / 92 МБ gz) ≈ влезает в лимит Pages 1 ГБ. Воркер фетчит `.a`
   (не `.a.gz`) → для gzip-трафика нужен `Content-Encoding` от хоста (Pages для `.a` может не сжимать).
2. Отдельный хост/CDN с CORS — потребует трюка с blob-worker и абсолютным
   `__webpack_public_path__` внутри worker'а (НЕ для MVP).

Набор для раздачи (без Monaco-демо): `emception.worker.bundle.worker.js`, оба `*.wasm`,
brotli-пакет `*.br`, каталоги `brotli/` и `wasm-package/`, чанк `960.bundle.js`, и **все 249 `.a`**
sysroot-архивов (линковщик берёт нужные по требованию — какие именно, заранее неизвестно).

## Локальная проверка
`test.html` рассчитан на same-origin с тулчейном. Два способа:
1. **Через локальный `/toolchain`** (рекомендуется): артефакты разложены в `<проект>/toolchain/`
   (gitignored), сервим проект и открываем `…/assets/cpp-runtime/test.html`, baseUrl = `/toolchain/`.
   Проверено: cold compile (тянет sysroot `.a`) → run → корректный вывод `sum=15 min=7`.
2. Через `emc-demo`: скопировать `cpp-runtime/` в корень `emc-demo`, открыть
   `http://localhost:8030/cpp-runtime/test.html` (baseUrl `../`).

Сценарии: hello+stdin · sort+cin (batch) · ошибка компиляции (диагностика) ·
бесконечный цикл (таймаут) · cancel.

> Замечание по отладке: несколько параллельных незавершённых `init()`/воркеров на одной странице
> могут «подвесить» друг друга. Чистый прогон = одна страница, один runtime.
