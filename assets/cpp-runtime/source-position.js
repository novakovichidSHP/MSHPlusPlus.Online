/**
 * Преобразования позиций в исходнике для cpp-runtime / редактора.
 *
 * clang выдаёт диагностику в виде 1-based строки и колонки; редактору (CM6)
 * нужен символьный offset от начала текста. Эти функции — мост между ними.
 */

/**
 * 1-based строка/колонка → символьный offset (0-based) в тексте.
 * Колонки/строки за пределами текста клампятся к ближайшей валидной позиции.
 * @param {string} text
 * @param {number} line  — 1-based номер строки
 * @param {number} col   — 1-based номер колонки
 * @returns {number}
 */
export function lineColToOffset(text, line, col) {
  const rows = String(text ?? "").split("\n");
  // строку клампим к [1 .. число строк]
  const targetIdx = Math.min(Math.max(1, Math.floor(Number(line) || 1)), rows.length) - 1;
  let offset = 0;
  for (let i = 0; i < targetIdx; i += 1) {
    offset += rows[i].length + 1; // +1 за символ перевода строки
  }
  // колонку клампим к длине самой строки (не выходим за её конец)
  const lineLength = rows[targetIdx] ? rows[targetIdx].length : 0;
  const colOffset = Math.min(Math.max(0, (Number(col) || 1) - 1), lineLength);
  return offset + colOffset;
}

/**
 * Символьный offset → { line, col } (оба 1-based). Обратное к lineColToOffset.
 * @param {string} text
 * @param {number} offset
 * @returns {{line:number, col:number}}
 */
export function offsetToLineCol(text, offset) {
  const str = String(text ?? "");
  const pos = Math.max(0, Math.min(str.length, Math.floor(Number(offset) || 0)));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < pos; i += 1) {
    if (str[i] === "\n") {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, col: pos - lineStart + 1 };
}
