# План полного рефакторинга редактора и runtime

## Контекст

Текущий hotfix стабилизировал рассинхрон слоёв редактора в критичных сценариях.
Следующий этап - системный рефакторинг с миграцией на CodeMirror 6 и удалением legacy-слоя после валидации.

## Принятые решения (зафиксировано)

1. Целевой движок редактора: **CodeMirror 6**.
2. Стратегия внедрения: **dual-run** (CM6 по умолчанию + fallback на legacy через toggle).
3. Приоритет качества: **без дедлайна**, quality-first.
4. UX-изменения по хоткеям: **минимально**, только по прямому согласованию.
5. Стоп-факторы релиза:
   - любой красный `editor-regression`,
   - любой визуальный drift редактора (курсор/выделение/скролл/line numbers).
6. Язык редактора: **Python-only**.
7. Источник истины текста: **только CM6 state**.
8. В новой реализации редактора: **кастомный двухслойный рендер удаляется**.
9. Удаление legacy после миграции: **вручную по чеклисту**.
10. Документация миграции ведётся в двух файлах:
    - `docs/REFACTOR_PLAN.md`,
    - `docs/CM6_MIGRATION.md`.

## Цели этапа рефакторинга

- Полностью убрать класс багов, связанных с двухслойной синхронизацией.
- Снизить стоимость поддержки редактора и тестов.
- Сохранить рабочие учебные сценарии: модули, запуск, консоль, turtle, snapshot/remix, embed, адаптив.
- Обеспечить контролируемый откат на legacy до момента окончательного удаления старого пути.

## Границы и не-цели

- Не внедрять Monaco/альтернативные движки в этом цикле.
- Не менять публичные роуты/URL и продуктовые режимы.
- Не расширять язык редактора за пределы Python в этом цикле.

## High-level roadmap

1. Подготовка dual-run инфраструктуры (`cm6` default, `legacy` fallback).
2. Перенос всего редакторного функционала на CM6.
3. Параллельная стабилизация и регрессионные прогоны.
4. Полная подготовка `archive-ready` (без архивации legacy в этом цикле).
5. Отдельный процесс архивации legacy (вне текущего цикла).

Детальный инженерный план см. в `docs/CM6_MIGRATION.md`.

## Guardrails

- Ни один шаг не принимается без зелёных unit + полного editor e2e набора (`tests/ide.spec.js` + `tests/ide.legacy.spec.js`) в актуальном CI flow.
- `editor-regression` обязателен как release gate.
- Любая деградация line mapping и визуальной синхронизации считается регрессией.
- Любой risky change сопровождается обновлением тестов и документации.

## Текущий статус (2026-02-08)

1. Phase 1 (dual-run foundation) внедрён:
   - добавлен adapter-layer (`cm6` + `legacy`) и factory,
   - добавлен переключатель `Редактор: CM6/Legacy`,
   - режим редактора резолвится из `query -> storage -> default`.
2. Тестовый контур расширен:
   - добавлены editor mode tests,
   - расширен `editor-regression` набор,
   - добавлен sanity-набор для legacy fallback.
3. CI matrix усилен до полного editor e2e набора:
   - Linux: `chromium` + `firefox`,
   - macOS: `webkit`.
4. WebKit остаётся release-gated через отдельный macOS job в CI; локально на Linux возможны инфраструктурные `WebKit internal error` при `page.goto`.
5. Mirror-runtime выведен из активного контура и архивирован в `assets/archive/runtime-mirror/`; canonical runtime: `assets/skulpt-app.js` + `assets/skulpt-styles.css`.
6. Выполнен Phase 2.1 (legacy isolation before removal gate):
   - editor-код разнесён по доменным папкам `assets/editor-core/` и `assets/editor-legacy/`,
   - legacy keyboard/decorations логика вынесена из `assets/skulpt-app.js` в отдельные legacy-модули,
   - CM6 больше не использует legacy keydown forwarding,
   - добавлены unit-тесты на shared command engine и mode-utils.
7. Выполнен Phase 2.2-2.5 (archive-ready preparation):
   - `assets/skulpt-app.js` больше не импортирует `assets/editor-legacy/*` напрямую,
   - adapter boundary расширен: editor runtime orchestration идёт через API адаптера,
   - legacy-only стили изолированы в `assets/editor-legacy/legacy-editor.css`,
   - legacy e2e вынесены в `tests/ide.legacy.spec.js`,
   - добавлен `docs/LEGACY_ARCHIVE_RUNBOOK.md` для отдельного процесса архивации,
   - зафиксирован контракт ширины gutter `max(44px, calc(2ch + 16px))` в CM6 и legacy.
