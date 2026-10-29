const fs = require('node:fs/promises');
const native = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { setTimeout: delay } = require('node:timers/promises');
const { eligible, internal } = require('./files.cjs');
const { fault, hash } = require('./vault.cjs');
const { validator } = require('./sync-validator.cjs');
const fingerprint = stat => ({ size: stat.size, mtime: Number.isFinite(stat.mtime) ? stat.mtime : stat.mtimeMs, ctime: Number.isFinite(stat.ctime) ? stat.ctime : stat.ctimeMs });
const same = (a, b) => !!a && !!b && a.size === b.size && a.mtime === b.mtime && a.ctime === b.ctime;
async function info(vault, name) {
  if (!eligible(name)) throw fault('同步文件路径无效。');
  const file = await vault.resolve(name, true);
  let current = vault.root;
  for (const part of name.split('/')) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    if (!stat) return null;
    if (stat.isSymbolicLink()) throw fault('不操作符号链接：' + name);
  }
  const stat = await fs.lstat(file);
  if (!stat.isFile()) throw fault('同步对象不是普通文件：' + name);
  return { ...fingerprint(stat), file };
}
async function digest(file, signal) {
  const h = crypto.createHash('sha256');
  const stream = native.createReadStream(file, { signal });
  for await (const chunk of stream) h.update(chunk);
  return h.digest('hex');
}
async function localFiles(vault, excluded, limit, cache = {}, signal, paths) {
  const files = {}, skipped = [];
  const selected = paths?.size && !paths.has('*') ? [...paths] : null;
  const inside = name => !selected || selected.some(prefix => name === prefix || name.startsWith(prefix + '/'));
  const intersects = name => inside(name) || selected.some(prefix => prefix.startsWith(name + '/'));
  let count = 0;
  async function visit(dir, prefix = '', depth = 0) {
    signal?.throwIfAborted();
    if (depth > 30) throw fault('知识库目录层级超过 30 层。');
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (!eligible(name) || entry.name.startsWith('moyu-tmp-') || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!intersects(name)) continue;
        if (excluded(name)) { skipped.push({ path: name, reason: '已排除' }); continue; }
        await visit(path.join(dir, entry.name), name + '/', depth + 1);
      }
      else if (entry.isFile()) {
        if (!inside(name)) continue;
        if (++count > 10000) throw fault('单次同步最多支持 10000 个文件。');
        if (excluded(name)) { skipped.push({ path: name, reason: '已排除' }); continue; }
        const record = await info(vault, name);
        if (!record) continue;
        if (record.size > limit) { skipped.push({ path: name, reason: '超过单文件限制' }); continue; }
        record.version = same(record, cache[name]) ? cache[name].version : await digest(record.file, signal);
        cache[name] = { ...fingerprint(record), version: record.version };
        files[name] = record;
      }
    }
  }
  await visit(vault.root);
  return { files, skipped };
}
async function download(client, remote, name, target, options, limit, expectedSize) {
  const response = await client.customRequest(remote, options);
  const h = crypto.createHash('sha256');
  let size = 0;
  const meter = new Transform({ transform(chunk, _encoding, done) {
    size += chunk.length;
    if (size > limit) return done(fault('远端文件超过大小限制：' + name));
    h.update(chunk); done(null, chunk);
  } });
  await pipeline(response.body, meter, native.createWriteStream(target, { flags: 'wx', flush:true }), { signal: options.signal });
  const declared = response.headers.get('content-length');
  // Fetch exposes decoded bytes when content encoding is used, so the encoded
  // response length cannot be compared with this stream's byte count.
  if (declared !== null && !response.headers.get('content-encoding') && (!/^\d+$/.test(declared) || Number(declared) !== size)) {
    throw fault('远端文件下载不完整：' + name, 'INCOMPLETE_DOWNLOAD');
  }
  if (Number.isSafeInteger(expectedSize) && expectedSize >= 0 && expectedSize !== size) {
    throw fault('远端文件大小已改变，请重新同步：' + name, 'CONFLICT');
  }
  return { file: target, version: h.digest('hex'), size, responseTag:validator(response.headers.get('etag')) };
}
async function apply(vault, name, downloaded, expected, signal) {
  return vault.mutate(async () => {
    signal?.throwIfAborted();
    const current = await info(vault, name);
    const version = current ? await digest(current.file, signal) : null;
    if (version !== expected) throw fault('本地文件发生变化，请重新同步：' + name, 'CONFLICT');
    const target = await vault.resolve(name, true);
    if (!downloaded) { if (current) await fs.unlink(target); return null; }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await vault.resolve(name, true);
    for (let attempt = 0;; attempt++) {
      try { await fs.rename(downloaded.file, target); break; }
      catch (e) {
        if (!['EPERM','EBUSY','EACCES'].includes(e.code) || attempt >= 6) throw e;
        await delay(Math.min(500, 20 * 2 ** attempt), undefined, { signal });
      }
    }
    return { ...await info(vault, name), version: downloaded.version };
  });
}
async function conflictCopy(vault, name, record) {
  const directory = await internal(vault, vault.dataDirectory ? 'conflicts' : 'recovery');
  const extension = path.posix.extname(name), stem = Array.from(path.posix.basename(name, extension)).slice(0, 36).join('');
  const id = hash(name + '\n' + record.version).slice(0, 24), file = path.join(directory, `${stem}-远端冲突-${id}${extension.slice(0, 20)}`);
  await fs.copyFile(record.file, file, native.constants.COPYFILE_EXCL).catch(e => { if (e.code !== 'EEXIST') throw e; });
  await fs.writeFile(file + '.json', JSON.stringify({ path: name, label: 'remote', time: Date.now() }), { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e; });
}
module.exports = { fingerprint, same, info, digest, localFiles, download, apply, conflictCopy };
