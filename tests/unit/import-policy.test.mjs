import test from "node:test";
import assert from "node:assert/strict";
import {
  ImportPolicyError,
  assertInputSize,
  createArchiveBudget,
  parseProjectExport,
  parseShareSnapshot,
  validatePortableFiles
} from "../../assets/utils/import-policy.js";
import { gunzipWithLimit } from "../../assets/utils/bounded-gzip.js";

const limits = { maxInputBytes: 20, maxFiles: 2, maxSingleFileBytes: 8, maxTotalFileBytes: 12, maxSnapshotJsonBytes: 500 };

test("accepts C++ sources and non-C++ text data", () => {
  assert.deepEqual(validatePortableFiles([
    { name: "main.cpp", content: "int x;" },
    { name: "data.csv", content: "a,b" }
  ], limits), [
    { name: "main.cpp", content: "int x;" },
    { name: "data.csv", content: "a,b" }
  ]);
});

test("rejects oversized input and expanded archive entries", () => {
  assert.throws(() => assertInputSize(21, limits), (error) => error instanceof ImportPolicyError && error.code === "input-too-large");
  const consume = createArchiveBudget(limits).beginFile("bomb.txt");
  consume(6);
  assert.throws(() => consume(3), /too large/);
});

test("rejects too many files and excessive aggregate bytes", () => {
  assert.throws(() => validatePortableFiles([
    { name: "a.txt", content: "1234567" },
    { name: "b.txt", content: "123456" }
  ], limits), (error) => error.code === "project-too-large");
  assert.throws(() => validatePortableFiles([
    { name: "a", content: "" }, { name: "b", content: "" }, { name: "c", content: "" }
  ], limits), (error) => error.code === "file-count");
});

test("rejects malformed schemas and unsafe or duplicate names", () => {
  assert.throws(() => parseProjectExport("not json", limits), (error) => error.code === "invalid-json");
  assert.throws(() => parseProjectExport(JSON.stringify({ version: 1, project: { files: [{ name: "../x.cpp", content: "" }] } }), limits), (error) => error.code === "invalid-file-name");
  assert.throws(() => validatePortableFiles([{ name: "a.cpp", content: "" }, { name: "a.cpp", content: "" }], limits), (error) => error.code === "invalid-file-name");
});

test("project export and share snapshot preserve a normal round trip", () => {
  const files = [{ name: "main.cpp", content: "return 0" }, { name: "in.txt", content: "42" }];
  const exported = parseProjectExport(JSON.stringify({ version: 1, project: { files } }), limits);
  assert.deepEqual(exported.files, files);
  assert.deepEqual(parseShareSnapshot(JSON.stringify({ title: "Demo", files, lastActiveFile: "in.txt" }), limits), {
    title: "Demo", files, lastActiveFile: "in.txt"
  });
});

test("snapshot requires its active file to exist", () => {
  assert.throws(() => parseShareSnapshot(JSON.stringify({ files: [{ name: "main.cpp", content: "" }], lastActiveFile: "missing.cpp" }), limits), (error) => error.code === "invalid-active-file");
});

test("policy rejects invalid scalar inputs and every unsafe name form", () => {
  for (const size of [-1, 1.5, Number.NaN]) assert.throws(() => assertInputSize(size, limits), /too large/);
  for (const name of [null, "", "a".repeat(256), "dir/x", "dir\\x", "..x", "bad name"]) {
    assert.throws(() => validatePortableFiles([{ name, content: "" }], limits), (error) => error.code === "invalid-file-name");
  }
  for (const files of [null, []]) assert.throws(() => validatePortableFiles(files, limits), (error) => error.code === "file-count");
  assert.throws(() => validatePortableFiles([null], limits), (error) => error.code === "invalid-file-name");
  assert.throws(() => validatePortableFiles([{ name: "a", content: 3 }], limits), (error) => error.code === "invalid-file-content");
  assert.throws(() => validatePortableFiles([{ name: "a", content: "123456789" }], limits), (error) => error.code === "file-too-large");
});

test("project and snapshot parsers reject size and schema variants", () => {
  const tiny = { ...limits, maxSnapshotJsonBytes: 2 };
  assert.throws(() => parseProjectExport(3, limits), (error) => error.code === "json-too-large");
  assert.throws(() => parseProjectExport("{}", tiny), (error) => error.code === "invalid-schema");
  for (const value of [{}, { version: 2 }, { version: 1 }, { version: 1, project: {} }]) {
    assert.throws(() => parseProjectExport(JSON.stringify(value), limits), (error) => error.code === "invalid-schema");
  }
  assert.throws(() => parseShareSnapshot(3, limits), (error) => error.code === "snapshot-too-large");
  assert.throws(() => parseShareSnapshot("not json", limits), (error) => error.code === "invalid-json");
  for (const value of [null, [], { title: 3, files: [] }, { lastActiveFile: 3, files: [] }]) {
    assert.throws(() => parseShareSnapshot(JSON.stringify(value), limits), ImportPolicyError);
  }
  const withAssets = parseProjectExport(JSON.stringify({ version: 1, project: { files: [{ name: "a", content: "" }], assets: [{}] } }), limits);
  assert.equal(withAssets.hasAssets, true);
  assert.deepEqual(parseShareSnapshot(JSON.stringify({ files: [{ name: "a", content: "" }] }), limits), {
    title: "", files: [{ name: "a", content: "" }], lastActiveFile: "a"
  });
});

test("archive budget rejects names, declarations, count and aggregate expansion", () => {
  assert.throws(() => createArchiveBudget(limits).beginFile("../x"), (error) => error.code === "invalid-file-name");
  assert.throws(() => createArchiveBudget(limits).beginFile("x", 9), (error) => error.code === "file-too-large");
  const countBudget = createArchiveBudget(limits);
  countBudget.beginFile("a"); countBudget.beginFile("b");
  assert.throws(() => countBudget.beginFile("c"), (error) => error.code === "file-count");
  const totalBudget = createArchiveBudget(limits);
  totalBudget.beginFile("a")(7);
  assert.throws(() => totalBudget.beginFile("b")(6), (error) => error.code === "project-too-large");
});

test("bounded streaming gunzip round-trips and stops gzip bombs", () => {
  class FakeGunzip {
    constructor(callback) { this.callback = callback; }
    push(bytes) { this.callback(bytes.subarray(0, 3), false); this.callback(bytes.subarray(3), true); }
  }
  const source = new TextEncoder().encode("hello gzip");
  assert.deepEqual(gunzipWithLimit(source, 20, FakeGunzip), source);
  assert.throws(() => gunzipWithLimit(source, 5, FakeGunzip), (error) => error.code === "snapshot-too-large");
});
