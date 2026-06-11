import test from "node:test";
import assert from "node:assert/strict";
import { cloneFilesForProject, resolveLastActiveFile } from "../../assets/utils/remix-utils.js";

test("cloneFilesForProject deep-copies files and keeps main.py first", () => {
  const source = [
    { name: "utils.py", content: "print(1)\n" },
    { name: "main.py", content: 'print("main")\n' }
  ];
  const cloned = cloneFilesForProject(source, "main.py");
  assert.deepEqual(cloned, [
    { name: "main.py", content: 'print("main")\n' },
    { name: "utils.py", content: "print(1)\n" }
  ]);
  source[1].content = "changed";
  assert.equal(cloned[0].content, 'print("main")\n');
});

test("cloneFilesForProject adds missing main.py", () => {
  const cloned = cloneFilesForProject([{ name: "a.py", content: "" }], "main.py");
  assert.equal(cloned[0].name, "main.py");
  assert.equal(cloned[1].name, "a.py");
});

test("cloneFilesForProject skips invalid entries and normalizes content", () => {
  const cloned = cloneFilesForProject([
    null,
    {},
    { name: "", content: "x" },
    { name: "ok.py", content: 123 }
  ], "main.py");
  assert.deepEqual(cloned, [
    { name: "main.py", content: "" },
    { name: "ok.py", content: "123" }
  ]);
});

test("resolveLastActiveFile prefers valid candidate and falls back to main.py", () => {
  const files = [
    { name: "main.py", content: "" },
    { name: "mod.py", content: "" }
  ];
  assert.equal(resolveLastActiveFile(files, "mod.py", "main.py"), "mod.py");
  assert.equal(resolveLastActiveFile(files, "missing.py", "main.py"), "main.py");
});

test("resolveLastActiveFile falls back to first file or mainFile for empty list", () => {
  const files = [
    { name: "utils.py", content: "" },
    { name: "mod.py", content: "" }
  ];
  assert.equal(resolveLastActiveFile(files, "missing.py", "main.py"), "utils.py");
  assert.equal(resolveLastActiveFile([], "missing.py", "main.py"), "main.py");
});
