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
