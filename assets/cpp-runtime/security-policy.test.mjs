import test from "node:test";
import assert from "node:assert/strict";
import {
  findForbiddenJs,
  inspectGeneratedModuleSecurity,
  lockDownNetworkCapabilities
} from "./security-policy.js";

test("source gate rejects a macro alias for emscripten_run_script", () => {
  const hit = findForbiddenJs([{
    name: "main.cpp",
    content: "#define RUN emscripten_run_script\nint main(){ RUN(\"fetch('/')\"); }"
  }]);
  assert.equal(hit?.api, "emscripten_run_script");
  assert.equal(hit?.line, 1);
});

test("source gate rejects direct preprocessor token concatenation", () => {
  const hit = findForbiddenJs([{
    name: "main.cpp",
    content: "#define RUN emscripten_ ## run_script\nint main(){ RUN(\"x\"); }"
  }]);
  assert.equal(hit?.api, "emscripten_run_script");
});

test("source gate ignores comments, literals and non-C++ data files", () => {
  assert.equal(findForbiddenJs([
    { name: "main.cpp", content: "// EM_ASM(x)\nconst char* s = R\"(emscripten_run_script)\";\nint main(){}" },
    { name: "lesson.txt", content: "EM_ASM emscripten_run_script" }
  ]), null);
});

test("source lexer handles block comments, escaped strings, chars and raw strings", () => {
  assert.equal(findForbiddenJs([{
    name: "safe.hpp",
    content: [
      "/* emscripten_run_script */",
      "const char* a = \"EM_ASM(\\\"x\\\")\";",
      "char c = '\\\'';",
      "const char* r = u8R\"tag(EM_JS(foo, (), {}))tag\";"
    ].join("\n")
  }]), null);
  assert.equal(findForbiddenJs([null, { name: "bad", content: "EM_ASM" }]), null);
});

test("post-link gate rejects generated Emscripten JS bridge glue", () => {
  assert.deepEqual(inspectGeneratedModuleSecurity("var ASM_CONSTS = { 1: () => fetch('/') };"), {
    ok: false, api: "ASM_CONSTS"
  });
  assert.equal(inspectGeneratedModuleSecurity("var ASM_CONSTS = {};").ok, true);
  assert.equal(inspectGeneratedModuleSecurity("function _emscripten_run_script(){}").ok, false);
  assert.equal(inspectGeneratedModuleSecurity("function _emscripten_asm_const_int(){}").ok, false);
  assert.equal(inspectGeneratedModuleSecurity("var __em_js__handler = 1").ok, false);
  assert.equal(inspectGeneratedModuleSecurity("function createCppModule(){}").ok, true);
});

test("execution lockdown removes writable network capabilities before eval", () => {
  const fetchCalls = [];
  const scope = {
    fetch(input) { fetchCalls.push(input); return "embedded"; },
    XMLHttpRequest: class {},
    WebSocket: class {},
    EventSource: class {},
    importScripts() {}
  };
  lockDownNetworkCapabilities(scope);
  assert.throws(() => scope.fetch("/private-api"), /Network access is disabled/);
  assert.throws(() => scope.fetch({ url: "data:text/plain,ok", toString: () => "/private-api" }), /Network access is disabled/);
  assert.equal(scope.fetch("data:application/wasm;base64,AA=="), "embedded");
  assert.deepEqual(fetchCalls, ["data:application/wasm;base64,AA=="]);
  for (const name of ["XMLHttpRequest", "WebSocket", "EventSource", "importScripts"]) {
    assert.throws(() => scope[name](), /Network access is disabled/);
    const descriptor = Object.getOwnPropertyDescriptor(scope, name);
    assert.equal(descriptor.configurable, false);
    assert.equal(descriptor.writable, false);
  }
  const fetchDescriptor = Object.getOwnPropertyDescriptor(scope, "fetch");
  assert.equal(fetchDescriptor.configurable, false);
  assert.equal(fetchDescriptor.writable, false);
});

test("execution lockdown tolerates an existing non-configurable capability", () => {
  const scope = {};
  Object.defineProperty(scope, "fetch", { value: null, configurable: false, writable: false });
  assert.doesNotThrow(() => lockDownNetworkCapabilities(scope));
});
