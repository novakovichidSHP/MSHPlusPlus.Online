# Legacy Archival Runbook

Документ описывает **отдельный** процесс архивации legacy editor после достижения состояния `archive-ready`.

## Цель

Переместить legacy-код и legacy-тесты из активного runtime в архивные директории без потери git-истории.

## Входные условия (archive-ready gate)

1. `assets/skulpt-app.js` не импортирует `assets/editor-legacy/*`.
2. Legacy runtime доступен только через `assets/editor-core/editor-adapter-factory.js` + toggle flow.
3. Legacy-only стили вынесены в `assets/editor-legacy/legacy-editor.css`.
4. Legacy e2e живут в `tests/ide.legacy.spec.js`.
5. Полный тестовый контур зелёный:
   - `npm run test:unit`
   - `npm run test:unit:coverage`
   - `npx playwright test -c playwright.editor-matrix.config.cjs tests/ide.spec.js tests/ide.legacy.spec.js --project=chromium --workers=1`
   - `npx playwright test -c playwright.editor-matrix.config.cjs tests/ide.spec.js tests/ide.legacy.spec.js --project=firefox --workers=1`
   - WebKit release-signal только через macOS CI.

## Быстрые boundary-проверки

```bash
rg -n "editor-legacy/" assets/skulpt-app.js
rg -n "legacy" assets/editor-core/editor-adapter-factory.js assets/utils/editor-mode-utils.js
rg -n "\\[legacy\\]|editorMode:\\s*\"legacy\"|query editor=legacy" tests/ide.legacy.spec.js tests/ide.spec.js
```

Ожидаемо:
- первый запрос не должен возвращать совпадений;
- второй и третий должны показывать только явно ожидаемые boundary-точки.

## План архивации (выполняется отдельным процессом)

1. Перенести legacy runtime файлы в архив (`git mv`):
   - `assets/editor-legacy/legacy-editor-adapter.js`
   - `assets/editor-legacy/legacy-editor-keydown.js`
   - `assets/editor-legacy/legacy-editor-decorations.js`
   - `assets/editor-legacy/legacy-editor.css`
2. Перенести legacy e2e suite в архивный раздел тестов (`git mv`):
   - `tests/ide.legacy.spec.js`
3. Обновить active runtime:
   - удалить переключатель режима редактора из `index.html`;
   - удалить `legacy` режим из `assets/utils/editor-mode-utils.js`;
   - упростить `assets/editor-core/editor-adapter-factory.js` до CM6-only.
4. Обновить CI:
   - убрать legacy suite из активных e2e-команд.
5. Обновить документацию:
   - `README.md`, `docs/CM6_MIGRATION.md`, `docs/REFACTOR_PLAN.md`.

## Выходные артефакты отдельного процесса

1. Отдельный PR/commit series на архивацию legacy.
2. Чистый CM6-only active runtime.
3. Legacy сохранён в `assets/archive/...` и архивных тестовых директориях.
