import { ChevronRight, File, Folder, FolderOpen, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from './bridge';
interface Item {
  id: string;
  name: string;
  path: string;
  exists: boolean;
  restart?: boolean;
  managed?: string;
  readonly?: boolean;clear?:boolean;
  group: string;
  kind: 'directory' | 'file' | 'link';
}
type OldItem = { id: string; name: string; path: string; blocked: boolean };
const groups = [
  ['application', '应用配置'],
  ['runtimes', '运行环境'],
  ['cache', '缓存与日志'],
  ['workspace', '知识库文件'],

] as const;
type Child = { name: string; relative: string; kind: Item['kind'] };
function DataDirectory(
  { id, relative = '', report }: { id: string; relative?: string; report: (message: string) => void },
) {
  const [items, setItems] = useState<Child[]>([]),
    [next, setNext] = useState<number | null>(null),
    [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]), request = useRef(0);
  const load = async (offset = 0) => {
    const ticket = ++request.current;
    setBusy(true);
    try {
      const result = await api.feature<{ items: Child[]; next: number | null }>('data.children', {
        id,
        relative,
        offset,
      });
      if (ticket !== request.current) return;
      setItems(previous => offset ? [...previous, ...result.items] : result.items);
      setNext(result.next);
    } catch (e) {
      if (ticket === request.current) report((e as Error).message);
    } finally {
      if (ticket === request.current) setBusy(false);
    }
  };
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [id, relative]);
  return (
    <div className='data-file-tree' role='group' aria-label='目录内容'>
      {!busy && !items.length && <small>空目录</small>}
      {items.map(item => (
        <div key={item.relative}>
          <div className='data-file-row'>
            <button
              className='data-file-name'
              aria-expanded={item.kind === 'directory' ? expanded.includes(item.relative) : undefined}
              onClick={() =>
                item.kind === 'directory'
                  ? setExpanded(previous =>
                    previous.includes(item.relative)
                      ? previous.filter(x => x !== item.relative)
                      : [...previous, item.relative]
                  )
                  : void api.feature('data.reveal', { id, relative: item.relative }).catch(e => report(e.message))}
            >
              {item.kind === 'directory'
                ? (
                  <>
                    <ChevronRight size={12} className={expanded.includes(item.relative) ? 'expanded' : ''} />
                    <Folder size={14} />
                  </>
                )
                : <File size={14} />}
              <span>{item.name}</span>
            </button>
            <button
              className='icon-button'
              title='打开位置'
              aria-label={'打开位置 ' + item.name}
              onClick={() =>
                void api.feature('data.reveal', { id, relative: item.relative }).catch(e => report(e.message))}
            >
              <FolderOpen size={14} />
            </button>
          </div>
          {expanded.includes(item.relative) && <DataDirectory id={id} relative={item.relative} report={report} />}
        </div>
      ))}
      {busy && <small role='status'>加载中…</small>}
      {next !== null && (
        <button className='text-button' disabled={busy} onClick={() => void load(next)}>显示更多</button>
      )}
    </div>
  );
}
function DataLocation({ item, expanded, busy, removable, toggle, reveal, remove, report, children }: {
  item: Item;
  expanded: boolean;
  busy: boolean;
  removable: boolean;
  toggle(): void;
  reveal(): void;
  remove(): void;
  report(message: string): void;
  children?: React.ReactNode;
}) {
  const browsable = item.exists && item.kind === 'directory';
  return (
    <div className={'data-location' + (!item.exists ? ' missing' : '')}>
      <div className='data-location-main'>
        <div className='data-location-title'>
          {browsable
            ? (
              <button
                className='data-location-toggle'
                aria-label={'展开 ' + item.name}
                aria-expanded={expanded}
                onClick={toggle}
              >
                <ChevronRight size={13} className={expanded ? 'expanded' : ''} />
                <strong>{item.name}</strong>
              </button>
            )
            : <strong>{item.name}</strong>}
          {!item.exists && <small>未创建</small>}
        </div>
        <div className='data-location-path' title={item.path}>{item.path}</div>
      </div>
      <div className='data-location-actions'>
        <button className='icon-button' title='打开位置' aria-label={'打开位置 ' + item.name} onClick={reveal}>
          <FolderOpen size={15} />
        </button>
        {removable && (
          <button
            className='icon-button'
            title={item.clear?'清空文档历史':'移至回收站'}
            aria-label={'删除数据 ' + item.name}
            disabled={busy}
            onClick={remove}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
      {expanded && browsable && <DataDirectory key={item.path} id={item.id} report={report} />}
      {children}
    </div>
  );
}
export function DataPreferences() {
  const [old, setOld] = useState<OldItem[]>([]), [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Item[]>([]),
    [message, setMessage] = useState(''),
    [confirmation, setConfirmation] = useState<{ id: string; legacy: boolean } | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const refresh = () =>
    Promise.all([
      api.feature<Item[]>('data.list').then(setItems),
      api.feature<OldItem[]>('data.cleanup-list').then(setOld),
    ]).catch(e => setMessage(e.message));
  useEffect(() => {
    void refresh();
  }, []);
  const toggle = (id: string) =>
    setExpanded(previous => previous.includes(id) ? previous.filter(x => x !== id) : [...previous, id]);
  const confirm = (id: string, legacy: boolean, clear = false) =>
    confirmation?.id === id && (
      <div className='data-confirm'>
        <span>{clear?'清空文档历史？':'移至回收站？'}</span>
        <button
          className='secondary-button'
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setMessage('');
            void api.feature<{ message: string }>(legacy ? 'data.cleanup' : 'data.delete', { id }).then(
              async result => {
                setMessage(result.message);
                setConfirmation(null);
                await refresh();
              },
            ).catch(e => setMessage(e.message)).finally(() => setBusy(false));
          }}
        >
          确认{clear?'清空':legacy ? '清理' : '删除'}
        </button>
        <button className='text-button' disabled={busy} onClick={() => setConfirmation(null)}>取消</button>
      </div>
    );
  const row = (item: Item, legacy = false, blocked = false) => (
    <DataLocation
      key={item.id}
      item={item}
      expanded={expanded.includes(item.id)}
      busy={busy}
      removable={!blocked && item.exists && (legacy || !item.managed && !item.readonly && !item.restart)}
      report={setMessage}
      toggle={() => toggle(item.id)}
      reveal={() => void api.feature('data.reveal', { id: item.id }).catch(e => setMessage(e.message))}
      remove={() => setConfirmation({ id: item.id, legacy })}
    >
      {blocked && <small className='data-location-note'>正在使用</small>}
      {confirm(item.id, legacy, item.clear)}
    </DataLocation>
  );
  return (
    <div className='data-preferences'>
      {items.filter(item => item.id === 'directory').map(item => row(item))}
      {groups.map(([group, name]) => (
        <details className='data-group' key={group} aria-label={name}>
          <summary>
            <ChevronRight size={14} />
            <h3>{name}</h3>
            <small>{items.filter(item => item.group === group).length}</small>
          </summary>
          {items.filter(item => item.group === group).map(item => row(item))}
          {!items.some(item => item.group === group) && <small className='data-group-empty'>暂无文件</small>}
        </details>
      ))}
      {!!old.length && (
        <details className='data-group old-environments' aria-label='旧环境'>
          <summary>
            <ChevronRight size={14} />
            <h3>旧环境</h3>
            <small>{old.length}</small>
          </summary>
          {old.map(item => row({ ...item, exists: true, kind: 'directory', group: 'old' }, true, item.blocked))}
        </details>
      )}
      {message && <p role='status' className='data-message'>{message}</p>}
    </div>
  );
}
