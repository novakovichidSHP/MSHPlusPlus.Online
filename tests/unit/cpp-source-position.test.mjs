import { test } from "node:test";
import assert from "node:assert/strict";
import { lineColToOffset, offsetToLineCol } from "../../assets/cpp-runtime/source-position.js";

const SRC = "int main(){\n  int x = 5;\n  std::cot << x;\n}\n";
// строки:           1            2             3            4

test("lineColToOffset: первая строка, первая колонка → 0", () => {
  assert.equal(lineColToOffset(SRC, 1, 1), 0);
});

test("lineColToOffset: попадает на нужный символ строки 3", () => {
  // строка 3 = '  std::cot << x;'; колонка 8 (1-based) → символ 'c' в 'cot'
  const off = lineColToOffset(SRC, 3, 8);
  assert.equal(SRC.slice(off, off + 3), "cot");
});

test("lineColToOffset: начало строки 2", () => {
  const off = lineColToOffset(SRC, 2, 1);
  assert.equal(SRC.slice(off, off + 5), "  int");
});

test("lineColToOffset: клампит строки/колонки за пределами", () => {
  assert.equal(lineColToOffset(SRC, 0, 0), 0);          // <1 → строка 1, кол 1
  assert.equal(lineColToOffset("abc", 1, 999), 3);       // колонка за концом → конец строки (len=3)
  assert.equal(lineColToOffset("", 5, 5), 0);            // пустой текст → 0
});

test("offsetToLineCol: обратное преобразование согласовано", () => {
  for (const [line, col] of [[1, 1], [2, 3], [3, 8], [4, 1]]) {
    const off = lineColToOffset(SRC, line, col);
    assert.deepEqual(offsetToLineCol(SRC, off), { line, col });
  }
});

test("offsetToLineCol: offset 0 → строка 1 колонка 1", () => {
  assert.deepEqual(offsetToLineCol(SRC, 0), { line: 1, col: 1 });
});
