import test from "node:test";
import assert from "node:assert/strict";
import { collectLimitedOutputFiles } from "./output-files-policy.js";

function makeFs(files) {
  const reads = [];
  return {
    reads,
    readdir: () => [".", "..", ...Object.keys(files)],
    stat: (path) => ({ mode: 0, size: files[path.split("/").pop()].length }),
    isDir: () => false,
    readFile: (path) => {
      const name = path.split("/").pop();
      reads.push(name);
      return files[name];
    }
  };
}

test("oversized output is rejected from stat without read/decode", () => {
  const fs = makeFs({ "huge.txt": new Uint8Array(100), "ok.txt": new TextEncoder().encode("ok") });
  const result = collectLimitedOutputFiles({
    runtimeFS: fs, workdir: "/work", maxFiles: 10,
    maxSingleFileBytes: 20, maxTotalTextBytes: 50
  });
  assert.deepEqual(fs.reads, ["ok.txt"]);
  assert.equal(result.limited, true);
  assert.deepEqual(result.omitted, [{ name: "huge.txt", reason: "maxSingleFileBytes", size: 100 }]);
  assert.deepEqual(result.files, [{ name: "ok.txt", content: "ok" }]);
});

test("file count and total byte limits are applied before read", () => {
  const fs = makeFs({
    "a.txt": new Uint8Array(6),
    "b.txt": new Uint8Array(6),
    "c.txt": new Uint8Array(1)
  });
  const result = collectLimitedOutputFiles({
    runtimeFS: fs, workdir: "/work", maxFiles: 2,
    maxSingleFileBytes: 10, maxTotalTextBytes: 8
  });
  assert.deepEqual(fs.reads, ["a.txt"]);
  assert.deepEqual(result.omitted.map((x) => x.reason), ["maxTotalTextBytes", "maxFiles"]);
});

test("unchanged input files are not returned", () => {
  const bytes = new TextEncoder().encode("same");
  const fs = makeFs({ "input.txt": bytes });
  const result = collectLimitedOutputFiles({
    runtimeFS: fs, workdir: "/work", inputSnapshot: new Map([["input.txt", bytes]]),
    maxFiles: 2, maxSingleFileBytes: 10, maxTotalTextBytes: 10
  });
  assert.deepEqual(result.files, []);
  assert.equal(result.limited, false);
});

test("collector tolerates unavailable entries and filesystem errors", () => {
  assert.deepEqual(collectLimitedOutputFiles({
    runtimeFS: { readdir() { throw new Error("no fs"); } }, workdir: "/work"
  }), { files: [], limited: false, omitted: [] });

  const reads = [];
  const fs = {
    readdir: () => [".", "..", "dir", "gone", "broken", "changed"],
    stat: (path) => {
      if (path.endsWith("gone")) throw new Error("gone");
      return { mode: path.endsWith("dir") ? 1 : 0, size: 1 };
    },
    isDir: (mode) => mode === 1,
    readFile: (path) => {
      const name = path.split("/").pop();
      reads.push(name);
      if (name === "broken") throw new Error("broken");
      return new Uint8Array([2]);
    }
  };
  const result = collectLimitedOutputFiles({
    runtimeFS: fs, workdir: "/work",
    inputSnapshot: new Map([["changed", new Uint8Array([1])]])
  });
  assert.deepEqual(reads, ["broken", "changed"]);
  assert.deepEqual(result.files, [{ name: "changed", content: "\u0002" }]);
});
