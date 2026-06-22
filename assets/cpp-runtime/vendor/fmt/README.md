# Vendored {fmt} (header-only)

- **Источник:** https://github.com/fmtlib/fmt
- **Версия:** 10.2.1 (совместима с clang16 / libc++14 текущего тулчейна)
- **Лицензия:** MIT (см. `LICENSE`)

## Зачем

Тулчейн (emception) несёт libc++14, в котором нет рабочего `std::format`
(нужен libc++17+). Пока пересборка тулчейна заморожена
(`docs/cpp-port/TOOLCHAIN_REBUILD.md`), `std::format` даётся бэкпортом поверх
header-only `{fmt}`: шим `namespace std { using ::fmt::format; … }`.

## Состав (минимум для `fmt::format`)

Только то, что нужно строковому `fmt::format`:

- `core.h`
- `format.h`        — при `FMT_HEADER_ONLY` тянет `format-inl.h`
- `format-inl.h`

`os.h`/`printf.h`/`ostream.h`/`ranges.h`/`chrono.h` и пр. **не** вендорятся.

## Как подключается

См. `assets/cpp-runtime/cpp-runtime.js`: `FMT_SHIM_SRC`, `_ensureFmtVendor()`,
детект `FMT_DETECT_RE`. Хедеры пишутся плоско в `/working` ФС воркера и
force-include'ятся через `-include __std_format.hpp` только когда исходник
использует `std::format`.

## Обновление версии

Заменить три хедера + `LICENSE` из соответствующего тега `fmtlib/fmt`,
прогнать `assets/cpp-runtime/test.html` (кнопки 6/7).
