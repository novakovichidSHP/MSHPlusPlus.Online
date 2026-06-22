/**
 * share-dict — словарь-эталон типовых C++-конструкций для коротких share-ссылок.
 *
 * Зачем: в коротких программах boilerplate (`#include <iostream>`, `int main`, …)
 * встречается ОДИН раз, поэтому DEFLATE не сжимает его back-reference'ом, а нативный
 * `CompressionStream` не поддерживает preset-словарь. Поэтому ДО сжатия подменяем
 * типовые фразы на редкие управляющие байты (U+0001…), которых заведомо нет в тексте
 * `JSON.stringify` (он экранирует все control-символы как `\uXXXX`). Полностью обратимо.
 *
 * Кодирование жадное (длинные фразы раньше — max-munch), декодирование от порядка
 * не зависит (каждый код → ровно одна фраза, фразы не содержат кодов).
 *
 * КОНТРАКТ СОВМЕСТИМОСТИ: код подстановки привязан к ФРАЗЕ (по индексу в PHRASES),
 * а не к её длине/позиции при кодировании. Нельзя переупорядочивать, удалять или
 * менять существующие фразы — иначе ранее выданные ссылки префикса `d`/`n`
 * раскодируются неверно. Разрешено ТОЛЬКО ДОБАВЛЯТЬ новые фразы в КОНЕЦ списка.
 */

// Управляющие байты, отсутствующие в JSON-тексте: исключены \0(0), \t(9), \n(10), \r(13).
const CODES = [
  1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
  24, 25, 26, 27, 28, 29, 30, 31, 127
];

// Типовые конструкции. ТОЛЬКО ДОБАВЛЯТЬ в конец (см. КОНТРАКТ СОВМЕСТИМОСТИ).
const PHRASES = [
  "#include <iostream>",
  "#include <algorithm>",
  "#include <vector>",
  "#include <string>",
  "#include <cstring>",
  "#include <cstdio>",
  "#include <cmath>",
  "#include <map>",
  "#include <set>",
  "#include <",
  "using namespace std;",
  "int main()",
  "int main(",
  "return 0;",
  "std::vector",
  "std::string",
  "std::cout",
  "std::endl",
  "std::cin",
  "std::",
  "cout << ",
  "cin >> ",
  " << endl",
  "endl;",
  "for (int i = 0; i < ",
  "while ("
];

if (PHRASES.length > CODES.length) {
  throw new Error("share-dict: фраз больше, чем доступных кодов");
}

/** Пары [фраза, код-символ]. Индекс фразы фиксирует её код (см. контракт). */
export const SHARE_DICT = PHRASES.map((phrase, i) => [phrase, String.fromCharCode(CODES[i])]);

// Для кодирования — длинные фразы раньше (жадный max-munch), чтобы "std::cout"
// подменялся целиком до "std::". На декод порядок не влияет.
const ENCODE_ORDER = SHARE_DICT.slice().sort((a, b) => b[0].length - a[0].length);

/**
 * Подменяет типовые конструкции на коды-плейсхолдеры.
 * @param {string} text — текст (обычно JSON проекта).
 * @returns {string|null} текст с подстановками, либо null если применять нельзя
 *   (текст уже содержит код-плейсхолдер — для JSON.stringify невозможно, но проверяем).
 */
export function dictEncode(text) {
  if (typeof text !== "string") return null;
  for (const [, code] of SHARE_DICT) {
    if (text.indexOf(code) !== -1) return null; // коллизия — словарь неприменим
  }
  let out = text;
  for (const [phrase, code] of ENCODE_ORDER) {
    if (out.indexOf(phrase) !== -1) out = out.split(phrase).join(code);
  }
  return out;
}

/**
 * Обратная подстановка: коды-плейсхолдеры → исходные конструкции.
 * @param {string} text
 * @returns {string}
 */
export function dictDecode(text) {
  if (typeof text !== "string") return text;
  let out = text;
  for (const [phrase, code] of SHARE_DICT) {
    if (out.indexOf(code) !== -1) out = out.split(code).join(phrase);
  }
  return out;
}
