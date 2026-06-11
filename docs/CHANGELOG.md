# CHANGELOG

## Unreleased

## 2026-02-07
- Responsive IDE: добавлены два режима адаптива — tablet (`<=1024px`) и mobile (`<=768px`).
- Tablet layout: перекомпоновка с приоритетом `Редактор`/`Консоль`/`Черепаха`; `Модули` вынесены в компактную колонку.
- Tablet UX: кнопка `Горячие клавиши` скрыта; подсказка в поле ввода консоли переведена на формат с кнопкой «Отправить».
- Tablet modules: исправлено переполнение подписей кнопок в панели модулей (перенос текста без выхода за границы).
- Mobile layout: реализован карточный режим с нижней навигацией (`Модули/Редактор/Консоль/Черепаха`) и карточкой `Редактор` по умолчанию.
- Mobile run flow: после запуска автоматически открывается `Черепаха` (если используется turtle) или `Консоль`; при `input()` приоритет у консоли.
- Mobile topbar: упрощён контент, action-кнопки переведены в иконки, `Горячие клавиши` скрыты, `Перезапуск IDE` перенесён рядом с редакторными контролами.
- Mobile UX: обновлена подсказка поля ввода консоли; уменьшены конфликты с экранной клавиатурой (скрытие нижней навигации при открытой клавиатуре).
- Mobile landing: зафиксирована высота блока с анимируемым кодом, чтобы исключить скачки layout.
- UI sizing: кнопки приведены к touch-friendly размерам (ориентир около 44px по высоте).
- Guides: для `for_users.html` и `for_teachers.html` добавлен mobile-режим песочницы с карточной навигацией.
- CI/Docs: добавлена автогенерация `docs/api` на push и проверка JSDoc-покрытия ключевых runtime-методов.
- Snapshot UI: подсказка в режиме снимка перенесена в отдельный блок слева от кнопок и обновлена формулировка.
- Snapshot UI: баннер и кнопки Remix/Reset приведены к общей зелёной палитре с разными оттенками для лучшей читаемости.
- Guides: в `for_users.html` и `for_teachers.html` обновлены тексты и демонстрационное поведение Remix/Reset (без заглушки «Ремикс не работает»).
- Editor: выровнены метрики `textarea`/подсветки и добавлена синхронизация при resize для устранения дрейфа курсора на длинных текстах.
- Runtime: добавлена нормализация переносов строк и фильтрация невидимых/служебных символов перед выполнением, без подмены текста ошибок Python.
- Runtime: предупреждение `Turtle patch failed` скрыто в обычном режиме и выводится только в debug.

## 2026-02-02
- Landing: «Руководство» в шапке, сжатые отступы/заголовок, «Свои посылки…» → «Свои проекты…».
- Recent: корзина, удаление из карточки, компактные карточки и кнопки, шире «Открыть».
- Import: кнопка импорта, поддержка .py/.zip/.json, конфликты с номерным суффиксом.
- Editor/UX: автоотступ по Enter, тосты в центре у шапки, hover с усиленной рамкой, «Cancel» → «Отмена».
- Utils: recent-utils в .js, import-utils вынесены отдельно.
- Docs: синхронизированы HTML‑руководства и тексты, обновлены USER/TECHNICAL/student guides.
- Tests/CI: 30+ unit‑тестов, правка playwright (turtle canvas), workflow и coverage в Coveralls.

## 2026-01-30
- Update guides UI and behavior (35a7113)

## 2026-01-27
- added teacher guide (0ea4eb0)
- Add loading spinner (fb7e920)
- Localize loading screen (359cb48)
- Fix Alt+X hotkey (3e0488e)

## 2026-01-26
- релиз (6fc9014)
- Add console layout toggle (be5dc42)
- Update share button label and docs (3ee57a3)
- Update IDE controls and labels (5da62b3)
- Default project naming scheme (ace6e16)
- just fix commit (1754a02)
- Improve restart UX and input focus (8b30bd4)
- fix: add null check in renderAssets for hidden asset panel (088c53d)
- fix: add cache-busting version to skulpt-app.js to force reload of hotkeys modal (aa44b60)
- docs: add keyboard shortcuts documentation to user and technical guides (2eac01e)
- feat: add editor keyboard shortcuts (Alt+/, Alt+Up/Down, Ctrl+D, Ctrl+Shift+K, Ctrl+L) (81d99ee)
- feat: add keyboard shortcuts (Alt+R, Alt+X, Alt+C, Alt+1/2/3) with UI hints (6a9efac)
- feat: process multi-line console input as separate input() calls (1ef52bb)
- fix: remove duplicate emoji from title, keep only in favicon (8af87fa)
- fix: restore snake emoji in title and favicon (e9ba803)
- feat: convert console input to multi-line textarea with Shift+Enter support (57be30c)
- docs update (dbb41a3)
- docs: generate JSDoc HTML API documentation (8e1d54e)
- docs: add JSDoc comments to main functions and jsdoc config (598ba7a)
- docs update (76e56b2)
- docs: focus README on UX features - sharing, modularity, no technical details (87f72db)
- docs: update to МШПайтон.Онлайн, streamline README, restore sharing docs (e9f0c67)
- docs: remove assets/resources references, mark functionality as deprecated (d3055c1)
- docs: remove pyodide references, move dev notes to docs, add archive to gitignore (1beca1e)
- replaced emojies (5dacac7)
- Rename МШПаха.Онлайн to МШПайтон.Онлайн (c63719b)
- Hide Resources panel and mark asset loading as frozen functionality (27abc09)
- Add documentation about turtle shapes/images limitation (9ac565e)
- another attempt for shapes + improvements (415e841)
- readme update (f34ee3c)
- shape fixes (5f18cbc)
- minor fixes + shape fixes (57c50c5)
- another shape fix (0d7a7b1)
- fixed pics. i hope... (02824a5)
- docs translate and timeout fix (e9ea34e)
- проба пофикситбь картинки (d6325f6)
- skulpt is index now (de9b6cd)
- new panel size 400 400 (02e9c5f)
- fix turtle field size (f1be793)
- fix turtle field size (173a05f)
- fix turtle field size (eaaebaf)
- another fix, screen issues (e86727f)
- fix images again. удалены дублирующиеся механизмы (95e4bcb)
- fix image issue (dd61bc5)
- fix syntax (bc2a295)
- fix images (ac02a18)
- еще разок фиксим, чистим пошаговку (cc08886)
- another fix (3714fd3)
- minor fix (fc8ea7c)
- removed step-by-step (98f4f23)
- Switch to non-minified Skulpt build (d638c5b)
- последний шанс для пошагового (76b2508)
- фикс построчного режима (0b84be8)
- Fix landing branding, hotkeys, and error handling (3402c9a)
- fix title, shortcut and ??? (82b11c0)
- skulpt is main library now (736c2b2)
- Align Skulpt turtle canvas size (a444da0)
- Fix turtle images and multi-turtle support (252d1c8)
- Lock main module and fix assets/imports (2f59b3b)
- Document supported browsers (95c5f53)
- Refine run controls and file naming rules (c25220b)
- Fix shared stdin decoding in Firefox (d0f14dd)
- Use div container for Skulpt turtle canvas (5a217b0)
- Switch Skulpt turtle to native implementation (fac5bb3)
- Fix Skulpt input to return Promise (f628079)
- Refactor Skulpt runtime cleanup and harden modals (64fc869)
- SKULPT ADDED (c99c799)
- another fix (8e193a9)
- Ignore test tooling files (e0c55b2)
- Improve cross-browser compatibility (44e7e76)
- Add home link and project naming (c71efda)
- Hide turtle speed slider (1f427b4)
- Rename to MSHP-Turtle (8e9059a)
