const quote = name => '"' + name.replaceAll('"', '""') + '"';
const readPragmas =
  /^(?:table_list|table_xinfo|table_info|index_list|index_xinfo|index_info|foreign_key_list|database_list|compile_options|user_version|application_id|schema_version|page_count|page_size|freelist_count|encoding)$/i;
function readable(sql) {
  const cleaned = sql.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, '').replace(/;\s*$/, '');
  if (
    /^(SELECT|WITH)\b/i.test(cleaned) || /^EXPLAIN\s+(?:QUERY\s+PLAN\s+)?(?:SELECT|WITH)\b/i.test(cleaned)
  ) return true;
  const pragma = cleaned.match(/^PRAGMA\s+(?:main\.)?(\w+)(?:\s*\([^;]*\))?\s*$/i);
  return !!pragma && readPragmas.test(pragma[1]);
}
function singleStatement(sql) {
  // Ignore separators inside strings, quoted identifiers and comments. Validate
  // before prepare(): SQLite executes certain PRAGMA changes while preparing.
  const stripped = sql.replace(
    /'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g,
    ' ',
  );
  const parts = stripped.split(';');
  return parts.slice(1).every(part => !part.trim());
}
export function objectQuery(object) {
  if (['table', 'view', 'virtual', 'shadow'].includes(object.type)) {
    return 'SELECT * FROM ' + quote(object.name);
  }
  return 'SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name=' + "'"
    + object.name.replaceAll("'", "''") + "'";
}
export function sqliteBrowser(db) {
  db.run('PRAGMA query_only=ON');
  return {
    catalog() {
      const objects = [], kinds = new Map();
      for (const result of db.exec('PRAGMA table_list')) {
        for (const row of result.values) kinds.set(row[1], row[2]);
      }
      for (const result of db.exec('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name')) {
        for (const [type, name, table, sql] of result.values) {
          objects.push({
            type: String(kinds.get(name) || type),
            name: String(name),
            table: String(table),
            sql: sql || '',
            system: String(name).startsWith('sqlite_'),
          });
        }
      }
      if (!objects.some(o => o.name === 'sqlite_schema')) {
        objects.push({ type: 'table', name: 'sqlite_schema', table: 'sqlite_schema', sql: '', system: true });
      }
      const metadata = Object.fromEntries(
        [
          'user_version',
          'application_id',
          'schema_version',
          'page_count',
          'page_size',
          'freelist_count',
          'encoding',
        ].map(name => [name, db.exec('PRAGMA ' + name)[0]?.values[0]?.[0]]),
      );
      metadata.sqlite_version = db.exec('SELECT sqlite_version()')[0].values[0][0];
      return { objects, metadata };
    },
    query(sql, page = 0) {
      if (
        typeof sql !== 'string' || sql.length > 100000 || !Number.isInteger(page) || page < 0 || page > 10000
      ) throw Error('查询参数无效。');
      if (!singleStatement(sql) || !readable(sql)) throw Error('只允许单条只读查询。');
      db.run('PRAGMA query_only=ON');
      const statement = db.prepare(sql);
      try {
        const columns = statement.getColumnNames(), rows = [];
        if (columns.length > 256) throw Error('查询结果列数超过限制。');
        let skipped = 0, more = false, bytes = 0;
        while (statement.step()) {
          if (skipped++ < page * 100) continue;
          if (rows.length === 100) {
            more = true;
            break;
          }
          const row = statement.get().map(v =>
            v instanceof Uint8Array
              ? `[BLOB ${v.length} 字节]`
              : v === null
              ? 'NULL'
              : String(v).slice(0, 4096)
          );
          bytes += JSON.stringify(row).length;
          if (bytes > 1024 * 1024) throw Error('本页数据超过 1 MB，请缩小查询范围。');
          rows.push(row);
        }
        return { columns, rows, more, page };
      } finally {
        statement.free();
      }
    },
    objectQuery,
  };
}
