const fs = require("node:fs/promises"),
  path = require("node:path"),
  { Worker } = require("node:worker_threads");
const DATABASE = ".data/history.sqlite";
let worker, sequence = 0;
const pending = new Map();
function send(root, action, input, write, readOnly) {
  if (!worker) {
    const current = worker = new Worker(path.join(__dirname, "history-database-worker.cjs"));
    const fail = error => {
      if (worker !== current) return;
      worker = null;
      for (const job of pending.values()) job.reject(error);
      pending.clear();
    };
    current.on("error", fail);
    current.on("exit", code => fail(Error("历史数据库进程已退出：" + code)));
    current.on("message", message => {
      const job = pending.get(message.id);
      if (!job) return;
      pending.delete(message.id);
      if (!pending.size) current.unref();
      if (message.error) {
        job.reject(Object.assign(Error(message.error.message), { code: message.error.code }));
      } else job.resolve(message.value);
    });
    current.unref();
  }
  if (pending.size >= 512) return Promise.reject(Error("历史请求过多，请稍后重试。"));
  worker.ref();
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      worker.postMessage({ id, root, action, input, write, readOnly });
    } catch (error) {
      pending.delete(id);
      if (!pending.size) worker.unref();
      reject(error);
    }
  });
}
class HistoryDatabase {
  constructor(vault) {
    this.vault = vault;
  }
  get file() {
    return path.join(this.vault.root, DATABASE);
  }
  async request(action, input = {}, write = false) {
    if (write && this.vault.recoveryError) throw Error(this.vault.recoveryError);
    await this.vault.resolve(DATABASE, true);
    return send(this.vault.root, action, input, write, !!this.vault.recoveryError);
  }
}
module.exports = { HistoryDatabase, DATABASE };
