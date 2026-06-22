# Пересборка тулчейна: libc++ 17/18 + потоки

Цель — закрыть пробелы C++20, которые упираются **в библиотеку**, а не в компилятор.

> ## СТАТУС (заморожено 2026-06): пересборка ДОКАЗАНА, но блокируется портом движка
>
> Реально пройдено в WSL/Docker (32 ядра), артефакты — в `~/emc/build`, deploy-копия — `toolchain.new18/`:
> - ✅ **Тулчейн libc++18 СОБРАН**: emscripten **3.1.64** (`_LIBCPP_VERSION 180100`), LLVM **18.1.8** (clang18),
>   binaryen пересобран. clang→WASM собрался (победили OOM лимитом `-j3` под 15 ГБ WSL, и `-Werror` у binaryen
>   из-за deprecation `allocateUTF8`).
> - ✅ **`std::ranges` и `std::format` КОМПИЛЯТСЯ И ВЫПОЛНЯЮТСЯ** — проверено прямым `em++` в контейнере
>   (`ranges_ok min=1 sum=60`, `format 2+3=5`). Цель достижима.
> - ❌ **БЛОКЕР: движок emception (2022) несовместим с рантаймом emscripten 3.1.64.** Это ПОРТ JS-движка, не бамп.
>   Найдено:
>   - emscripten сделал MODULARIZE **async-функцией** → `await new Module()` падает «Module is not a constructor».
>     **Фикс найден**: `src/EmProcess.mjs` → `await Module(` (без `new`). Помогает, открывает следующее:
>   - box-wasm не подгружается из виртуальной ФС (`FS.readFile("/wasm/llvm-box.wasm")` пуст на инстанцировании →
>     `WebAssembly.instantiate(): BufferSource empty`). Ещё расхождение init/FS-API; таких мест, вероятно, ещё несколько.
> - ❌ **Upstream `jprendes/emception` ТОЖЕ застрял на 3.1.24** (проверено `git clone`): тот же `await new Module`,
>   тот же LLVM-коммит, последние коммиты — CI/опечатки. «Малой кровью» через upstream НЕ выйдет — порт нужен в любом случае.
>
> **Build-kit (воспроизводимо, вне app-репо):** `_research/emception/` + `rebuild-setup.sh`, `apply-llvm-edits.sh`,
> `apply-em-edits.sh` (robust-правки версий/патчей), webpack-фиксы (scoped `url:false`, node-fallbacks).
> Бамп: `make.sh`/`Dockerfile`→3.1.64, `build-llvm.sh` COMMIT→`llvmorg-18.1.8`, `build.sh`→`-j3`+PATH, FROZEN_CACHE,
> binaryen build.ninja без `-Werror`.
>
> **Что осталось (если возобновлять — вариант A):** допортировать движок под 3.1.64 (wasm-loading из FS + дальнейшие
> init/FS-несовместимости), затем webpack→deploy→регресс A–G. Открытый отладочный фронт по внутренностям emception.
> **Текущее состояние app:** восстановлен рабочий тулчейн libc++14 (всё, кроме ranges/format/threads, работает).

## Диагноз (замерено в браузере на текущем тулчейне)

| | Версия | Источник |
|---|---|---|
| Компилятор | **clang 16.0** (`__clang_major__`) | современный, все языковые фичи C++20 есть |
| Стандартная библиотека | **libc++ 14000** (`_LIBCPP_VERSION`) | **узкое место** |
| emscripten | **3.1.24** | `_research/emception/docker/Dockerfile` → `FROM emscripten/emsdk:3.1.24` |

Что не работает из-за libc++ 14 (проверено компиляцией):
- `std::ranges::sort` / `std::ranges::views` — нет (появились в libc++ **15**).
- `std::format` — ошибка компиляции (рабочим стал в libc++ **16–17**).
- `std::thread` — компилируется, но кидает `Resource temporarily unavailable`
  (WASM без pthreads). Ловится, не падает.

Что РАБОТАЕТ (полностью): все контейнеры, алгоритмы, ООП/шаблоны/лямбды, `optional/variant/string_view`,
`<regex>`, `<random>`, `<chrono>`, `<filesystem>`, `<sstream>`, исключения, C-stdio, `std::atomic`.

## Что нужно для libc++ 17/18 (нативные ranges/format)

> **Проверено руками (2026-06, Docker):** образ `emscripten/emsdk:3.1.46` несёт
> **libc++ 16** (`_LIBCPP_VERSION 160006`), а НЕ 17. Для уверенных `ranges`+`format`
> целиться нужно выше. И ВАЖНО: вендоренный `packs/emscripten/emscripten.patch`
> (привязан к 3.1.24) **не применяется** к 3.1.46 — оба ханка (`tools/shared.py`
> check_sanity, `src/proxyClient.js`) отклоняются из-за смещения контекста. Патч
> придётся **регенерировать** под целевую версию. То же касается `patches/llvm-project.patch`,
> если поднимать и LLVM-коммит (нужно при libc++18 — ему требуется clang ≥17).

Версия libc++ определяется версией emscripten в `packs/emscripten/make.sh`
(строки 13 — zip-исходник, 51 — `docker create emscripten/emsdk:<ver>`). Ориентиры:
- libc++ **16** → emscripten ~3.1.46 (проверено)
- libc++ **17** → emscripten ~3.1.52–3.1.55 (совместим с текущим clang16)
- libc++ **18** → emscripten ~3.1.61+ (требует bump LLVM-коммита → clang17, + регенерация llvm-патча)

> Минимум для `std::ranges::sort` — libc++ **15**; для надёжного `std::format` — libc++ **17**.
> Рекомендация: **libc++ 17** (emscripten ~3.1.55), т.к. совместим с уже собранным clang16
> и не тянет за собой пересборку LLVM/clang.

### Почему это не «одна команда»

- LLVM-артефакта (`build/llvm/bin/llvm-box.mjs`) локально нет → `build-emception.sh` не
  соберёт dist без полной `build-llvm.sh` (clang→WASM, **часы**).
- Патчи под новую версию не ложатся → ручная регенерация перед сборкой.
- Сборку реально гнать на **Linux/CI** (на Windows — friction: SSL, монтирование, docker-in-docker).

## СТАТУС ПОПЫТКИ (2026-06, ЗАФИКСИРОВАНО — порт не завершён)

Полная пересборка на **emscripten 3.1.64 / LLVM 18.1.8** была выполнена в WSL2+Docker (32 ядра).
**Тулчейн собрался; libc++18 на уровне компиляции работает** — прямой `em++` в контейнере 3.1.64
компилирует и выполняет `std::ranges::sort`, `views::filter|transform`, `std::format`
(`ranges_ok min=1 sum=60`, `format 2+3=5`). Артефакты: `~/emc/build/` в WSL (LLVM закэширован).

Что пришлось победить в СБОРКЕ (всё в `_research/emception`, скрипты `rebuild-setup.sh`,
`apply-llvm-edits.sh`, `apply-em-edits.sh`):
- бамп emsdk 3.1.24→3.1.64 (make.sh строки 13/51) + Dockerfile + LLVM-коммит→`llvmorg-18.1.8`;
- патчи emception (привязаны к 3.1.24) не ложатся → заменены robust-правками (по тексту);
- **OOM**: clang→WASM на `-j32` жрёт >15ГБ (WSL=50% от 31ГБ хоста) → `CMAKE_BUILD_PARALLEL_LEVEL=3`;
- binaryen падал на `-Werror` (emsdk 3.1.64 deprecated `allocateUTF8`) → снять `-Werror` из build.ninja;
- `FROZEN_CACHE=True` в emscripten config вместо патча shared.py;
- `clang++ not found` в build-tooling → `export PATH=/emsdk/upstream/bin:...` в build.sh.

**ГДЕ ЗАСТРЯЛО — порт JS-ДВИЖКА emception под рантайм emscripten 3.1.64 (открытый каскад):**
1. ✅ MODULARIZE стал async → `EmProcess.mjs`: `await new Module()` → `await Module()`.
2. ✅ `split_packages.js` не разбил sysroot под новую структуру (1 пак вместо ~30) →
   `demo/emception.js` `preloads` сведён к `["cpython","emscripten","wasm"]` (тяжелее init).
3. ✅ webpack vs emscripten-3.1.64 `.mjs` (node-ветки `require('module')`, `new URL("./")`):
   fallback'и + точечный `parser.javascript.url=false` ТОЛЬКО для box-.mjs.
4. ✅ **bootstrap-модули (wasm-package=FileSystem, brotli) грузятся ДО появления FS** и не находили
   свой `*.wasm` (`WebAssembly.instantiate(): BufferSource empty`) → `-sSINGLE_FILE=1` в
   `tooling/wasm-package/compile_wasm.sh` и `build-brotli.sh` (wasm встроен в .mjs), + убран
   `CopyWebpackPlugin` из webpack.config.js.
5. ✅ **`EmProcess.exec` падал `-42`** на распаковке пака: `this._module.allocateUTF8` deprecated в
   3.1.64 (но это оказалось не корнем — exec доходил до `_main`).
6. ❌ **`wasm-package unpack` бросает `FS error: ENOENT` в `Object.lookup`** (кастомный PROXYFS-мост
   `emlib/fsroot.js`): `this.cwd = opts.cwd` НЕ делает реальный chdir (нет сеттера), а навигация по
   FS внутри распаковки падает — `FS.lookupPath`/структура нод emscripten **изменились в 3.1.64**.
   Это самый связанный с внутренностями emscripten слой; за ним почти наверняка ещё.

**ВЫВОД (проверено до дна):** upstream emception (jprendes/emception) **тоже на 3.1.24/libc++14** —
готового движка под новый emscripten НЕТ. Порт 2022-движка под рантайм 3.1.64 — **глубокий
многослойный труд**: пройдено 6 слоёв (см. выше), 7-й = переписать `fsroot.js`/PROXYFS под FS-API
3.1.64. Это специализированный многодневный порт, не сессия.

**Что осталось РАБОЧИМ:** `/toolchain/` (libc++14) цел и не тронут — весь школьный/олимпиадный C++
(контейнеры, алгоритмы, ООП, строки, `<regex>`, `<random>`, `<chrono>`, `<filesystem>`, файловый I/O,
интерактивный `std::cin`) работает. Нативно недоступны только `std::ranges`/`std::format`/threads.

**Где артефакты порта (возобновление):** WSL `~/emc` (LLVM/binaryen/clang18 закэшированы, dist собирается
за минуты); скрипты-фиксы — `_research/emception/*.sh` + `patch-*.py`. Диагностические правки (UNPACKDIAG,
exec EXC-лог) — в `~/emc/build/emception/*.mjs`, снять перед финалом (`cp` из `src/`). Следующий шаг —
порт `emlib/fsroot.js` (PROXYFS lookupPath/node) под emscripten 3.1.64.

### Шаги

1. В `_research/emception/docker/Dockerfile` поднять базовый образ:
   ```diff
   - FROM emscripten/emsdk:3.1.24
   + FROM emscripten/emsdk:3.1.64
   ```
   (3.1.64 — недавняя стабильная; build-скрипты тестировались на 3.1.24, новее — «на свой риск»,
   потому и нужен полный тест-прогон. При поломке build-скриптов откатиться на 3.1.45/3.1.51.)

2. (Опц.) В `build-llvm.sh` поднять версию LLVM в тон emscripten — комментарий в скрипте это допускает.

3. Запустить пересборку (нужен **запущенный Docker-демон**, ~часы,多 ГБ диска):
   ```bash
   cd _research/emception
   ./build-with-docker.sh          # build LLVM→wasm + sysroot + brotli-пак + .a-библиотеки
   ```

4. Скопировать свежий тулчейн в приложение:
   ```bash
   # из dist эмцепшна → в repo
   cp -r _research/emception/build/dist/* "<repo>/toolchain/"
   ```

5. **Регресс-тест ОБЯЗАТЕЛЕН** (тулчейн контентно-адресуемый, легко словить ABI-рассинхрон):
   - открыть `assets/cpp-runtime/test.html`, прогнать батарею (Программы A–G из истории проверки покрытия);
   - убедиться, что мейнстрим всё ещё компилируется И заработали `std::ranges::sort`, `std::format`.

## Что нужно для `std::thread` (дополнительно к пункту выше)

Потоки в WASM требуют pthreads, а они — `SharedArrayBuffer`, который браузер даёт только
при заголовках ответа `COOP/COEP`. Статичный хостинг (GitHub Pages) их не шлёт.

1. Тулчейн собрать с pthread-вариантом sysroot и компилировать программы с `-pthread`
   (+ `-sPROXY_TO_PTHREAD` для блокирующего main, либо `-sPTHREAD_POOL_SIZE`). Это правка
   `moduleFlags` в `assets/cpp-runtime/cpp-runtime.js` и пересборка пака с pthread-либами.
2. На клиенте включить cross-origin isolation без серверных заголовков — через
   **coi-serviceworker** (`coi-serviceworker.min.js`): он перехватывает ответы и проставляет
   `COOP: same-origin` + `COEP: require-corp`, после чего `crossOriginIsolated === true` и
   `SharedArrayBuffer` доступен. Подключение: один `<script>` в `<head>` + один первый
   перезаход страницы (SW делает reload, чтобы применить политику).
3. Проверить: `thread t([]{...}); t.join();` больше не кидает.

> ⚠️ Потоки в exec-worker (он сам уже Web Worker): pthread-программа поднимает вложенные воркеры —
> убедиться, что `new Worker` из воркера разрешён политикой и пути воркеров корректны.

## Альтернатива «работает раньше пересборки» (header-only бэкпорты)

Если нужны ranges/format ДО тяжёлой пересборки — вендорим header-only библиотеки и
force-include'им прелюдию (механизм как у `__cppio.cpp`):
- **`{fmt}`** (header-only) → рабочий `fmt::format`; тонкий шим `namespace std { using fmt::format; … }`
  даёт и `std::format` (технически нестандартно, но на практике работает).
- **range-v3** (header-only) → `ranges::sort`/`views`; алиас `namespace std { namespace ranges = ::ranges; }`
  покрывает базовые случаи (API близок, но не 1:1 с `std::ranges`).
- Потоки так не лечатся — только пункт выше.

Минусы: чуть дольше компиляция (большие хедеры), лёгкая «нестандартность» под капотом.
Плюс: не трогает бинарный тулчейн, обратимо, даёт результат сразу.
