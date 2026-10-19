const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicIfChanged } = require('./files.cjs');
const { configLock } = require('./config-lock.cjs');

// Every owner shares the same file queue. A write changes one section against
// the latest durable document, so independent settings cannot overwrite it.
const pending = new Map();
class ApplicationConfig {
  constructor(root) { this.file = path.resolve(root, 'settings.json'); }
  async load() {
    try {
      const value = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1)
        throw Error('应用配置格式无效：' + this.file);
      return value;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { version: 1 };
    }
  }
  async get(section, fallback = {}) {
    await pending.get(this.file);
    const data = await this.load();
    return Object.hasOwn(data, section) ? data[section] : structuredClone(fallback);
  }
  update(section, change) {
    if (!/^[a-z][a-zA-Z]*$/.test(section) || section === 'version') throw Error('配置分区无效');
    const task = (pending.get(this.file) || Promise.resolve()).then(async () => {
      const apply = async data => {
        const before = JSON.stringify(data);
        const next = await change(Object.hasOwn(data, section) ? data[section] : {});
        if (next === undefined) delete data[section]; else data[section] = next;
        return { data, next, changed: before !== JSON.stringify(data) };
      };
      // An unchanged setting must not create a lock, temporary file or write.
      const preview = await apply(await this.load());
      if (!preview.changed) return preview.next;
      const release = await configLock(this.file);
      try {
        const result = await apply(await this.load());
        if (result.changed) await atomicIfChanged(this.file, JSON.stringify(result.data, null, 2) + '\n');
        return result.next;
      } finally { await release(); }
    });
    // A failed owner must receive its error without blocking later retries.
    const settled = task.catch(() => {});
    pending.set(this.file, settled);
    settled.then(() => { if (pending.get(this.file) === settled) pending.delete(this.file); });
    return task;
  }
  set(section, value) {
    const snapshot = structuredClone(value);
    return this.update(section, () => snapshot);
  }
  async flush() { await pending.get(this.file); }
}
module.exports = { ApplicationConfig };
