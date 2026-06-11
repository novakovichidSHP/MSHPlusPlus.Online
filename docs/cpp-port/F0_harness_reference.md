# F0 — референс интеграционного харнесса (доказано)

> Рабочий рецепт «emception → C++ модуль → прямой stdout + batch stdin», подтверждён руками 2026-06-11
> на локальной сборке `C:\_Vibe_coding\_research\emc-demo` (ветка `demo`, порт 8030).
> Результат прогона: `n=5 sorted: 1 3 5 8 9 sum=26` (ввод `"5\n5 3 8 1 9\n"`), выполнение ~18 мс.

## API emception (из `demo/emception.js`)
- `new Emception()` → `await emception.init()`.
- В demo инстанс экспонируется: `window.emception = Comlink.wrap(new EmceptionWorker())`, `window.Comlink`.
- Колбэки тулчейна: `emception.onstdout = Comlink.proxy(cb)`, `emception.onstderr = Comlink.proxy(cb)` (диагностика компилятора).
- ФС: `await emception.fileSystem.writeFile(path, src)`, `await emception.fileSystem.readFile(path, {encoding:'utf8'})`.
- Команда: `const result = await emception.run("em++ ... main.cpp -o out.js")` → `{returncode, ...}`.

## Шаг 1 — компиляция в МОДУЛЬ (не HTML, без canvas)
Ключевые флаги: `-sMODULARIZE=1 -sEXPORT_NAME=createCpp -sSINGLE_FILE=1` (wasm встроен в JS → без доп. fetch),
`-sEXIT_RUNTIME=1`, обычные `-O2 -fexceptions -std=c++20`.
```js
await emception.fileSystem.writeFile('/working/main.cpp', src);
const cmd = 'em++ -O2 -fexceptions -sSINGLE_FILE=1 -sMODULARIZE=1 -sEXPORT_NAME=createCpp -sEXIT_RUNTIME=1 main.cpp -o out.js';
const result = await emception.run(cmd);            // returncode 0
const js = await emception.fileSystem.readFile('/working/out.js', {encoding:'utf8'}); // ~309 КБ
```
> Диагностику компилятора берём из `onstdout/onstderr` → блок «Компиляция» в UI.
> На неуспехе (`returncode != 0`) парсим `file:line:col: error` для кликабельных ссылок.

## Шаг 2 — инстанс модуля с прямым stdout + batch stdin
```js
const out = [];
const inputBytes = new TextEncoder().encode("5\n5 3 8 1 9\n");   // batch stdin
let ip = 0;
const config = {
  print:    s => out.push(s),                 // прямой stdout (без canvas)
  printErr: s => out.push('[stderr] ' + s),   // stderr программы
  stdin:    () => ip < inputBytes.length ? inputBytes[ip++] : null,
};
(0, eval)(js);                                 // определяет global createCpp (SINGLE_FILE → wasm уже внутри)
await (window.createCpp)(config);              // INVOKE_RUN по умолчанию → main() исполняется
const programOutput = out.join("\n");          // "n=5 sorted: 1 3 5 8 9 sum=26"
```

## Для реальной интеграции (этап F1)
- Гонять и компиляцию, и инстанс модуля в **Web Worker** (не блокировать UI; таймауты выполнения/компиляции).
- `eval` заменить на безопасную загрузку модуля (Blob URL + import / Function), без глобалей.
- stdin: подавать буфер из поля «Ввод»; поддержать пустой ввод.
- Многофайловые проекты: `writeFile` каждый `.cpp/.h` в `/working`, компилировать список единиц.
- Таймаут выполнения через прерывание worker'а; лимит размера вывода.
- НЕ использовать `--proxy-to-worker` и `-o main.html` (это путь demo с canvas).
