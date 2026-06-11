# Archive Map

`assets/archive/` хранит выведенные из активного runtime артефакты.
Эти файлы остаются в git для истории и сравнения, но не должны подключаться в рабочем коде.

## Canonical Runtime

- `assets/skulpt-app.js`
- `assets/skulpt-styles.css`
- `assets/skulpt-fflate.esm.js`

## Archived Groups

- `runtime-mirror/`
  - исторический зеркальный runtime (`app.js`, `styles.css`)
- `dead-assets/`
  - неиспользуемые бинарники/ассеты
- `logo-sources/`
  - исходники и вспомогательные скрипты генерации логотипа

## Rule

Не импортировать и не подключать файлы из `assets/archive/` в runtime, tests или CI как исполняемый контур.
