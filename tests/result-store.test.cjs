const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { ResultStore } = require("../electron/result-store.cjs");

test('An invalid result batch neither leaks partial files nor evicts existing results', () => {
  const store = new ResultStore(16, 3), file = n => ({ kind: 'file', name: n + '.txt', data: Buffer.alloc(n).toString('base64') });
  const original = store.retain([file(10)])[0], released = [];
  store.onRelease = token => released.push(token);
  for (const batch of [[file(8), file(20)], [file(9), file(9)], [file(0), file(0), file(0), file(0)]]) {
    assert.throws(() => store.retain(batch), /超过/);
    assert.equal(store.size, 10); assert.equal(store.values.size, 1);
    assert.equal(store.bytes(original.token).length, 10); assert.deepEqual(released, []);
  }
  const valid = store.retain([file(8), file(8)]);
  assert.equal(store.size, 16); assert.equal(valid.length, 2);
  assert.deepEqual(released, [original.token]);
  for (const result of valid) assert.equal(store.bytes(result.token).length, 8);
});
test("Results stay in bounded memory, table pages retain export data, and released tokens cannot read anything", () => {
  const store = new ResultStore(100000);
  const table = store.retain([{
    kind: "table",
    name: "a.csv",
    columns: ["v"],
    rows: Array.from({ length: 120 }, (_, i) => [String(i)]),
    truncated: true,
  }])[0];
  assert.equal(table.rows, undefined);
  assert.equal(table.rowCount, 120);
  assert.equal(store.page(table.token, 0).rows.length, 50);
  assert.equal(store.page(table.token, 2).rows.length, 20);
  assert(store.bytes(table.token).toString().includes("\"119\""));
  assert.equal(store.page(table.token, 0).truncated, true);
  store.release([table.token]);
  assert.equal(store.size, 0);
  assert.throws(() => store.bytes(table.token), /释放/);
});
test("Binary files decode once; eviction bounds memory and preview checks enormous raster dimensions", () => {
  const store = new ResultStore(10),
    a = store.retain([{
      kind: "file",
      name: "a",
      data: Buffer.from("123456").toString("base64"),
    }])[0],
    b = store.retain([{
      kind: "file",
      name: "b",
      data: Buffer.from("123456").toString("base64"),
    }])[0];
  assert.equal(store.size, 6);
  assert.throws(() => store.bytes(a.token), /释放/);
  assert.equal(store.bytes(b.token).toString(), "123456");
  assert.equal(b.data, undefined);
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(10000, 16);
  bytes.writeUInt32BE(10000, 20);
  const imageStore = new ResultStore(1000),
    image = imageStore.retain([{
      kind: "image",
      mime: "image/png",
      name: "huge.png",
      data: bytes.toString("base64"),
    }])[0];
  assert.throws(() => imageStore.preview(image.token), /图片过大/);
  store.clear();
  assert.equal(store.size, 0);
});

test("Text file previews are bounded, preserve full exports and ignore binary data", () => {
  const store = new ResultStore();
  const text = "中文🙂\n".repeat(20000), bytes = Buffer.from(text);
  const file =
    store.retain([{ kind: "file", name: "data.bin", data: bytes.toString("base64") }])[0];
  assert.equal(file.textPreview, true);
  const preview = store.text(file.token);
  assert.equal(preview.limit, 32768);
  assert(preview.bytesRead <= 32768);
  assert.equal(preview.truncated, true);
  assert.equal(preview.totalSize, bytes.length);
  assert(text.startsWith(preview.text));
  assert(!preview.text.includes("\ufffd"));
  assert.deepEqual(store.bytes(file.token), bytes);
  const binary = store.retain([{
    kind: "file",
    name: "data.txt",
    data: Buffer.from([1, 2, 3, 0, 255]).toString("base64"),
  }])[0];
  assert.equal(binary.textPreview, false);
  assert.equal(store.text(binary.token), null);
  const utf16 = store.retain([{
    kind: "file",
    name: "unicode.txt",
    data: Buffer.concat([Buffer.from([255, 254]), Buffer.from("中文文本", "utf16le")]).toString(
      "base64",
    ),
  }])[0];
  assert.equal(store.text(utf16.token).text, "中文文本");
  const empty = store.retain([{ kind: "file", name: "empty.txt", data: "" }])[0];
  assert.equal(empty.size, 0);
  assert.equal(store.text(empty.token).text, "");
  store.release([file.token]);
  assert.throws(() => store.text(file.token), /释放/);
});
