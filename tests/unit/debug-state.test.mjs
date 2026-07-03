import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDebugCommand,
  createDebugSession,
  decodeDebugVars,
  evaluateDebugPoint
} from "../../assets/cpp-runtime/debug-state.js";

const debugMap = {
  files: [{ id: 1, name: "main.cpp" }],
  functions: [
    { id: 0, name: "<global>" },
    { id: 1, name: "main" },
    { id: 2, name: "helper" }
  ]
};

test("debug session pauses on first entry point", () => {
  const session = createDebugSession({ map: debugMap, breakpoints: [] });
  const result = evaluateDebugPoint(session, 1, 3, 1);
  assert.equal(result.pause, true);
  assert.equal(result.enteredPause, true);
  assert.equal(result.frame.file, "main.cpp");
  assert.equal(result.frame.functionName, "main");
});

test("paused session does not re-enter pause on every poll", () => {
  const session = createDebugSession({ map: debugMap, breakpoints: [] });
  const first = evaluateDebugPoint(session, 1, 3, 1);
  const second = evaluateDebugPoint(session, 1, 3, 1);
  assert.equal(first.pause, true);
  assert.equal(first.enteredPause, true);
  assert.equal(second.pause, true);
  assert.equal(second.enteredPause, false);
});

test("continue skips the current point and later stops on breakpoint", () => {
  const session = createDebugSession({ map: debugMap, breakpoints: ["main.cpp:5"] });
  assert.equal(evaluateDebugPoint(session, 1, 3, 1).pause, true);
  applyDebugCommand(session, "continue");
  assert.equal(evaluateDebugPoint(session, 1, 3, 1).pause, false);
  assert.equal(evaluateDebugPoint(session, 1, 4, 1).pause, false);
  assert.equal(evaluateDebugPoint(session, 1, 5, 1).pause, true);
});

test("stepInto pauses on the next distinct hook in any function", () => {
  const session = createDebugSession({ map: debugMap, breakpoints: [] });
  assert.equal(evaluateDebugPoint(session, 1, 3, 1).pause, true);
  applyDebugCommand(session, "stepInto");
  assert.equal(evaluateDebugPoint(session, 1, 4, 2).pause, true);
});

test("stepOver waits for the next hook in the same function", () => {
  const session = createDebugSession({ map: debugMap, breakpoints: [] });
  assert.equal(evaluateDebugPoint(session, 1, 3, 1).pause, true);
  applyDebugCommand(session, "stepOver");
  assert.equal(evaluateDebugPoint(session, 1, 4, 2).pause, false);
  assert.equal(evaluateDebugPoint(session, 1, 5, 1).pause, true);
});

test("stepOut pauses after returning to a different function", () => {
  const session = createDebugSession({ map: debugMap, breakpoints: [] });
  assert.equal(evaluateDebugPoint(session, 1, 4, 2).pause, true);
  applyDebugCommand(session, "stepOut");
  assert.equal(evaluateDebugPoint(session, 1, 5, 2).pause, false);
  assert.equal(evaluateDebugPoint(session, 1, 6, 1).pause, true);
});

test("decodeDebugVars returns stable name/value pairs", () => {
  assert.deepEqual(decodeDebugVars('{"a":1,"name":"Ann"}'), [
    { name: "a", value: "1" },
    { name: "name", value: "Ann" }
  ]);
  assert.deepEqual(decodeDebugVars("not-json"), []);
});

test("debug state tolerates missing sessions and unknown ids", () => {
  assert.equal(createDebugSession(null), null);
  assert.equal(applyDebugCommand(null, "continue"), null);
  assert.deepEqual(evaluateDebugPoint(null, 1, 1, 1), { pause: false, frame: null, enteredPause: false });

  const session = createDebugSession({ map: { files: [], functions: [] }, breakpoints: [] });
  const result = evaluateDebugPoint(session, 99, 7, 42, "[]");
  assert.equal(result.pause, true);
  assert.equal(result.frame.file, "<unknown>");
  assert.equal(result.frame.functionName, "<global>");
  assert.deepEqual(result.frame.variables, []);
});

test("applyDebugCommand defaults unknown commands to continue", () => {
  const session = createDebugSession({ map: debugMap, breakpoints: [] });
  evaluateDebugPoint(session, 1, 3, 1);
  assert.equal(applyDebugCommand(session, "mystery"), "continue");
  assert.equal(session.stepTargetFunctionId, null);
});
