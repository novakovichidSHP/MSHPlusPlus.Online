import test from "node:test";
import assert from "node:assert/strict";
import { detectTurtleUsage, getTurtlePatchAssetNames } from "../../assets/utils/turtle-runtime-utils.js";

function file(name, content) {
  return { name, content };
}

test("detectTurtleUsage: returns false for empty file list", () => {
  assert.equal(detectTurtleUsage([]), false);
});

test("detectTurtleUsage: returns false when entry file is missing", () => {
  assert.equal(detectTurtleUsage([file("utils.py", "import turtle\n")]), false);
});

test("detectTurtleUsage: detects direct import turtle in main.py", () => {
  assert.equal(detectTurtleUsage([file("main.py", "import turtle\n")]), true);
});

test("detectTurtleUsage: detects from turtle import in main.py", () => {
  assert.equal(detectTurtleUsage([file("main.py", "from turtle import Turtle\n")]), true);
});

test("detectTurtleUsage: detects turtle in comma-separated import list", () => {
  assert.equal(detectTurtleUsage([file("main.py", "import math, turtle, random\n")]), true);
});

test("detectTurtleUsage: ignores comment-only mentions", () => {
  assert.equal(detectTurtleUsage([file("main.py", "# import turtle\nprint(1)\n")]), false);
});

test("detectTurtleUsage: ignores string literal mentions", () => {
  assert.equal(detectTurtleUsage([file("main.py", 'print("import turtle")\n')]), false);
});

test("detectTurtleUsage: detects turtle via one-hop local import", () => {
  assert.equal(detectTurtleUsage([
    file("main.py", "import shapes\n"),
    file("shapes.py", "import turtle\n")
  ]), true);
});

test("detectTurtleUsage: detects turtle via transitive local imports", () => {
  assert.equal(detectTurtleUsage([
    file("main.py", "import app\n"),
    file("app.py", "import shapes\n"),
    file("shapes.py", "from turtle import Turtle\n")
  ]), true);
});

test("detectTurtleUsage: returns false for transitive graph without turtle", () => {
  assert.equal(detectTurtleUsage([
    file("main.py", "import app\n"),
    file("app.py", "import math_utils\n"),
    file("math_utils.py", "print(1)\n")
  ]), false);
});

test("detectTurtleUsage: handles cyclic imports with turtle present", () => {
  assert.equal(detectTurtleUsage([
    file("main.py", "import a\n"),
    file("a.py", "import b\n"),
    file("b.py", "import a\nimport turtle\n")
  ]), true);
});

test("detectTurtleUsage: handles cyclic imports without turtle", () => {
  assert.equal(detectTurtleUsage([
    file("main.py", "import a\n"),
    file("a.py", "import b\n"),
    file("b.py", "import a\n")
  ]), false);
});

test("detectTurtleUsage: resolves root file for dotted imports", () => {
  assert.equal(detectTurtleUsage([
    file("main.py", "import pkg.helpers\n"),
    file("pkg.py", "import turtle\n")
  ]), true);
});

test("detectTurtleUsage: supports custom entry file name", () => {
  assert.equal(detectTurtleUsage([
    file("main.py", "print('no turtle')\n"),
    file("boot.py", "import turtle\n")
  ], { entryFileName: "boot.py" }), true);
});

test("detectTurtleUsage: ignores missing local modules", () => {
  assert.equal(detectTurtleUsage([
    file("main.py", "import missing_local_module\n")
  ]), false);
});

test("detectTurtleUsage: tolerates non-string file contents", () => {
  assert.equal(detectTurtleUsage([
    file("main.py", null),
    file("a.py", 12345)
  ]), false);
});

test("detectTurtleUsage: supports CRLF line endings", () => {
  assert.equal(detectTurtleUsage([
    file("main.py", "import turtle\r\nprint('ok')\r\n")
  ]), true);
});

test("getTurtlePatchAssetNames: returns empty for non-array input", () => {
  assert.deepEqual(getTurtlePatchAssetNames(null), []);
});

test("getTurtlePatchAssetNames: default image filter keeps relative image names", () => {
  const names = getTurtlePatchAssetNames([
    { name: "sprite.PNG" },
    { name: "note.txt" },
    { name: "/absolute/banner.png" },
    { name: "nested/bg.webp" },
    { name: "shape.svg" }
  ]);
  assert.deepEqual(names, ["sprite.PNG", "nested/bg.webp", "shape.svg"]);
});

test("getTurtlePatchAssetNames: custom predicate overrides default behavior", () => {
  const names = getTurtlePatchAssetNames(
    [{ name: "a.data" }, { name: "b.png" }, { name: "/root/c.data" }, { name: "d.data" }],
    (name) => name.endsWith(".data")
  );
  assert.deepEqual(names, ["a.data", "d.data"]);
});
