import test from "node:test";
import assert from "node:assert/strict";
import { buildDebugInstrumentation, createDebugKey } from "../../assets/cpp-runtime/debug-instrumentation.js";

test("buildDebugInstrumentation inserts hooks inside functions only", () => {
  const result = buildDebugInstrumentation([
    {
      name: "main.cpp",
      content: "#include <iostream>\nint helper(int x) {\n  return x + 1;\n}\nint main() {\n  int a = 1;\n  if (a) {\n    a = helper(a);\n  }\n  return 0;\n}\n"
    }
  ]);
  const code = result.files[0].content;
  assert.match(code, /auto __cpp_debug_vars = std::string\(""\)/);
  assert.match(code, /__cpp_debug_json_escape/);
  assert.match(code, /extern "C" void __cpp_debug_point/);
  assert.match(code, /__cpp_debug_point\(1, 3, \d+, /);
  assert.match(code, /__cpp_debug_point\(1, 6, \d+, /);
  assert.doesNotMatch(code, /__cpp_debug_point\(1, 1,/);
  assert.ok(result.map.points.some((point) => point.file === "main.cpp" && point.line === 6));
});

test("buildDebugInstrumentation preserves non-source files", () => {
  const result = buildDebugInstrumentation([{ name: "input.txt", content: "42" }]);
  assert.equal(result.files[0].content, "42");
  assert.deepEqual(result.map.points, []);
});

test("createDebugKey uses stable file:line shape", () => {
  assert.equal(createDebugKey("main.cpp", 12), "main.cpp:12");
});

test("buildDebugInstrumentation skips declarations, preprocessor and access labels", () => {
  const result = buildDebugInstrumentation([
    {
      name: "types.hpp",
      content: "#pragma once\nstruct Box {\npublic:\n  int value;\n};\ninline int get(Box b) {\n  // comment only\n  return b.value;\n}\n"
    }
  ]);
  const code = result.files[0].content;
  assert.doesNotMatch(code, /__cpp_debug_point\(1, 1,/);
  assert.doesNotMatch(code, /__cpp_debug_point\(1, 3,/);
  assert.match(code, /__cpp_debug_point\(1, 8, \d+, /);
});

test("buildDebugInstrumentation tracks multiple files and breakpoint list", () => {
  const result = buildDebugInstrumentation([
    { name: "main.cpp", content: "int main() {\n  return helper();\n}\n" },
    { name: "util.cpp", content: "int helper() {\n  int x = 2;\n  return x;\n}\n" }
  ], { breakpoints: ["util.cpp:2"] });
  assert.deepEqual(result.breakpoints, ["util.cpp:2"]);
  assert.ok(result.map.files.some((file) => file.id === 1 && file.name === "main.cpp"));
  assert.ok(result.map.files.some((file) => file.id === 2 && file.name === "util.cpp"));
  assert.ok(result.map.points.some((point) => point.file === "util.cpp" && point.line === 2));
});

test("buildDebugInstrumentation preserves per-file line mapping for headers and sources", () => {
  const result = buildDebugInstrumentation([
    { name: "main.cpp", content: "#include \"util.hpp\"\nint main() {\n  int value = helper(2);\n  return value;\n}\n" },
    { name: "util.hpp", content: "#pragma once\ninline int helper(int x) {\n  int y = x + 1;\n  return y;\n}\n" }
  ], { breakpoints: ["util.hpp:3", "main.cpp:3"] });

  assert.deepEqual(result.breakpoints, ["util.hpp:3", "main.cpp:3"]);
  assert.ok(result.map.files.some((file) => file.id === 1 && file.name === "main.cpp"));
  assert.ok(result.map.files.some((file) => file.id === 2 && file.name === "util.hpp"));
  assert.ok(result.map.points.some((point) => point.file === "main.cpp" && point.line === 3 && point.functionName === "main"));
  assert.ok(result.map.points.some((point) => point.file === "util.hpp" && point.line === 3 && point.functionName === "helper"));
  assert.match(result.files[1].content, /__cpp_debug_value\(x\)/);
});

test("buildDebugInstrumentation snapshots simple variables after declarations", () => {
  const result = buildDebugInstrumentation([
    {
      name: "main.cpp",
      content: "#include <string>\nint main() {\n  int total = 2;\n  bool ok = true;\n  std::string name = \"Ann\";\n  total += 3;\n  return total;\n}\n"
    }
  ]);
  const code = result.files[0].content;
  assert.match(code, /std::string\("\{"\)/);
  assert.match(code, /__cpp_debug_value\(total\)/);
  assert.match(code, /__cpp_debug_value\(ok\)/);
  assert.match(code, /__cpp_debug_value\(name\)/);
});

test("buildDebugInstrumentation handles chars, floats and multiple declarators", () => {
  const result = buildDebugInstrumentation([
    {
      name: "main.cpp",
      content: "int main() {\n  char c = 'x';\n  float ratio = 1.5f;\n  int a = 1, b = 2;\n  b += a;\n  return b;\n}\n"
    }
  ]);
  const code = result.files[0].content;
  assert.match(code, /__cpp_debug_value\(c\)/);
  assert.match(code, /__cpp_debug_value\(ratio\)/);
  assert.match(code, /__cpp_debug_value\(a\)/);
  assert.match(code, /__cpp_debug_value\(b\)/);
});

test("buildDebugInstrumentation skips uninitialized scalars and arrays in declarations", () => {
  const result = buildDebugInstrumentation([
    {
      name: "main.cpp",
      content: "#include <iostream>\nint main() {\n  int a, b, c[1000] = {};\n  std::cin >> a >> b;\n  std::cout << a + b << \" \" << c[0];\n}\n"
    }
  ]);
  const code = result.files[0].content;
  assert.doesNotMatch(code, /__cpp_debug_value\(a\)/);
  assert.doesNotMatch(code, /__cpp_debug_value\(b\)/);
  assert.doesNotMatch(code, /__cpp_debug_value\(c\)/);
});

test("buildDebugInstrumentation keeps scalar direct initialization", () => {
  const result = buildDebugInstrumentation([
    {
      name: "main.cpp",
      content: "#include <string>\nint main() {\n  int a{};\n  int b(2);\n  std::string name(\"Ann\");\n  return a + b;\n}\n"
    }
  ]);
  const code = result.files[0].content;
  assert.match(code, /__cpp_debug_value\(a\)/);
  assert.match(code, /__cpp_debug_value\(b\)/);
  assert.match(code, /__cpp_debug_value\(name\)/);
});

test("buildDebugInstrumentation escapes string-like values through debug helper", () => {
  const result = buildDebugInstrumentation([
    {
      name: "main.cpp",
      content: "#include <string>\nint main() {\n  std::string quoted = \"a\\\"b\";\n  char slash = '\\\\';\n  return 0;\n}\n"
    }
  ]);
  const code = result.files[0].content;
  assert.match(code, /__cpp_debug_json_escape\(const std::string& value\)/);
  assert.match(code, /__cpp_debug_value\(quoted\)/);
  assert.match(code, /__cpp_debug_value\(slash\)/);
});

test("buildDebugInstrumentation ignores unsupported declarations safely", () => {
  const result = buildDebugInstrumentation([
    { name: "main.cpp", content: "int main() {\n  auto x = 1;\n  int *ptr = &x;\n  return x;\n}\n" }
  ]);
  const code = result.files[0].content;
  assert.doesNotMatch(code, /__cpp_debug_value\(ptr\)/);
  assert.doesNotMatch(code, /__cpp_debug_value\(x\)/);
});

test("buildDebugInstrumentation preserves unbraced if/else semantics", () => {
  const result = buildDebugInstrumentation([{
    name: "main.cpp",
    content: "int choose(int x) {\n  if (x)\n    return 1;\n  else\n    return 2;\n}\nint main() {\n  return choose(0);\n}\n"
  }]);
  const code = result.files[0].content;
  assert.doesNotMatch(code, /__cpp_debug_point\(1, 3,/);
  assert.doesNotMatch(code, /__cpp_debug_point\(1, 4,/);
  assert.doesNotMatch(code, /__cpp_debug_point\(1, 5,/);
  assert.match(code, /if \(x\)\n    return 1;\n  else\n    return 2;/);
});

test("buildDebugInstrumentation preserves nested unbraced control flow", () => {
  const result = buildDebugInstrumentation([{
    name: "main.cpp",
    content: "int main() {\n  int n = 2;\n  for (int i = 0; i < n; ++i)\n    if (i)\n      n += i;\n    else\n      n -= 1;\n  while (n < 3)\n    ++n;\n  return n;\n}\n"
  }]);
  const code = result.files[0].content;
  for (const line of [4, 5, 6, 7, 9]) {
    assert.doesNotMatch(code, new RegExp(`__cpp_debug_point\\(1, ${line},`));
  }
  assert.match(code, /__cpp_debug_point\(1, 10,/);
});

test("buildDebugInstrumentation ignores braces and comment markers in quoted literals", () => {
  const result = buildDebugInstrumentation([{
    name: "main.cpp",
    content: "#include <string>\nint main() {\n  std::string open = \"{ // not a comment\";\n  std::string close = \"} /* not a comment */\";\n  char left = '{';\n  char slash = '/';\n  return 0;\n}\nint global = 1;\n"
  }]);
  const code = result.files[0].content;
  assert.match(code, /__cpp_debug_point\(1, 7,/);
  assert.doesNotMatch(code, /__cpp_debug_point\(1, 9,/);
  assert.match(code, /\nint global = 1;\n/);
});

test("buildDebugInstrumentation ignores braces in line, block and raw-string comments/content", () => {
  const result = buildDebugInstrumentation([{
    name: "main.cpp",
    content: "#include <string>\nint main() {\n  // } { braces in a line comment\n  /* } comment across\n     lines { */\n  std::string raw = R\"tag({ // raw } /* text */)tag\";\n  return 0;\n}\nint global = 1;\n"
  }]);
  const code = result.files[0].content;
  assert.match(code, /__cpp_debug_point\(1, 7,/);
  assert.doesNotMatch(code, /__cpp_debug_point\(1, 9,/);
  assert.match(code, /\nint global = 1;\n/);
});

test("buildDebugInstrumentation ignores braces in escaped-newline string literals", () => {
  const result = buildDebugInstrumentation([{
    name: "main.cpp",
    content: "#include <string>\nint main() {\n  std::string text = \"continued \\\n} still text\";\n  return 0;\n}\nint global = 1;\n"
  }]);
  const code = result.files[0].content;
  assert.match(code, /__cpp_debug_point\(1, 5,/);
  assert.doesNotMatch(code, /__cpp_debug_point\(1, 7,/);
  assert.match(code, /\nint global = 1;\n/);
});

test("buildDebugInstrumentation does not insert a hook between do and while", () => {
  const result = buildDebugInstrumentation([{
    name: "main.cpp",
    content: "int main() {\n  int n = 0;\n  do\n    ++n;\n  while (n < 2);\n  return n;\n}\n"
  }]);
  const code = result.files[0].content;
  assert.doesNotMatch(code, /__cpp_debug_point\(1, 4,/);
  assert.doesNotMatch(code, /__cpp_debug_point\(1, 5,/);
  assert.match(code, /__cpp_debug_point\(1, 6,/);
});

test("buildDebugInstrumentation preserves an unbraced nested do-while statement", () => {
  const result = buildDebugInstrumentation([{
    name: "main.cpp",
    content: "int main() {\n  int n = 0;\n  if (n == 0)\n    do\n      ++n;\n    while (n < 2);\n  return n;\n}\n"
  }]);
  const code = result.files[0].content;
  for (const line of [4, 5, 6]) {
    assert.doesNotMatch(code, new RegExp(`__cpp_debug_point\\(1, ${line},`));
  }
  assert.match(code, /__cpp_debug_point\(1, 7,/);
});

test("buildDebugInstrumentation keeps compound expressions inside an unbraced body intact", () => {
  const result = buildDebugInstrumentation([{
    name: "main.cpp",
    content: "int main() {\n  bool run = true;\n  if (run)\n    [run] { return run ? 1 : 0; }();\n  return 0;\n}\n"
  }]);
  const code = result.files[0].content;
  assert.doesNotMatch(code, /__cpp_debug_point\(1, 4,/);
  assert.match(code, /\[run\] \{ return run \? 1 : 0; \}\(\);/);
  assert.match(code, /__cpp_debug_point\(1, 5,/);
});

test("buildDebugInstrumentation preserves separate braced else, catch and unbraced switch bodies", () => {
  const result = buildDebugInstrumentation([{
    name: "main.cpp",
    content: "int main() {\n  int n = 1;\n  if (n) {\n    ++n;\n  }\n  else {\n    --n;\n  }\n  try {\n    switch (n)\n      return n;\n  }\n  catch (...) {\n    return -1;\n  }\n}\n"
  }]);
  const code = result.files[0].content;
  assert.doesNotMatch(code, /__cpp_debug_point\(1, 6,/);
  assert.doesNotMatch(code, /__cpp_debug_point\(1, 11,/);
  assert.doesNotMatch(code, /__cpp_debug_point\(1, 13,/);
  assert.match(code, /__cpp_debug_point\(1, 14,/);
});

test("buildDebugInstrumentation lexes escapes while continuing a quoted literal", () => {
  const content = String.raw`#include <string>
int main() {
  std::string text = "continued \
and \"quoted\" with } and // text";
  return 0;
}
int global = 1;
`;
  const result = buildDebugInstrumentation([{ name: "main.cpp", content }]);
  const code = result.files[0].content;
  assert.match(code, /__cpp_debug_point\(1, 5,/);
  assert.doesNotMatch(code, /__cpp_debug_point\(1, 7,/);
  assert.match(code, /\nint global = 1;\n/);
});
