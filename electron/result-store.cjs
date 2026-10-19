const crypto = require("node:crypto");
const { fault } = require("./vault.cjs");
const TEXT_PREVIEW_LIMIT = 32 * 1024;
function textSample(bytes) {
  let encoding = "utf-8", length = Math.min(bytes.length, TEXT_PREVIEW_LIMIT);
  if (bytes[0] === 255 && bytes[1] === 254) encoding = "utf-16le";
  else if (bytes[0] === 254 && bytes[1] === 255) encoding = "utf-16be";
  if (encoding !== "utf-8") length -= length % 2;
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(0, length), {
      stream: length < bytes.length,
    });
    if (/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text)) return null;
    return {
      text,
      bytesRead: length,
      totalSize: bytes.length,
      limit: TEXT_PREVIEW_LIMIT,
      truncated: length < bytes.length,
    };
  } catch {
    return null;
  }
}
class ResultStore {
  constructor(limit = 96 * 1024 * 1024, entries = 1024) {
    this.limit = limit;
    this.size = 0;
    this.values = new Map();
    this.entries = entries;
  }
  reserveEntry(){while(this.values.size>=this.entries)this.release([this.values.keys().next().value]);}
  release(tokens) {
    for (const token of tokens || []) {
      const item = this.values.get(token);
      if (item) {
        this.size -= item.size;
        this.values.delete(token);
        this.onRelease?.(token);
      }
    }
  }
  clear() {
    for(const token of this.values.keys())this.onRelease?.(token);
    this.values.clear();
    this.size = 0;
  }
  retain(artifacts) {
    // Validate the whole batch before evicting old results or issuing tokens.
    // Otherwise an invalid later file leaves earlier files retained invisibly.
    let total = 0;
    const prepared = (artifacts || []).map(artifact => {
      const { data, rows, ...metadata } = artifact,
        size = artifact.kind === 'table' ? Buffer.byteLength(JSON.stringify(rows || [])) : Buffer.byteLength(data || '', 'base64');
      if (size > Math.min(this.limit, 40 * 1024 * 1024)) throw fault("运行结果超过 40 MB。");
      total += size;
      if (total > this.limit) throw fault('运行结果超过缓存上限。');
      return { metadata, data, rows, size };
    });
    if (prepared.length > this.entries) throw fault('运行结果数量超过缓存上限。');
    while (this.values.size + prepared.length > this.entries) this.release([this.values.keys().next().value]);
    return prepared.map(({ metadata, data, rows, size }) => {
      const bytes = metadata.kind === 'table' ? null : Buffer.from(data || '', 'base64');
      while (this.size + size > this.limit && this.values.size) {
        const oldest=[...this.values].find(([,item])=>item.size>0)?.[0];if(!oldest)break;
        this.release([oldest]);
      }
      const token = crypto.randomUUID();
      this.reserveEntry();
      this.values.set(token, { ...metadata, bytes, rows, size });
      this.size += size;
      return {
        ...metadata,
        token,
        size,
        rowCount: rows?.length || 0,
        ...(metadata.kind === "file" ? { textPreview: textSample(bytes) !== null } : {}),
      };
    });
  }
  get(token) {
    const value = this.values.get(token);
    if (!value) throw fault("结果已释放，请重新运行。", "RESULT_EXPIRED");
    this.values.delete(token);this.values.set(token,value);
    return value;
  }
  retainDeferred(metadata, read) {
    const token=crypto.randomUUID();
    this.reserveEntry();
    this.values.set(token,{...metadata,size:0,read});
    return {...metadata,token,rowCount:0};
  }
  async read(token) {
    const item=this.get(token);
    if(!item.read)return this.bytes(token);
    const bytes=await item.read();
    this.get(token);
    if(bytes.length>20*1024*1024)throw fault('HTML 结果超过 20 MB。');
    return bytes;
  }
  replaceBytes(token,bytes){
    const item=this.get(token);if(bytes.length>40*1024*1024)throw fault('运行结果超过 40 MB。');
    while(this.size-item.size+bytes.length>this.limit){const oldest=[...this.values].find(([key,item])=>key!==token&&item.size>0)?.[0];if(!oldest)throw fault('运行结果超过缓存上限。');this.release([oldest]);}
    this.size+=bytes.length-item.size;item.bytes=bytes;item.size=bytes.length;
  }
  async materialize(token){const bytes=await this.read(token);this.replaceBytes(token,bytes);delete this.get(token).read;return bytes;}
  page(token, page = 0) {
    const item = this.get(token);
    if (item.kind !== "table" || !Number.isInteger(page) || page < 0) throw fault("结果页无效。");
    return {
      rows: item.rows.slice(page * 50, page * 50 + 50),
      columns: item.columns,
      rowCount: item.rows.length,
      truncated: !!item.truncated,
    };
  }
  text(token) {
    const item = this.get(token);
    if (item.kind !== "file") throw fault("请选择文件结果。");
    return textSample(item.bytes);
  }
  preview(token) {
    const item = this.get(token), bytes = this.bytes(token);
    let width = 0, height = 0;
    if (item.mime === "image/png" && bytes.length >= 24) {
      width = bytes.readUInt32BE(16);
      height = bytes.readUInt32BE(20);
    } else if (item.mime === "image/jpeg") {
      for (let i = 2; i + 9 < bytes.length;) {
        if (bytes[i] !== 255) break;
        const marker = bytes[i + 1], length = bytes.readUInt16BE(i + 2);
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
          height = bytes.readUInt16BE(i + 5);
          width = bytes.readUInt16BE(i + 7);
          break;
        }
        if (length < 2) break;
        i += length + 2;
      }
    }
    if (width * height > 16000000) throw fault("图片过大，请保存为文件后查看。");
    return bytes;
  }
  bytes(token) {
    const item = this.get(token);
    if (item.bytes) return item.bytes;
    const cell = value => "\"" + String(value).replaceAll("\"", "\"\"") + "\"",
      bytes = Buffer.from(
        [item.columns, ...item.rows].map(row => row.map(cell).join(",")).join("\r\n"),
      );
    if (bytes.length > 20 * 1024 * 1024) throw fault("导出文件超过 20 MB。");
    return bytes;
  }
}
module.exports = { ResultStore };
