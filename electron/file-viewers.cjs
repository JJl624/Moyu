const fs = require('node:fs/promises');
const { fileKind } = require('../shared/file-kind.mjs');
const LIMIT = 128 * 1024 * 1024;
async function binaryRead(vault, relative, bytes = false) {
  const kind = fileKind(relative);
  if (!['image', 'pdf', 'score', 'sqlite'].includes(kind)) throw Error('文件格式无效。');
  const target = await vault.resolve(relative), stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > LIMIT) throw Error('文件超过 128 MB 或不是普通文件。');
  if (bytes && kind !== 'sqlite') throw Error('此文件不支持数据库查询。');
  if(bytes&&relative===require('./history-database.cjs').DATABASE)return new (require('./history-database.cjs').HistoryDatabase)(vault).request('bytes');
  if (bytes) {
    const wal = await fs.stat(target + '-wal').catch(e => {
      if (e.code !== 'ENOENT') throw e;
      return null;
    });
    if (wal?.size > 32) throw Error('数据库含有尚未合并的 WAL 数据，请先在原程序中关闭数据库并完成检查点。');
    const data = await fs.readFile(target);
    if(data.length>LIMIT)throw Error('文件超过 128 MB。');
    if (data.subarray(0, 16).toString() !== 'SQLite format 3\0') throw Error('不是有效的 SQLite 数据库。');
    return data;
  }
  return { path: relative, content: '', version: stat.mtimeMs + ':' + stat.size, updated: stat.mtimeMs };
}
module.exports = { binaryRead };
