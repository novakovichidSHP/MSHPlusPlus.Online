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
  const name = createNumberedImportName("main.py", () => false);
  assert.equal(name, "main1.py");
});

test("createNumberedImportName skips taken numbers", () => {
  const taken = new Set(["main1.py", "main2.py"]);
  const name = createNumberedImportName("main.py", (candidate) => taken.has(candidate));
  assert.equal(name, "main3.py");
});

test("createNumberedImportName handles names without .py", () => {
  const name = createNumberedImportName("utils", () => false);
  assert.equal(name, "utils1.py");
});
