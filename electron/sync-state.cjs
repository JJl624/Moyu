const fs = require('node:fs/promises');
const { atomic, atomicIfChanged, eligible } = require('./files.cjs');
const { fault } = require('./vault.cjs');

// A durable step costs one small append rather than rewriting every baseline.
// Checkpoint revisions make a crash between replacement and journal removal safe.
class SyncState {
  constructor(file) {
    this.file = file;
    this.journal = file + '.pending.jsonl';
    this.pending = false;
    this.statusFile = file + '.status.json';
  }
  async readFile(file) {
    const stat = await fs.lstat(file).catch(e => {
      if (e.code === 'ENOENT') return null;
      throw e;
    });
    if (!stat) return null;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) {
      throw fault('同步状态文件无效。');
    }
    return fs.readFile(file, 'utf8');
  }
  async read() {
    const content = await this.readFile(this.file);
    const state = content === null ? { base: {}, lastSync: 0, revision: 0 } : JSON.parse(content);
    state.revision ??= 0;
    state.local ||= {};
    state.remote ||= {};
    for (const key of ['local', 'remote']) {
      const entries = state[key];
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)
        || Object.entries(entries).some(([name, value]) => !eligible(name) || !value || typeof value !== 'object'
          || !/^[a-f\d]{64}$/.test(value.version || '') || !Number.isFinite(value.size) || value.size < 0
          || key === 'local' && (!Number.isFinite(value.mtime) || !Number.isFinite(value.ctime)))) {
        throw fault('同步缓存格式无效。');
      }
      state[key] = Object.assign(Object.create(null), entries);
    }
    if (
      !Number.isSafeInteger(state.revision) || state.revision < 0 || !state.base
      || typeof state.base !== 'object' || Array.isArray(state.base)
    ) throw fault('同步状态格式无效。');
    if (
      Object.entries(state.base).some(([name, version]) =>
        !eligible(name) || typeof version !== 'string' || !/^[a-f\d]{64}$/.test(version)
      )
    ) throw fault('同步基线格式无效。');
    state.base = Object.assign(Object.create(null), state.base);
    const journal = await this.readFile(this.journal);
    this.pending = journal !== null;
    if (journal !== null) {
      const lines = journal.split('\n');
      // Only newline-terminated records are committed. A stopped append may
      // leave a partial final record; the next run checkpoints the valid prefix.
      lines.pop();
      for (const line of lines) {
        if (!line) continue;
        const step = JSON.parse(line);
        if (
          !Number.isSafeInteger(step.revision) || typeof step.path !== 'string'
          || !eligible(step.path) || step.version !== null && !/^[a-f\d]{64}$/.test(step.version)
        ) throw fault('同步步骤格式无效。');
        if (step.revision !== state.revision) continue;
        if (step.version) {
          Object.defineProperty(state.base, step.path, {
            value: step.version,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        } else delete state.base[step.path];
        for (const key of ['local', 'remote']) {
          if (step[key]) state[key][step.path] = step[key];
          else delete state[key][step.path];
        }
      }
    }
    const summary = await this.readFile(this.statusFile);
    if (summary) {
      const value = JSON.parse(summary);
      if (value.lastSync > (state.lastSync || 0)) { state.lastSync = value.lastSync; state.report = value.report; }
    }
    return state;
  }
  async record(state, relative, version, metadata = {}) {
    if (
      typeof relative !== 'string' || !eligible(relative)
      || version !== null && (typeof version !== 'string' || !/^[a-f\d]{64}$/.test(version))
    ) throw fault('同步步骤格式无效。');
    const stat = await fs.lstat(this.journal).catch(e => {
      if (e.code === 'ENOENT') return null;
      throw e;
    });
    if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024)) {
      throw fault('同步步骤文件无效。');
    }
    const file = await fs.open(this.journal, 'a');
    try {
      await file.writeFile(
        JSON.stringify({ revision: state.revision, path: relative, version, ...metadata }) + '\n',
      );
      await file.sync();
    } finally {
      await file.close();
    }
    this.pending = true;
    for (const key of ['local', 'remote']) {
      if (metadata[key]) state[key][relative] = metadata[key];
      else delete state[key][relative];
    }
  }
  async compact(state) {
    const next = { ...state, revision: state.revision + 1 };
    if (!Number.isSafeInteger(next.revision)) throw fault('同步状态版本无效。');
    await atomic(this.file, JSON.stringify(next), { flush: true });
    state.revision = next.revision;
    await fs.unlink(this.journal).catch(e => {
      if (e.code !== 'ENOENT') throw e;
    });
    this.pending = false;
  }
  async summary(state) {
    await atomicIfChanged(this.statusFile, JSON.stringify({ lastSync: state.lastSync, report: state.report }));
  }
}
module.exports = { SyncState };
