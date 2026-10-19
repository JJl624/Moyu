import { ArrowRight, FolderOpen, FolderPlus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from './bridge';
import type { Workspace } from './types';
export default function Navigation(
  { before, opened, current, compact = false, onResume, onDeleted }: {
    before(): Promise<void>;
    opened(w: Workspace): Promise<void>;
    current: Workspace | null;
    compact?: boolean;
    onResume?(): void;
    onDeleted?(): void;
  },
) {
  const [recent, setRecent] = useState<
      { root: string; name: string; opened: number; exists: boolean }[]
    >([]),
    [name, setName] = useState('我的知识库'),
    [example, setExample] = useState(true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (api.desktop) {
      void api.feature<{ recent: typeof recent }>('navigation.get').then(x => {
        if (!cancelled) setRecent(x.recent);
      }).catch(e => {
        if (!cancelled) setError(e.message);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [current?.root]);
  const act = async (action: () => Promise<Workspace | null>) => {
    setBusy(true);
    setError('');
    try {
      await before();
      const w = await action();
      if (w) {
        if (w.root === current?.root && onResume) onResume();
        else await opened(w);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (root: string) => {
    setBusy(true);
    setError('');
    try {
      await api.feature('navigation.remove', { root });
      setRecent(items => items.filter(item => item.root !== root));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const deleteVault = async (root: string) => {
    setBusy(true);setError('');
    try {
      await before();
      const result=await api.feature<{cancelled?:boolean;closed?:boolean}>('navigation.delete',{root});
      if(result.cancelled)return;
      setRecent((await api.feature<{recent:typeof recent}>('navigation.get')).recent);
      if(result.closed)onDeleted?.();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const items = api.desktop ? recent : current
    ? [{ root: current.root, name: current.name, opened: 0, exists: true }]
    : [];
  return (
    <section
      className={`navigation-page ${compact ? 'navigation-compact' : ''}`}
      aria-label='知识库导航'
    >
      <div className='navigation-intro'>
        <span className='navigation-brand'>墨屿 / MOYU</span>
        <h1>知识库</h1>
      </div>
      <div className='navigation-cards'>
        <div className='navigation-card'>
          <FolderPlus size={24} />
          <h2>建立知识库</h2>
          <label>
            知识库名称<input
              aria-label='知识库名称'
              value={name}
              maxLength={100}
              onChange={e => setName(e.target.value)}
            />
          </label>
          <label className='navigation-check'>
            <input
              type='checkbox'
              checked={example}
              onChange={e => setExample(e.target.checked)}
            />加入示例文档
          </label>
          <button
            className='primary-button'
            disabled={busy || !name.trim()}
            onClick={() =>
              void act(() => api.feature<Workspace | null>('navigation.create', { name, example }))}
          >
            选择位置并创建<ArrowRight size={16} />
          </button>
        </div>
        <div className='navigation-card'>
          <FolderOpen size={24} />
          <h2>打开已有文件夹</h2>
          <button
            className='secondary-button'
            disabled={busy}
            onClick={() => void act(() => api.openVault())}
          >
            打开知识库
          </button>
        </div>
      </div>
      {!!items.length && (
        <div className='recent-vaults'>
          <h2>最近的知识库</h2>
          {items.map(x => (
            <div
              key={x.root}
              className={`vault-entry ${x.root === current?.root ? 'current' : ''} ${
                x.exists ? '' : 'missing'
              }`}
            >
              <button
                className='vault-open'
                disabled={busy || !x.exists}
                onClick={() => {
                  if (x.root === current?.root && onResume) onResume();
                  else void act(() => api.feature<Workspace>('navigation.open', { root: x.root }));
                }}
              >
                <FolderOpen size={18} />
                <span>
                  <strong>{x.name}</strong>
                  <small title={x.root}>{x.root}</small>
                </span>
                {!x.exists
                  ? <em>目录不存在</em>
                  : x.root === current?.root
                  ? <em>当前</em>
                  : <ArrowRight size={16} />}
              </button>
              {api.desktop && (
                <button className='vault-remove' aria-label={`删除知识库 ${x.name}`} title='删除知识库文件' disabled={busy||!x.exists} onClick={()=>void deleteVault(x.root)}><Trash2 size={15}/></button>
              )}
              {api.desktop && (
                <button
                  className='vault-remove'
                  aria-label={`移除知识库 ${x.name}`}
                  title='从列表中移除知识库记录'
                  disabled={busy}
                  onClick={() => void remove(x.root)}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {error && <p className='error-text' role='alert'>{error}</p>}
    </section>
  );
}
