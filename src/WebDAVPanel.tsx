import { Cloud, RefreshCw, Settings2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from './bridge';
import { ConflictComparison } from './ConflictComparison';
import { Modal } from './Modal';
import { WebDAVCloud, fileSize } from './WebDAVCloud';
import { type SyncConflict, type SyncPreview, type SyncStatus, type WebDAVConnection } from './webdavTypes';
import './webdav.css';
export function WebDAVPanel({ root, beforeAction, refresh, openSettings, unsaved }: {
  root: string; beforeAction(): Promise<void>; refresh(): Promise<void>; openSettings(): void; unsaved: boolean;
}) {
  const [state, setState] = useState<SyncStatus>({ lastSync: 0, conflicts: [] });
  const [busy, setBusy] = useState<false | 'sync' | 'directory'>(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [preview, setPreview] = useState<SyncPreview | null>(null), [limit, setLimit] = useState(100);
  const [tab,setTab] = useState<'record'|'cloud'>('record'), [filter,setFilter] = useState('全部');
  const revision = useRef(0);
  const load = async () => { const ticket=++revision.current;const next=await api.feature<SyncStatus>('webdav.status');if(ticket===revision.current)setState(next); };
  useEffect(() => {
    let alive = true;
    const reload = () => { void load().catch(e => alive && setError(e.message)); };
    reload();
    const off = api.onSync?.(job => {
      if (job.root !== root || !alive) return;
      revision.current++;
      setState(s => ({ ...s, job }));
      if (['idle', 'error', 'cancelled', 'awaiting'].includes(job.phase)) reload();
    });
    window.addEventListener('moyu-webdav-settings', reload);
    return () => { alive = false; revision.current++; off?.(); window.removeEventListener('moyu-webdav-settings', reload); };
  }, [root]);
  const run = async (action: () => Promise<void>, operation: 'sync' | 'directory' = 'sync') => {
    setBusy(operation); setError(''); setMessage('');
    try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const apply = async (token?: string) => {
    const result = await api.feature<SyncStatus & SyncPreview>('webdav.sync', { token });
    if (result.needsConfirmation) { setPreview(result); setLimit(100); return; }
    setPreview(null); await load(); await refresh();
    setMessage(result.conflicts.length ? `${result.conflicts.length} 个冲突待处理` : result.changes?.length ? `已同步 ${result.changes.length} 项` : "无更改");
  };
  const scan = () => run(async () => {
    await beforeAction();
    const plan = await api.feature<SyncPreview>('webdav.preview');
    const config = await api.feature<{ webdav: WebDAVConnection }>('connections.get');
    if (plan.firstSync || plan.deletions.length && config.webdav.sync.deletion === 'confirm') { setPreview(plan); setLimit(100); }
    else await apply(plan.token);
  });
  const resolve = (conflict: SyncConflict, choice: string) => run(async () => {
    const result = await api.feature<SyncStatus & SyncPreview>('webdav.resolve', { ...conflict, choice });
    if (result.needsConfirmation) { setPreview(result); return; }
    await load(); await refresh(); setMessage('冲突已处理');
  });
  const active = ['scan', 'transfer'].includes(state.job?.phase || '') || !!busy;
  const directoryBusy = busy==='directory' || !!active && state.job?.operation==='directory' && busy!=='sync';
  const syncing = !!active && !directoryBusy;
  const changes = state.report?.changes || [], skipped = state.report?.skipped || [];
  return <section className='feature-panel dav-panel' aria-label='WebDAV 面板'>
    <div className='feature-heading'><Cloud size={17} /><strong>WebDAV</strong>
      <button className='icon-button' aria-label='WebDAV 设置' onClick={openSettings}><Settings2 size={16} /></button></div>
    {!state.enabled ? <><button className='secondary-button' onClick={openSettings}>配置 WebDAV</button></> : <>
      <div className='dav-actions'><button className='primary-button' disabled={active} onClick={() => void scan()}>
        <RefreshCw size={14} className={syncing ? 'spin' : ''} />{syncing ? '正在同步…' : '立即同步'}</button>
        {active && <button className='icon-button' aria-label={directoryBusy?'取消刷新':'取消同步'} onClick={() => void api.feature('webdav.cancel').catch(e => setError(e.message))}><X size={15} /></button>}
      </div>
      {unsaved && <p className='muted-note'>有未保存内容，仅同步已保存的文件。</p>}
      {active && <div className='dav-progress' role='status'><span>{directoryBusy ? '正在刷新云端目录…' : state.job?.phase === 'scan' ? '扫描文件' : `传输 ${state.job?.completed || 0} / ${state.job?.total || 0}`}</span>
        {state.job?.phase === 'transfer' ? <progress max={Math.max(1, state.job.total)} value={state.job.completed} />:<progress/>}
        {state.job?.current && <small title={state.job.current}>{state.job.current}</small>}</div>}
      {state.job?.phase === 'awaiting' && <button className='secondary-button' onClick={() => { setPreview(state.job!.pending || null); setLimit(100); }}>查看待确认更改</button>}
      {state.lastSync > 0 && <p className='muted-note'>上次同步：{new Date(state.lastSync).toLocaleString()}</p>}
    </>}
    {(error || state.job?.error) && <p className='feature-error' role='alert'>{error || state.job?.error}</p>}
    {message && <p className='feature-message' role='status'>{message}</p>}
    {state.conflicts.map(c => <details className='sync-conflict' key={c.path}><summary>{c.path} 冲突</summary>
      {c.truncated && <p className='muted-note'>对比显示前 8 KB，选择版本会保留完整文件。</p>}
      {c.localText !== null && c.remoteText !== null ? <ConflictComparison left={c.localText} right={c.remoteText} /> :
        <p className='muted-note'>{!c.local ? '本地已删除' : !c.remote ? '远端已删除' : '文件内容不同'}</p>}
      <div className='dav-actions'><button className='secondary-button' disabled={active} onClick={() => void resolve(c, 'local')}>保留本地</button>
        <button className='secondary-button' disabled={active} onClick={() => void resolve(c, 'remote')}>保留远端</button>
        {!!c.local && !!c.remote && <button className='secondary-button' disabled={active} onClick={() => void resolve(c, 'both')}>保留两份</button>}</div>
    </details>)}
    {state.enabled && <>
      <div className='dav-tabs' role='tablist' aria-label='同步信息'>
        <button role='tab' aria-selected={tab==='record'} onClick={()=>setTab('record')}>同步记录</button>
        <button role='tab' aria-selected={tab==='cloud'} onClick={()=>setTab('cloud')}>云端目录</button>
      </div>
      {tab==='cloud' ? <WebDAVCloud snapshot={state.cloud} busy={!!active} refresh={()=>void run(async()=>{await api.feature('webdav.refresh-tree');await load();},'directory')}/> : <>
        {state.report ? <>
          <div className='dav-summary'>
            <span>{state.report.totalChanges} 项更改</span><span>{fileSize(state.report.bytes || 0)}</span>
            <span>{((state.report.duration || 0)/1000).toFixed(1)} 秒</span>
            {!!state.report.conflicts && <span>{state.report.conflicts} 个冲突</span>}
          </div>
          <label className='dav-record-filter'><span>操作</span><select aria-label='筛选同步记录' value={filter} onChange={e=>setFilter(e.target.value)}>
            {['全部','上传','下载','删除本地','删除远端','保留两份'].map(action=><option key={action}>{action}</option>)}
          </select></label>
          <div className='dav-record-list'>
            {changes.filter(c=>filter==='全部'||c.action===filter).map((c,i)=><div className='dav-record' key={i}>
              <small className={c.action.startsWith('删除')?'dav-danger':''}>{c.action}</small>
              <div><strong title={c.path}>{c.path.slice(c.path.lastIndexOf('/')+1)}</strong>
                <span title={c.path}>{c.path.includes('/')?c.path.slice(0,c.path.lastIndexOf('/')):'根目录'}</span>
                {c.copy && <span title={c.copy}>{c.copy}</span>}</div>
              {c.size !== undefined && <small>{fileSize(c.size)}</small>}
            </div>)}
            {!changes.length && <p className='muted-note'>无更改</p>}
          </div>
          {state.report.totalChanges>changes.length && <p className='muted-note'>显示最近 {changes.length} 项，共 {state.report.totalChanges} 项。</p>}
        </> : <p className='muted-note'>暂无同步记录</p>}
        {!!skipped.length && <details className='dav-report'><summary>已跳过（{state.report?.totalSkipped}）</summary><div className='dav-file-list'>
          {skipped.map(c => <div key={c.path}><small>{c.reason}</small><span>{c.path}</span></div>)}</div>
          {(state.report?.totalSkipped || 0)>skipped.length && <p className='muted-note'>显示前 {skipped.length} 项。</p>}
        </details>}
      </>}
    </>}
    {preview && <Modal title={preview.firstSync ? '首次同步' : '确认同步删除'} onClose={() => { if (!busy) { setPreview(null); void api.feature('webdav.cancel'); } }}>
      <div className='dav-review'><p>共 {preview.changes.length} 项更改{preview.deletions.length ? `，其中删除 ${preview.deletions.length} 项` : ''}。</p>
        <div className='dav-file-list'>{preview.changes.slice(0, limit).map(c => <div key={c.path}><small className={c.action.startsWith('删除') ? 'dav-danger' : ''}>{c.action}</small><span>{c.path}</span></div>)}</div>
        {preview.changes.length > limit && <button className='text-button' onClick={() => setLimit(v => v + 100)}>显示更多</button>}
        {!!preview.skipped.length && <p className='muted-note'>已跳过 {preview.skipped.length} 个文件</p>}
      </div><div className='modal-footer'><button className='secondary-button' disabled={!!busy} onClick={() => { setPreview(null); void api.feature('webdav.cancel'); }}>取消</button>
        <button className='primary-button' disabled={!!busy} onClick={() => void run(() => apply(preview.token))}>开始同步</button></div>
    </Modal>}
  </section>;
}
