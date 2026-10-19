import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type DatabaseObject, objectQuery, type QueryPage } from '../shared/sqlite-browser.mjs';
import { api } from './bridge';
const labels: Record<string, string> = {
  table: '表',
  view: '视图',
  index: '索引',
  trigger: '触发器',
  virtual: '虚拟表',
  shadow: '影子表',
  system: '系统对象',
};
export default function SqliteViewer({ path, onClose }: { path: string; onClose?: () => void }) {
  const worker = useRef<Worker | null>(null),
    request = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [objects, setObjects] = useState<DatabaseObject[]>([]),
    [metadata, setMetadata] = useState<Record<string, unknown>>({}),
    [selected, setSelected] = useState<DatabaseObject | null>(null),
    [sql, setSql] = useState('SELECT * FROM sqlite_schema'),
    [query, setQuery] = useState(''),
    [result, setResult] = useState<QueryPage | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(true),
    [filter, setFilter] = useState(''),
    [restart, setRestart] = useState(0);
  useEffect(() => {
    let alive = true;
    let w:Worker|undefined,url='';
    const id = ++request.current;
    const onmessage = ({ data }:MessageEvent) => {
      if (!alive || data.id !== request.current) return;
      clearTimeout(timer.current);
      setBusy(false);
      if (data.error) {
        setResult(null);
        setError(data.error);
        return;
      }
      if (data.result.objects) {
        setObjects(data.result.objects);
        setMetadata(data.result.metadata);
      } else setResult(data.result);
    };
    const onerror = (e:ErrorEvent) => {
      if (alive) {
        clearTimeout(timer.current);
        setBusy(false);
        setError(e.message || '数据库无法打开。');
      }
    };
    setBusy(true);
    setError('');
    setResult(null);
    setObjects([]);
    setMetadata({});
    setSelected(null);
    timer.current = setTimeout(() => {
      w?.terminate();
      if (alive) {
        setBusy(false);
        setError('数据库打开超时，请重新打开。');
      }
    }, 30000);
    void Promise.all([api.feature<Uint8Array>('file.sqlite-bytes', { path }),api.feature<{code:string;wasm:Uint8Array}>('runtime.sql-viewer')]).then(([bytes,runtime]) => {
      if (alive) {
        const buffer = new Uint8Array(bytes);
        url=URL.createObjectURL(new Blob([runtime.code],{type:'text/javascript'}));w=new Worker(url,{type:'module'});worker.current=w;w.onmessage=onmessage;w.onerror=onerror;
        const wasm=new Uint8Array(runtime.wasm);w.postMessage({ id, action: 'open', bytes: buffer,wasm }, [buffer.buffer,wasm.buffer]);
      }
    })
      .catch(e => {
        if (alive) {
          clearTimeout(timer.current);
          setBusy(false);
          setError(e.message);
        }
      });
    return () => {
      alive = false;
      clearTimeout(timer.current);
      w?.terminate();
      if(url)URL.revokeObjectURL(url);
      worker.current = null;
    };
  }, [path, restart]);
  const run = (text = sql, page = 0) => {
    if (busy || !worker.current) return;
    setBusy(true);
    setError('');
    setQuery(text);
    const id = ++request.current;
    timer.current = setTimeout(() => {
      worker.current?.terminate();
      worker.current = null;
      setBusy(false);
      setError('查询超时，请重新打开数据库。');
    }, 10000);
    worker.current.postMessage({ id, action: 'query', sql: text, page });
  };
  const cancel = () => {
    clearTimeout(timer.current);
    worker.current?.terminate();
    worker.current = null;
    request.current++;
    setBusy(false);
    setError('已取消查询，请重新打开数据库。');
  };
  return (
    <section className='sqlite-viewer file-viewer' aria-label='SQLite 查看器'>
      <header className='file-viewer-toolbar'>
        <button className='icon-button' title='关闭当前文档' aria-label='关闭当前文档' onClick={onClose}><X size={16}/></button>
        <strong>{path}</strong>
        <span>只读</span>
        <span className='drawing-toolbar-spacer' />
        <button onClick={() => setRestart(n => n + 1)}>重新打开</button>
      </header>
      <div className='sqlite-layout'>
        <aside className='sqlite-objects'>
          <input
            aria-label='筛选数据库对象'
            placeholder='筛选对象'
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          {['table', 'view', 'index', 'trigger', 'virtual', 'shadow', 'system'].map(type => {
            const items = objects.filter(o =>
              (type === 'system' ? o.system : !o.system && o.type === type)
              && o.name.toLowerCase().includes(filter.toLowerCase())
            );
            return items.length > 0 && (
              <div key={type}>
                <h4>
                  {labels[type]} <small>{items.length}</small>
                </h4>
                {items.map(o => (
                  <button
                    key={o.type + o.name}
                    disabled={busy}
                    className={selected?.name === o.name ? 'selected' : ''}
                    title={o.name}
                    onClick={() => {
                      setSelected(o);
                      const q = objectQuery(o);
                      setSql(q);
                      run(q);
                    }}
                  >
                    {o.name}
                  </button>
                ))}
              </div>
            );
          })}
          <details>
            <summary>系统元数据</summary>
            {Object.entries(metadata).map(([key, value]) => (
              <div className='sqlite-metadata' key={key}>
                <span>{key}</span>
                <code>{String(value)}</code>
              </div>
            ))}
          </details>
        </aside>
        <div className='sqlite-content'>
          {selected?.sql && (
            <details className='sqlite-definition'>
              <summary>定义</summary>
              <pre>{selected.sql}</pre>
            </details>
          )}
          <textarea
            aria-label='只读 SQL 查询'
            spellCheck={false}
            value={sql}
            onChange={e => setSql(e.target.value)}
          />
          <div className='sqlite-query-actions'>
            <button disabled={busy || !worker.current} onClick={() => run()}>查询</button>
            {busy && <button onClick={cancel}>取消</button>}
            <span className='drawing-toolbar-spacer' />
            {result && (
              <>
                <button
                  aria-label='查询上一页'
                  disabled={busy || result.page === 0}
                  onClick={() => run(query, result.page - 1)}
                >
                  ‹
                </button>
                <span>第 {result.page + 1} 页</span>
                <button
                  aria-label='查询下一页'
                  disabled={busy || !result.more}
                  onClick={() => run(query, result.page + 1)}
                >
                  ›
                </button>
              </>
            )}
          </div>
          {error && <p role='alert'>{error}</p>}
          <div className='sqlite-results' aria-busy={busy}>
            {result && (
              <table>
                <thead>
                  <tr>{result.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            )}
            {result && !result.rows.length && <p>没有结果</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
