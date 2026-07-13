export class InputByteQueue {
  constructor(initial = new Uint8Array(0)) {
    this.chunks = [];
    this.head = 0;
    this.offset = 0;
    this.length = 0;
    this.push(initial);
  }

  push(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) return;
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  readByte() {
    if (this.length === 0) return -1;
    const chunk = this.chunks[this.head];
    const value = chunk[this.offset++];
    this.length -= 1;
    if (this.offset >= chunk.length) {
      // Drop the reference immediately, but avoid Array#shift: shifting for
      // every small stdin chunk makes draining many chunks O(n²).
      this.chunks[this.head++] = null;
      this.offset = 0;
      if (this.head === this.chunks.length) {
        this.chunks = [];
        this.head = 0;
      } else if (this.head >= 1024 && this.head * 2 >= this.chunks.length) {
        this.chunks = this.chunks.slice(this.head);
        this.head = 0;
      }
    }
    return value;
  }
}
