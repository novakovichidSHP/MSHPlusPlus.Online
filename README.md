# МШПлюсПлюс.Онлайн

[![Tests](https://github.com/novakovichidSHP/MSHPlusPlus.Online/actions/workflows/tests.yml/badge.svg)](https://github.com/novakovichidSHP/MSHPlusPlus.Online/actions/workflows/tests.yml)
[![Coverage Status](https://coveralls.io/repos/github/novakovichidSHP/MSHPlusPlus.Online/badge.svg?branch=main)](https://coveralls.io/github/novakovichidSHP/MSHPlusPlus.Online?branch=main)

**Браузерная C++‑IDE для учебных задач.** Компилирует код **настоящим clang** прямо в браузере
(без сервера и аккаунтов), многофайловые проекты, ввод/вывод в консоли, шеринг по неизменяемой ссылке.

🔗 **Демо:** https://novakovichidshp.github.io/MSHPlusPlus.Online/

Это C++‑порт [МШПайтон.Онлайн](https://github.com/novakovichid/MSHPython.Online): сохранены потоки работы,
хоткеи и шеринг, но рантайм Python/Skulpt заменён на C++‑тулчейн, а UI обновлён под современный стиль.

## Что умеет IDE

- **Настоящая компиляция C++** в браузере — clang/LLVM, собранный в WebAssembly ([emception](https://github.com/jprendes/emception)).
  Язык C++20, полный STL, исключения. Никакого интерпретатора-подмножества.
- **Многофайловые проекты** (`main.cpp` + модули `.cpp/.h/.hpp`).
- **Файловый ввод‑вывод:** в панели «Файлы» можно держать файлы‑данные (`.txt/.csv/.dat/...`) рядом с исходниками.
  При запуске они кладутся в файловую систему программы (`std::ifstream("input.txt")` работает), а файлы, которые
  программа записала (`std::ofstream("output.txt")`), автоматически появляются в проекте.
- **Интерактивный ввод (как в обычной консоли):** программа выполняется, доходит до `std::cin`/`std::getline`
  и **приостанавливается**; поле ввода подсвечивается — введите строку, нажмите Enter, выполнение продолжается
  вживую (Asyncify + кастомный `streambuf`, без бэкенда).
- **Сегментированная консоль:** отдельные блоки «Компиляция» (команда + результат) и «Вывод программы».
- **Кликабельная диагностика:** ошибки clang `file:line:col` ведут на строку в редакторе.
- **Редактор CodeMirror 6** с C++‑подсветкой; настройка размера шрифта, хоткеи.
- **Тёмная тема** (тумблер, персист) в фирменной палитре МШП.
- **Шеринг** проекта неизменяемой snapshot‑ссылкой; режим Snapshot (черновик · `Сброс` · `Ремикс`).
- **Импорт/экспорт** проекта (`.cpp/.h/.hpp/.zip/.json`).

> Лимиты выполнения: таймаут компиляции/выполнения, ограничение размера вывода и проекта.
> Песочница WASI/emscripten: без сети, потоков и реальной ФС.

## Тулчейн C++

Компилятор (~24 МБ движка + sysroot) лежит статикой в `toolchain/` и раздаётся **с того же origin**, что и
приложение (требование Web Worker). Первый заход качает **~28 МБ** (движок + нужные sysroot‑библиотеки),
дальше всё из кэша; повторные компиляции — без обращений к сети. Подробности и API рантайма —
[`assets/cpp-runtime/README.md`](assets/cpp-runtime/README.md).

## Быстрый старт

Тулчейн должен быть доступен по `/toolchain/` того же origin (в репозитории он уже лежит).

```bash
python3 -m http.server 8000
# открыть http://127.0.0.1:8000
```

## Разработка

```bash
npm ci                      # зависимости
npm test                    # unit-тесты + покрытие (порог в .c8rc.json)
npm run test:unit           # только unit
npm run test:unit:coverage  # с отчётом покрытия (text/lcov/cobertura)
npm run build:cm6           # пересборка бандла CodeMirror 6 (esbuild)
npm run docs:api            # генерация API-доков (JSDoc → docs/api)
```

Покрытие unit‑тестируемых модулей — **≈98%** (парсер диагностики, позиции в исходнике,
команды редактора, утилиты импорта/шеринга).

CI: GitHub Actions ([`.github/workflows/tests.yml`](.github/workflows/tests.yml)) и
GitLab CI ([`.gitlab-ci.yml`](.gitlab-ci.yml)) — unit + coverage + авто‑генерация API‑доков.

## Структура проекта (основное)

- `index.html` — интерфейс IDE.
- `assets/skulpt-app.js` — основной frontend‑рантайм приложения.
- `assets/skulpt-styles.css` — стили (палитра/раскладка по макету `docs/cpp-port/mockups/ide.html`).
- `assets/cpp-runtime/` — движок выполнения C++: фасад `cpp-runtime.js`, терминируемый `exec-worker.js`,
  парсер диагностики `diagnostics.js`, позиции `source-position.js`, `vendor/comlink.min.mjs`.
- `assets/editor-core/` — ядро редактора (CM6‑адаптер, движок команд, хоткеи).
- `assets/utils/*.js` — утилиты (recent/import/remix).
- `assets/vendor/cm6/` — собранный бандл CodeMirror 6.
- `toolchain/` — артефакты C++‑тулчейна (emception), раздаются статикой (gitignored по `*.gz`).
- `tests/unit/` — unit‑тесты; `assets/cpp-runtime/*.test.mjs` — тесты рантайма.
- `docs/cpp-port/` — исследование, ТЗ, план MVP, спайки, **макеты** (`mockups/`).

## Документация

- Движок C++‑рантайма: `assets/cpp-runtime/README.md`
- Исследование и план порта: `docs/cpp-port/` (RESEARCH_LOG, ТЗ_переработка, PLAN_MVP, ASYNCIFY_spike)
- API (JSDoc): `docs/api/`

## Требования

- Современный Chromium/Chrome/Firefox/Safari (WebAssembly).
- Node.js + npm — для тестов и сборки.
- Python 3 — для локального статического сервера.
