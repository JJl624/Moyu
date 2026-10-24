import initSqlJs from 'sql.js';
import { nameOf, decode, encode } from './run-files.mjs';
let SQL, settings;
const same = (a, b) => a?.length === b.length && b.every((value, index) => a[index] === value);
self.onmessage = async ({ data: input }) => {
  let db, elapsed = 0, started, artifacts = [];
  try {
    if (input.type === 'init') {
      SQL = await initSqlJs({ wasmBinary: new Uint8Array(await (await fetch('/sql/sql-wasm.wasm')).arrayBuffer()) });
      self.postMessage({ type: 'ready' }); return;
    }
    if (input.type === 'packages') { settings = input.runtimeSettings; self.postMessage({ type: 'packages' }); return; }
    if (input.type !== 'run') return;
    started = performance.now();
    const memory = input.scope === 'memory';
    const name = nameOf(settings.databaseFile), old = memory ? undefined : (input.files || []).find(file => file.name === name), bytes = old ? decode(old.data) : undefined;
    db = new SQL.Database(bytes);
    db.run('PRAGMA foreign_keys=' + (settings.foreignKeys ? 'ON' : 'OFF'));
    let index = 0, resultBytes = 0;
    for (const statement of db.iterateStatements(input.code)) {
      const sql = statement.getSQL().replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, '');
      if (/^(ATTACH|DETACH)\b/i.test(sql) || /^VACUUM\b[\s\S]*\bINTO\b/i.test(sql)) throw new Error('暂不支持 ATTACH、DETACH 或 VACUUM INTO，请使用本代码块的数据库文件。');
      const columns = statement.getColumnNames(), rows = [];let truncated=false;
      if (columns.length > 100 || columns.some(column => column.length > 1000)) throw new Error('查询结果列超过限制。');
      while (statement.step()) {if(!columns.length)continue;if(rows.length>=settings.maxRows){truncated=true;continue;}
        const row = statement.get().map(value => value instanceof Uint8Array ? '[BLOB ' + value.length + ' 字节]' : value === null ? 'NULL' : String(value));
        if (row.some(cell => cell.length > 2000)) throw new Error('结果单元格超过 2000 字符。');
        if ((resultBytes += JSON.stringify(row).length) > 20 * 1024 * 1024) throw new Error('查询结果超过 20 MB。');
        rows.push(row);
      }
      if (columns.length) {
        if (++index > 20) throw new Error('查询结果超过限制。');
        artifacts.push({ kind: 'table', name: 'query-' + index + '.csv', columns, rows,truncated });
      }
    }
    const files = memory ? [] : [...(input.files || [])];
    // SELECT-only executions need no data folder. Commit the database only
    // after the entire script succeeds, so syntax errors do not save half a run.
    // Exporting an untouched new database produces zero bytes. Comparing actual
    // bytes also catches metadata writes (PRAGMA user_version/application_id),
    // which do not change schema_version or total_changes.
    const next = memory ? new Uint8Array() : db.export();
    if ((old || next.length) && !same(bytes, next)) { const at = files.findIndex(file => file.name === name), file = { name, data: encode(next) }; if (at < 0) files.push(file); else files[at] = file; }
    elapsed = performance.now() - started;
    self.postMessage({ type: 'result', output: artifacts.length ? '' : '执行完成。', artifacts, dataFiles: files, elapsed });
  } catch (error) { self.postMessage({ type: 'result', output: '', artifacts, error: String(error.message || error), elapsed: started ? performance.now() - started : 0 }); }
  finally { db?.close(); }
};
