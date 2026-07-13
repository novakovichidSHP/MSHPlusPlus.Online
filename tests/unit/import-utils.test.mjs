import test from "node:test";
import assert from "node:assert/strict";
import { getBaseName, createNumberedImportName } from "../../assets/utils/import-utils.js";

test("getBaseName extracts filename from paths", () => {
  assert.equal(getBaseName("main.py"), "main.py");
  assert.equal(getBaseName("folder/main.py"), "main.py");
  assert.equal(getBaseName("folder\\sub\\file.py"), "file.py");
});

test("getBaseName returns empty on empty input", () => {
  assert.equal(getBaseName(""), "");
  assert.equal(getBaseName(null), "");
});

test("createNumberedImportName uses numeric suffix", () => {
  const name = createNumberedImportName("main.cpp", () => false);
  assert.equal(name, "main1.cpp");
});

test("createNumberedImportName skips taken numbers", () => {
  const taken = new Set(["main1.cpp", "main2.cpp"]);
  const name = createNumberedImportName("main.cpp", (candidate) => taken.has(candidate));
  assert.equal(name, "main3.cpp");
});

test("createNumberedImportName uses the C++ default for names without extension", () => {
  const name = createNumberedImportName("utils", () => false);
  assert.equal(name, "utils1.cpp");
});

test("createNumberedImportName preserves header and data extensions", () => {
  assert.equal(createNumberedImportName("utils.hpp", () => false), "utils1.hpp");
  assert.equal(createNumberedImportName("input.txt", () => false), "input1.txt");
});

test("createNumberedImportName inserts suffix before the final extension", () => {
  assert.equal(createNumberedImportName("archive.tar.gz", () => false), "archive.tar1.gz");
});
