const { test } = require('node:test'), assert = require('node:assert/strict');
function collection() {
  const bytes = new ArrayBuffer(512), v = new DataView(bytes), data = new Uint8Array(bytes);
  const tag = (at, name) => [...name].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  tag(0, 'ttcf'); v.setUint32(4, 0x10000); v.setUint32(8, 2); v.setUint32(12, 20); v.setUint32(16, 80);
  for (let i = 0; i < 2; i++) {
    const at = 20 + i * 60, head = 140 + i * 56, name = 252 + i * 48;
    v.setUint32(at, 0x10000); v.setUint16(at + 4, 3);
    for (const [index, [kind, start, length]] of [['glyf', 348, 5], ['head', head, 54], ['name', name, 36]].entries()) {
      const record = at + 12 + index * 16; tag(record, kind); v.setUint32(record + 8, start); v.setUint32(record + 12, length);
    }
    v.setUint32(head + 8, 1234); v.setUint16(name + 2, 1); v.setUint16(name + 4, 18);
    v.setUint16(name + 6, 3); v.setUint16(name + 8, 1); v.setUint16(name + 12, 6); v.setUint16(name + 14, 18);
    [...(i ? 'Face-Bold' : 'Face-Norm')].forEach((c, j) => v.setUint16(name + 18 + j * 2, c.charCodeAt(0)));
  }
  data.set([1, 2, 3, 4, 5], 348);
  return new Blob([bytes]);
}
test('A collection extracts the exact face, shared glyphs, aligned tables and standalone checksum', async () => {
  const { fontFaceBytes } = await import('../shared/font-face.mjs');
  for (const face of ['Face-Norm', 'Face-Bold']) {
    const result = await fontFaceBytes(collection(), face), v = new DataView(result);
    assert.equal(v.getUint32(0), 0x10000); assert.equal(v.getUint16(4), 3);
    assert.equal(v.getUint16(6), 32); assert.equal(v.getUint16(8), 1); assert.equal(v.getUint16(10), 16);
    let sum = 0;
    for (let i = 0; i < result.byteLength; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
    assert.equal(sum, 0xb1b0afba);
    const tags = [];
    for (let i = 0; i < 3; i++) {
      const at = 12 + i * 16, offset = v.getUint32(at + 8);
      assert.equal(offset % 4, 0);
      tags.push(String.fromCharCode(...new Uint8Array(result, at, 4)));
      if (tags[i] === 'glyf') assert.deepEqual([...new Uint8Array(result, offset, 5)], [1, 2, 3, 4, 5]);
      if (tags[i] === 'name') assert(Buffer.from(result, offset, 36).includes(Buffer.from([...face].flatMap(c => [0, c.charCodeAt(0)]))));
    }
    assert.deepEqual(tags, ['glyf', 'head', 'name']);
    assert(result.byteLength < collection().size);
  }
});
test('Collections reject a missing face or out-of-bounds table instead of selecting another font', async () => {
  const { fontFaceBytes } = await import('../shared/font-face.mjs');
  await assert.rejects(fontFaceBytes(collection(), 'Missing'), /找不到/);
  const buffer = await collection().arrayBuffer(); new DataView(buffer).setUint32(40, 10000);
  await assert.rejects(fontFaceBytes(new Blob([buffer]), 'Face-Norm'), /格式无效/);
});
test('An individual font is retained without an extra collection or character subsetting', async () => {
  const { fontFaceBytes } = await import('../shared/font-face.mjs');
  const bytes = await fontFaceBytes(collection(), 'Face-Bold');
  assert.deepEqual(await fontFaceBytes(new Blob([bytes]), 'Face-Bold'), bytes);
});
