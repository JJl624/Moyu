const LIMIT = 64 * 1024 * 1024;
const tag = (v, offset) => String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset + offset, 4));
const align = length => Math.ceil(length / 4) * 4;
const invalid = () => new Error("字体文件格式无效。");
async function read(blob, offset, length) {
  if (!Number.isSafeInteger(offset) || offset < 0 || length < 0 || offset + length > blob.size) throw invalid();
  return new DataView(await blob.slice(offset, offset + length).arrayBuffer());
}
function postscriptNames(v) {
  if (v.byteLength < 6) throw invalid();
  const count = v.getUint16(2), start = v.getUint16(4), names = [];
  if (count > 4096 || 6 + count * 12 > v.byteLength) throw invalid();
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    if (v.getUint16(at + 6) !== 6) continue;
    const platform = v.getUint16(at), length = v.getUint16(at + 8), offset = start + v.getUint16(at + 10);
    if (offset + length > v.byteLength) throw invalid();
    let name = "";
    if (platform === 0 || platform === 3) {
      if (length % 2) throw invalid();
      for (let j = 0; j < length; j += 2) name += String.fromCharCode(v.getUint16(offset + j));
    } else if (platform === 1) {
      for (let j = 0; j < length; j++) name += String.fromCharCode(v.getUint8(offset + j));
    }
    if (name) names.push(name);
  }
  return names;
}
function checksum(v) {
  let sum = 0;
  for (let i = 0; i < v.byteLength; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
  return sum;
}
// A FontData blob can contain a whole TTC. Read only the selected face's tables;
// retain its glyphs and rebuild standalone sfnt offsets and checksums.
export async function fontFaceBytes(blob, postscriptName) {
  const header = await read(blob, 0, 12);
  if (tag(header, 0) !== "ttcf") {
    if (blob.size > LIMIT) throw new Error("所选字体超过 64 MB。");
    return blob.arrayBuffer();
  }
  const count = header.getUint32(8);
  if (!count || count > 256) throw invalid();
  const offsets = await read(blob, 12, count * 4);
  for (let face = 0; face < count; face++) {
    const offset = offsets.getUint32(face * 4), head = await read(blob, offset, 12), n = head.getUint16(4);
    if (!n || n > 256 || ![0x00010000, 0x4f54544f].includes(head.getUint32(0))) throw invalid();
    const directory = await read(blob, offset + 12, n * 16), tables = [], seen = new Set();
    for (let i = 0; i < n; i++) {
      const at = i * 16, name = tag(directory, at), start = directory.getUint32(at + 8), length = directory.getUint32(at + 12);
      if (seen.has(name) || start + length > blob.size) throw invalid();
      seen.add(name);
      tables.push({ name, start, length });
    }
    const names = tables.find(t => t.name === "name");
    if (!names || names.length > 1024 * 1024) throw invalid();
    if (!postscriptNames(await read(blob, names.start, names.length)).includes(postscriptName)) continue;
    // Collection signatures cannot describe the rebuilt individual font.
    const selected = tables.filter(t => t.name !== "DSIG").sort((a, b) => a.name < b.name ? -1 : 1);
    const size = 12 + selected.length * 16 + selected.reduce((sum, t) => sum + align(t.length), 0);
    if (size > LIMIT) throw new Error("所选字体超过 64 MB。");
    const bytes = new ArrayBuffer(size), out = new DataView(bytes), data = new Uint8Array(bytes);
    out.setUint32(0, head.getUint32(0));
    out.setUint16(4, selected.length);
    const power = Math.floor(Math.log2(selected.length)), search = 2 ** power * 16;
    out.setUint16(6, search); out.setUint16(8, power); out.setUint16(10, selected.length * 16 - search);
    let position = 12 + selected.length * 16, headAt;
    for (const [i, table] of selected.entries()) {
      data.set(new Uint8Array((await read(blob, table.start, table.length)).buffer), position);
      if (table.name === "head") {
        if (table.length < 12) throw invalid();
        out.setUint32(position + 8, 0);
        headAt = position;
      }
      const at = 12 + i * 16;
      for (let j = 0; j < 4; j++) out.setUint8(at + j, table.name.charCodeAt(j));
      out.setUint32(at + 4, checksum(new DataView(bytes, position, align(table.length))));
      out.setUint32(at + 8, position); out.setUint32(at + 12, table.length);
      position += align(table.length);
    }
    if (headAt === undefined) throw invalid();
    out.setUint32(headAt + 8, (0xb1b0afba - checksum(out)) >>> 0);
    return bytes;
  }
  throw new Error("字体集中找不到所选字体。");
}
