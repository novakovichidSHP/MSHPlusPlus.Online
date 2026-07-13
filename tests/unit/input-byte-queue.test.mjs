import test from "node:test";
import assert from "node:assert/strict";
import { InputByteQueue } from "../../assets/cpp-runtime/input-byte-queue.js";

test("InputByteQueue releases consumed chunks and appends without merging", () => {
  const first = new Uint8Array([1, 2]);
  const second = new Uint8Array([3, 4]);
  const queue = new InputByteQueue(first);
  queue.push(second);
  assert.equal(queue.chunks.length, 2);
  assert.equal(queue.readByte(), 1);
  assert.equal(queue.readByte(), 2);
  assert.ok(!queue.chunks.includes(first));
  assert.equal(queue.chunks[queue.head], second);
  assert.equal(queue.readByte(), 3);
  assert.equal(queue.readByte(), 4);
  assert.equal(queue.readByte(), -1);
  assert.equal(queue.chunks.length, 0);
  assert.equal(queue.length, 0);
});

test("InputByteQueue drains many chunks without shifting the backing array", () => {
  const queue = new InputByteQueue();
  for (let value = 0; value < 1100; value += 1) queue.push(new Uint8Array([value & 255]));
  for (let value = 0; value < 1050; value += 1) assert.equal(queue.readByte(), value & 255);
  assert.ok(queue.head < 1024);
  assert.equal(queue.length, 50);
});

test("InputByteQueue ignores empty and invalid chunks", () => {
  const queue = new InputByteQueue();
  queue.push(new Uint8Array());
  queue.push([1, 2]);
  queue.push(null);
  assert.equal(queue.length, 0);
  assert.equal(queue.readByte(), -1);
});
