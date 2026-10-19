const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  zlib = require("node:zlib");
const { parentPort } = require("node:worker_threads"), { DatabaseSync } = require("node:sqlite");
const APP_ID = 0x4d485354, MAX_TEXT = 2 * 1024 * 1024, MAX_STORE = 4 * 1024 * 1024;
const inside = (name, prefix) => name === prefix || name.startsWith(prefix + "/");
function validPath(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\\") && !value.includes("\0")
    && !path.posix.isAbsolute(value) && !value.split("/").some(p => !p || p.startsWith("."));
}
function safe(root, relative) {
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    const stat = exists(current);
    if (stat?.isSymbolicLink()) throw Error("历史记录不能使用符号链接。");
  }
  return current;
}
function exists(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function validate(row) {
  if (
    !/^[a-f0-9-]{36}$/.test(row.id) || !Number.isSafeInteger(row.time) || row.time < 0
    || row.time > 8640000000000000 || !Number.isInteger(row.bytes) || row.bytes < 0 || row.bytes > MAX_TEXT
    || !["saved", "before", "restore"].includes(row.reason)
  ) throw Error("历史版本信息无效。");
  return row;
}
function schema(db) {
  db.exec(
    `CREATE TABLE history(seq INTEGER PRIMARY KEY AUTOINCREMENT,document TEXT NOT NULL,id TEXT NOT NULL,time INTEGER NOT NULL,reason TEXT NOT NULL,bytes INTEGER NOT NULL,data BLOB NOT NULL,UNIQUE(document,id));CREATE INDEX history_document ON history(document,seq DESC);CREATE TABLE operations(id TEXT PRIMARY KEY,deleted TEXT);CREATE TABLE undo(operation TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,seq INTEGER NOT NULL,document TEXT NOT NULL,PRIMARY KEY(operation,seq));CREATE TABLE legacy_imports(path TEXT PRIMARY KEY,digest TEXT NOT NULL);PRAGMA application_id=${APP_ID};PRAGMA user_version=1;`,
  );
}
function migrate(db, root) {
  const insert = db.prepare("INSERT INTO history(document,id,time,reason,bytes,data) VALUES(?,?,?,?,?,?)"),
    receipt = db.prepare("INSERT INTO legacy_imports VALUES(?,?)");
  function visit(relative, depth = 0) {
    const file = safe(root, relative), stat = exists(file);
    if (!stat) return;
    if (depth > 32) throw Error("旧历史目录层级过深。");
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file)) visit(relative + "/" + name, depth + 1);
      return;
    }
    if (!relative.endsWith("/versions.json") || !stat.isFile() || stat.size > MAX_STORE) {
      throw Error("旧历史记录文件无效：" + relative);
    }
    const document = relative.slice(".data/history/".length, -"/versions.json".length);
    if (!validPath(document)) throw Error("旧历史路径无效。");
    const bytes = fs.readFileSync(file), record = JSON.parse(bytes.toString("utf8"));
    if (record.version !== 1 || !Array.isArray(record.entries) || record.entries.length > 100) {
      throw Error("旧历史格式无效。");
    }
    for (const entry of record.entries) {
      validate(entry);
      if (typeof entry.data !== "string") throw Error("旧历史内容无效。");
      const data = Buffer.from(entry.data, "base64"),
        content = zlib.gunzipSync(data, { maxOutputLength: MAX_TEXT });
      if (content.length !== entry.bytes) throw Error("旧历史内容不完整。");
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
      insert.run(document, entry.id, entry.time, entry.reason, entry.bytes, data);
    }
    receipt.run(relative, crypto.createHash("sha256").update(bytes).digest("hex"));
  }
  visit(".data/history");
}
function backupLegacy(db, root) {
  for (const row of db.prepare("SELECT path,digest FROM legacy_imports").all()) {
    const from = safe(root, row.path);
    if (!exists(from)) continue;
    const bytes = fs.readFileSync(from);
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== row.digest) {
      throw Error("迁移后的旧历史记录已改变，请检查：" + row.path);
    }
    const relative = ".data/history-legacy/" + row.path.slice(".data/history/".length),
      to = safe(root, relative);
    if (exists(to)) throw Error("旧历史备份已存在，原文件已保留。");
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    let folder = path.dirname(from), base = path.join(root, ".data/history");
    while (folder !== base) {
      try {
        fs.rmdirSync(folder);
      } catch (error) {
        if (["ENOTEMPTY", "ENOENT"].includes(error.code)) break;
        throw error;
      }
      folder = path.dirname(folder);
    }
    try {
      fs.rmdirSync(base);
    } catch (error) {
      if (!["ENOTEMPTY", "ENOENT"].includes(error.code)) throw error;
    }
  }
}
function open(root, write, readOnly) {
  if (!path.isAbsolute(root) || fs.realpathSync(root) !== root) throw Error("历史数据库路径无效。");
  const file = safe(root, ".data/history.sqlite");
  for (const suffix of ["-journal", "-wal", "-shm"]) safe(root, ".data/history.sqlite" + suffix);
  const stat = exists(file), legacy = exists(safe(root, ".data/history"));
  if (!stat && !write && !legacy) return null;
  if (stat && !stat.isFile()) throw Error("历史数据库不是普通文件。");
  if (!stat && readOnly) throw Error("知识库为只读状态，无法迁移历史记录。");
  if (!stat) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: true, allowExtension: false, readOnly });
  try {
    db.exec(
      "PRAGMA busy_timeout=3000;PRAGMA cache_size=-2048;PRAGMA temp_store=MEMORY;PRAGMA synchronous=FULL;",
    );
    const version = db.prepare("PRAGMA user_version").get().user_version,
      application = db.prepare("PRAGMA application_id").get().application_id;
    if (version === 0 && application === 0) {
      if (readOnly) throw Error("知识库为只读状态，无法初始化历史数据库。");
      transaction(db, () => {
        const current = db.prepare("PRAGMA user_version").get().user_version;
        if (current === 1 && db.prepare("PRAGMA application_id").get().application_id === APP_ID) return;
        if (
          current !== 0
          || db.prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get()
        ) throw Error("历史数据库格式不受支持。");
        schema(db);
        migrate(db, root);
      });
    } else if (version !== 1 || application !== APP_ID) throw Error("历史数据库版本或格式不受支持。");
    if (legacy && !readOnly) backupLegacy(db, root);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
function rows(db, input, data) {
  return db.prepare(
    `SELECT ${
      data ? "*" : "id,time,reason,bytes"
    } FROM history WHERE document=? AND time>=? ORDER BY seq DESC LIMIT ?`,
  ).all(input.document, input.cutoff || 0, input.limit || 100).map(validate);
}
function finalize(db, id) {
  return transaction(db, () => {
    const op = db.prepare("SELECT deleted FROM operations WHERE id=?").get(id);
    if (!op) return;
    if (op.deleted) {
      for (const row of db.prepare("SELECT DISTINCT document FROM history").all()) {
        if (inside(row.document, op.deleted)) {
          db.prepare("DELETE FROM history WHERE document=?").run(row.document);
        }
      }
    }
    db.prepare("DELETE FROM operations WHERE id=?").run(id);
  });
}
function handle(db, action, input) {
  if (!db) {
    if (["list", "load"].includes(action)) return [];
    if (["latest", "read", "move", "bytes"].includes(action)) return null;
    return false;
  }
  switch (action) {
    case "list":
      return rows(db, input, false);
    case "load":
      return rows(db, input, true).reverse();
    case "latest":
      return rows(db, { ...input, limit: 1 }, true)[0] || null;
    case "read": {
      const row = db.prepare(
        "SELECT id,time,reason,bytes,data FROM history WHERE document=? AND id=? AND time>=?",
      ).get(input.document, input.id, input.cutoff);
      return row ? validate(row) : null;
    }
    case "append":
      return transaction(db, () => {
        const last = rows(db, { ...input, limit: 1 }, true)[0], next = input.entries.at(-1);
        for (const e of input.entries) validate(e);
        if (
          last
          && (Buffer.from(last.data).equals(Buffer.from(next.data))
            || input.interval && input.now - last.time >= 0 && input.now - last.time < input.interval)
        ) return false;
        db.prepare("DELETE FROM history WHERE document=? AND time<?").run(input.document, input.cutoff);
        const insert = db.prepare(
          "INSERT INTO history(document,id,time,reason,bytes,data) VALUES(?,?,?,?,?,?)",
        );
        for (const e of input.entries) insert.run(input.document, e.id, e.time, e.reason, e.bytes, e.data);
        const entries = db.prepare(
          "SELECT seq,length(data)+128 AS size FROM history WHERE document=? ORDER BY seq DESC",
        ).all(input.document);
        let size = 0;
        for (let i = 0; i < entries.length; i++) {
          size += entries[i].size;
          if (i >= input.limit || size > MAX_STORE) {
            db.prepare("DELETE FROM history WHERE seq=?").run(entries[i].seq);
          }
        }
        return true;
      });
    case "move": {
      if (!validPath(input.from) || !validPath(input.to)) throw Error("历史移动路径无效。");
      return db.prepare("SELECT DISTINCT document FROM history").all().some(row =>
          inside(row.document, input.from)
        )
        ? { id: crypto.randomUUID(), from: input.from, to: input.to }
        : null;
    }
    case "apply":
      return transaction(db, () => {
        if (!validPath(input.from) || !input.remove && !validPath(input.to)) {
          throw Error("历史操作路径无效。");
        }
        if (db.prepare("SELECT 1 FROM operations WHERE id=?").get(input.id)) return;
        db.prepare("INSERT INTO operations VALUES(?,?)").run(input.id, input.remove ? input.from : null);
        if (input.remove) return;
        const documents = db.prepare("SELECT DISTINCT document FROM history").all(),
          updates = documents.filter(row => inside(row.document, input.from)).map(row => ({
            ...row,
            to: input.to + row.document.slice(input.from.length),
          })),
          untouched = new Set(
            documents.filter(row => !inside(row.document, input.from)).map(row => row.document),
          );
        if (updates.some(row => untouched.has(row.to))) throw Error("目标文档已有历史记录。");
        const undo = db.prepare("INSERT INTO undo SELECT ?,seq,document FROM history WHERE document=?"),
          rename = db.prepare("UPDATE history SET document=? WHERE document=?");
        for (const [index, row] of updates.entries()) {
          undo.run(input.id, row.document);
          row.temp = "moyu-tmp-" + input.id + "/" + index;
          rename.run(row.temp, row.document);
        }
        for (const row of updates) rename.run(row.to, row.temp);
      });
    case "rollback":
      return transaction(db, () => {
        for (const row of db.prepare("SELECT seq,document FROM undo WHERE operation=?").all(input.id)) {
          db.prepare("UPDATE history SET document=? WHERE seq=?").run(row.document, row.seq);
        }
        db.prepare("DELETE FROM operations WHERE id=?").run(input.id);
      });
    case "finalize":
      return finalize(db, input.id);
    case "recover":
      for (const row of db.prepare("SELECT id FROM operations").all()) finalize(db, row.id);
      return true;
    case "clear":
      return transaction(db, () => {
        db.exec("DELETE FROM operations;DELETE FROM history;");
        return true;
      });
    case "bytes": {
      db.exec("BEGIN");
      try {
        db.prepare("SELECT name FROM sqlite_master LIMIT 1").get();
        if (db.prepare("PRAGMA journal_mode").get().journal_mode !== "delete") {
          throw Error("请先关闭数据库并完成检查点。");
        }
        const file = db.prepare("PRAGMA database_list").all().find(row => row.name === "main").file;
        if (fs.statSync(file).size > 128 * 1024 * 1024) throw Error("文件超过 128 MB。");
        return fs.readFileSync(file);
      } finally {
        db.exec("ROLLBACK");
      }
    }
    default:
      throw Error("不支持的历史操作。");
  }
}
parentPort.on("message", message => {
  let db;
  try {
    db = open(message.root, message.write, message.readOnly);
    const value = handle(db, message.action, message.input);
    parentPort.postMessage({ id: message.id, value });
  } catch (error) {
    parentPort.postMessage({ id: message.id, error: { message: error.message, code: error.code } });
  } finally {
    db?.close();
  }
});
