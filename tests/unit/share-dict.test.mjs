import { test } from "node:test";
import assert from "node:assert/strict";
import { SHARE_DICT, dictEncode, dictDecode } from "../../assets/utils/share-dict.js";

const ROUNDTRIP_SAMPLES = [
  "",
  "no boilerplate here at all",
  "#include <iostream>\nint main() {\n    std::cout << \"hi\" << std::endl;\n    return 0;\n}",
  "#include <vector>\n#include <string>\nusing namespace std;\nint main() { return 0; }",
  JSON.stringify({
    title: "demo",
    files: [
      { name: "main.cpp", content: "#include <iostream>\nint main(){std::cout<<\"x\"<<std::endl;return 0;}" }
    ],
    lastActiveFile: "main.cpp"
  })
];

test("dictDecode(dictEncode(x)) === x for всех образцов", () => {
  for (const sample of ROUNDTRIP_SAMPLES) {
    const encoded = dictEncode(sample);
    assert.notEqual(encoded, null);
    assert.equal(dictDecode(encoded), sample);
  }
});

test("кодирование укорачивает текст с типовыми конструкциями", () => {
  const src = "#include <iostream>\nusing namespace std;\nint main() { return 0; }";
  const encoded = dictEncode(src);
  assert.ok(encoded.length < src.length, "ожидалось сокращение длины");
});

test("текст без конструкций не меняется (нет ложных подстановок)", () => {
  const src = "let answer = 42; // просто текст";
  assert.equal(dictEncode(src), src);
});

test("dictEncode → null, если текст уже содержит код-плейсхолдер (коллизия)", () => {
  const withCode = "abc" + SHARE_DICT[0][1] + "def";
  assert.equal(dictEncode(withCode), null);
});

test("dictDecode — no-op для текста без кодов", () => {
  const src = "plain text, no placeholders";
  assert.equal(dictDecode(src), src);
});

test("коды и фразы в словаре уникальны", () => {
  const codes = SHARE_DICT.map(([, c]) => c);
  const phrases = SHARE_DICT.map(([p]) => p);
  assert.equal(new Set(codes).size, codes.length, "коды должны быть уникальны");
  assert.equal(new Set(phrases).size, phrases.length, "фразы должны быть уникальны");
});

test("все коды словаря — управляющие байты, отсутствующие в JSON", () => {
  // JSON.stringify никогда не выдаёт сырые \0 \t \n \r и печатные < 0x20.
  const forbidden = new Set([0, 9, 10, 13]);
  for (const [, code] of SHARE_DICT) {
    const cc = code.charCodeAt(0);
    assert.ok(cc < 0x20 || cc === 0x7f, `код ${cc} должен быть control-байтом`);
    assert.ok(!forbidden.has(cc), `код ${cc} не должен встречаться в JSON`);
  }
});

test("повторяющиеся конструкции тоже сворачиваются и восстанавливаются", () => {
  const src = "std::cout << std::cout << std::cout << std::endl;";
  const encoded = dictEncode(src);
  assert.ok(encoded.length < src.length);
  assert.equal(dictDecode(encoded), src);
});

test("частичные совпадения с std:: не ломают обратимость", () => {
  const src = "std::sort(v.begin(), v.end()); std::map<int,int> m;";
  assert.equal(dictDecode(dictEncode(src)), src);
});

test("не-строка: dictEncode→null, dictDecode→возвращает как есть", () => {
  assert.equal(dictEncode(null), null);
  assert.equal(dictEncode(42), null);
  assert.equal(dictDecode(null), null);
  assert.equal(dictDecode(undefined), undefined);
});
