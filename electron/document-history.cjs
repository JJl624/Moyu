const path = require("node:path"),
  { randomUUID } = require("node:crypto"),
  { promisify } = require("node:util");
const gzip = promisify(require("node:zlib").gzip), gunzip = promisify(require("node:zlib").gunzip);
const { eligible } = require("./files.cjs"),
  { fileKind } = require("../shared/file-kind.mjs"),
  { isVaultData, DATA_FOLDER } = require("./vault-paths.cjs");
const { historyOptions, HISTORY_DEFAULTS } = require("../shared/history-options.mjs"),
  { HistoryDatabase } = require("./history-database.cjs");
const INTERVAL = 120000, MAX_TEXT = 2 * 1024 * 1024, MAX_STORE = 4 * 1024 * 1024, MAX_ENTRIES = 50;
const supported = document =>
  typeof document === "string" && eligible(document) && !isVaultData(document)
  && ["markdown", "html", "text"].includes(fileKind(document));
class DocumentHistory {
  constructor(vault, { interval, clock = Date.now, options = HISTORY_DEFAULTS } = {}) {
    this.options = historyOptions(options);
    Object.assign(this, { vault, clock, interval: interval ?? this.options.intervalMinutes * 60000 });
    this.database = new HistoryDatabase(vault);
    this.leases = new Map();
  }
  configure(options) {
    this.options = historyOptions(options);
    this.interval = this.options.intervalMinutes * 60000;
    this.leases.clear();
  }
  location(document) {
    if (!supported(document)) throw Error("此文件不支持文档历史。");
    return path.posix.join(DATA_FOLDER, "history", document);
  }
  query(document) {
    this.location(document);
    return {
      document,
      cutoff: this.clock() - this.options.retentionDays * 86400000,
      limit: this.options.maxEntries,
    };
  }
  async load(document) {
    return { version: 1, entries: await this.database.request("load", this.query(document)) };
  }
  async decode(entry) {
    const bytes = await gunzip(entry.data, { maxOutputLength: MAX_TEXT });
    if (bytes.length !== entry.bytes) throw Error("历史版本内容不完整。");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  }
  async entry(content, reason, time) {
    const bytes = Buffer.from(content);
    if (bytes.length > MAX_TEXT || content.includes("\0")) {
      throw Error("历史版本最多支持 2 MB 的 UTF-8 文本。");
    }
    return { id: randomUUID(), time, reason, bytes: bytes.length, data: await gzip(bytes, { level: 1 }) };
  }
  append(document, entries, interval = 0) {
    return this.database.request(
      "append",
      { ...this.query(document), entries, interval, now: this.clock() },
      true,
    );
  }
  // Called inside the vault save queue after the Markdown write succeeds.
  async capture(before, saved) {
    if (!this.options.enabled || !supported(saved.path) || Buffer.byteLength(saved.content) > MAX_TEXT) {
      return;
    }
    const now = this.clock(), leased = this.leases.get(saved.path);
    if (leased !== undefined && now - leased >= 0 && now - leased < this.interval) return;
    const last = await this.database.request("latest", this.query(saved.path));
    if (last && now - last.time >= 0 && now - last.time < this.interval) {
      this.lease(saved.path, last.time);
      return;
    }
    if (last && await this.decode(last) === saved.content) {
      this.lease(saved.path, now);
      return;
    }
    const entries = [];
    if (!last && Buffer.byteLength(before.content) <= MAX_TEXT && before.content !== saved.content) {
      entries.push(await this.entry(before.content, "before", now - 1));
    }
    entries.push(await this.entry(saved.content, "saved", now));
    await this.append(saved.path, entries, this.interval);
    this.lease(saved.path, now);
  }
  lease(document, time) {
    this.leases.delete(document);
    this.leases.set(document, time);
    while (this.leases.size > 512) this.leases.delete(this.leases.keys().next().value);
  }
  async list(document) {
    return {
      interval: this.interval,
      limit: this.options.maxEntries,
      retentionDays: this.options.retentionDays,
      enabled: this.options.enabled,
      maxText: MAX_TEXT,
      entries: await this.database.request("list", this.query(document)),
    };
  }
  async read(document, id) {
    const entry = await this.database.request("read", { ...this.query(document), id });
    if (!entry) throw Error("这个历史版本已不存在。");
    return { id: entry.id, time: entry.time, content: await this.decode(entry) };
  }
  prepareRestore(input) {
    return this.vault.mutate(async () => {
      if (
        typeof input.content !== "string" || Buffer.byteLength(input.content) > MAX_TEXT
        || input.content.includes("\0")
      ) throw Error("当前内容超过历史记录上限，不能自动保留恢复前的版本。");
      const current = await this.vault.read(input.document);
      if (current.version !== input.version) throw Error("文档已被外部修改，请先处理冲突。");
      const selected = await this.read(input.document, input.id),
        last = await this.database.request("latest", this.query(input.document));
      if (!last || await this.decode(last) !== input.content) {
        await this.append(input.document, [await this.entry(input.content, "restore", this.clock())]);
      }
      return selected;
    });
  }
  move(from, to) {
    if (!eligible(from) || !eligible(to) || isVaultData(from) || isVaultData(to)) return null;
    return this.database.request("move", { from, to });
  }
  async apply(operation) {
    this.leases.clear();
    return this.database.request("apply", operation, true);
  }
  async rollback(operation) {
    this.leases.clear();
    return this.database.request("rollback", operation, true);
  }
  async finalize(operation) {
    this.leases.clear();
    return this.database.request("finalize", operation, true);
  }
  recover() {
    return this.database.request("recover");
  }
  async clear() {
    await this.database.request("clear", {}, true);
    this.leases.clear();
  }
}
module.exports = { DocumentHistory, supported, INTERVAL, MAX_TEXT, MAX_STORE, MAX_ENTRIES };
