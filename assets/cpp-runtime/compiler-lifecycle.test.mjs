import test from "node:test";
import assert from "node:assert/strict";
import { discardCompilerWorker } from "./compiler-lifecycle.js";

test("discardCompilerWorker hard-terminates and clears reusable compiler state", () => {
  let terminated = 0;
  const runtime = {
    _worker: { terminate() { terminated++; } },
    _emception: { stale: true },
    _initPromise: Promise.resolve(),
    _collecting: true,
    _diagBuffer: "old diagnostics",
    _fmtWritten: true,
    _rangesWritten: true,
    _viewsWritten: true
  };
  discardCompilerWorker(runtime);
  assert.equal(terminated, 1);
  assert.equal(runtime._worker, null);
  assert.equal(runtime._emception, null);
  assert.equal(runtime._initPromise, null);
  assert.equal(runtime._collecting, false);
  assert.equal(runtime._diagBuffer, "");
  assert.equal(runtime._fmtWritten, false);
  assert.equal(runtime._rangesWritten, false);
  assert.equal(runtime._viewsWritten, false);
});

test("discardCompilerWorker tolerates missing or already-dead workers", () => {
  assert.doesNotThrow(() => discardCompilerWorker({ _worker: null }));
  assert.doesNotThrow(() => discardCompilerWorker({
    _worker: { terminate() { throw new Error("dead"); } }
  }));
});
