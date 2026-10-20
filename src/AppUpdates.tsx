import { useEffect, useState } from 'react';
import { version } from '../package.json';
import { api } from './bridge';
import { Modal } from './Modal';
import './appUpdates.css';
export interface UpdateState {
  current: string; automatic: boolean; canAutoCheck: boolean; checkedAt: number;
  latest: { version: string; url: string } | null;
}
export function AppUpdates({ ready }: { ready: boolean }) {
  const [state,setState] = useState<UpdateState | null>(null), [open,setOpen] = useState(false);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [dismissed,setDismissed] = useState('');
  const [checked,setChecked] = useState(false);
  const [saving,setSaving] = useState(false);
  const check = async () => {
    setBusy(true); setError(''); setChecked(false);
    try { setState(await api.checkUpdate(true)); setChecked(true); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!ready || !api.desktop) return;
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined;
    void api.updateState().then(saved => {
      if (!alive) return;
      setState(saved);
      if (saved.automatic && saved.canAutoCheck) timer = setTimeout(() => {
        void api.checkUpdate(false).then(next => { if (alive) setState(next); }).catch(() => {});
      },5000);
    }).catch(() => {});
    return () => { alive = false; clearTimeout(timer); };
  },[ready]);
  useEffect(() => {
    const show = () => { setOpen(true); void check(); };
    window.addEventListener('moyu-check-update',show);
    return () => window.removeEventListener('moyu-check-update',show);
  },[]);
  const download = () => {
    void api.openExternal(state?.latest?.url || 'https://github.com/JJl624/Moyu/releases/latest').catch(e => {
      setError(e.message); setOpen(true);
    });
  };
  if (!api.desktop) return null;
  return <>
    {!open && state?.latest && dismissed !== state.latest.version && <div className='app-update-notice' role='status'>
      <span>Moyu {state.latest.version} 可用</span>
      <button className='text-button' onClick={() => setOpen(true)}>查看更新</button>
      <button className='text-button' aria-label='关闭更新提示' onClick={() => setDismissed(state.latest!.version)}>关闭</button>
    </div>}
    {open && <Modal title='软件更新' onClose={() => setOpen(false)}>
      <div className='app-update-content'>
        <p>当前版本 {state?.current || version}</p>
        {busy ? <p role='status'>正在检查更新…</p> : state?.latest ? <p role='status'>新版本 {state.latest.version}</p>
          : checked && !error ? <p role='status'>当前已是最新版本。</p> : null}
        {error && <p role='alert' className='feature-error'>{error}</p>}
        {state?.latest && <p className='muted-note'>{api.platform==='win32'?'从 GitHub Release 下载便携版。退出程序后替换原来的 EXE 文件，再打开新版；文档和应用数据保留。':api.platform==='linux'?'从 GitHub Release 下载 AppImage 或 DEB。退出程序后替换 AppImage 或安装 DEB，再打开新版；文档和应用数据保留。':'从 GitHub Release 下载新版，退出程序后替换应用；文档和应用数据保留。'}</p>}
        <label className='app-update-option'><input type='checkbox' checked={state?.automatic ?? true} disabled={!state || saving}
          onChange={event => {
            const automatic = event.target.checked;
            setSaving(true); setState(current => current && {...current,automatic});
            void api.configureUpdate(automatic).then(setState).catch(e => {
              setState(current => current && {...current,automatic:!automatic}); setError(e.message);
            }).finally(() => setSaving(false));
          }} />启动时检查更新</label>
        {state?.checkedAt ? <small>上次检查：{new Date(state.checkedAt).toLocaleString()}</small> : null}
        <div className='app-update-actions'>
          <button className='secondary-button' disabled={busy} onClick={() => void check()}>重新检查</button>
          {(state?.latest || error) && <button className='primary-button' onClick={download}>前往下载</button>}
        </div>
      </div>
    </Modal>}
  </>;
}
