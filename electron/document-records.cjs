const fs = require('node:fs/promises');
const { fault } = require('./vault.cjs');
const caches = new WeakMap();

// Instances share a vault-scoped cache. Atomic replacements, external edits and
// downloads invalidate it through file identity and nanosecond timestamps.
async function readRecord(vault, file) {
  const stat = await fs.lstat(file, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) throw fault('管理记录必须是普通文件。');
  let cache = caches.get(vault);
  if (!cache) caches.set(vault, cache = new Map());
  const stamp = [stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
  const cached = cache.get(file);
  if (cached?.stamp === stamp) return structuredClone(cached.value);
  const value = JSON.parse(await fs.readFile(file, 'utf8'));
  cache.set(file, { stamp, value });
  while (cache.size > 512) cache.delete(cache.keys().next().value);
  return structuredClone(value);
}
module.exports = { readRecord };
