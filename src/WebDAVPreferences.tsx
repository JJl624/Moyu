import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { api } from './bridge';
import { NumberField } from './NumberField';
import { usePreferenceDraft } from './preferenceDraft';
import {DownloadProgress} from './DownloadProgress';
import { syncDefaults, type SyncPolicy, type WebDAVConnection } from './webdavTypes';
import './webdav.css';
export interface WebDAVPreferencesHandle { reset(): void }
export const WebDAVPreferences = forwardRef<WebDAVPreferencesHandle, { root: string }>(function WebDAVPreferences({ root }, ref) {
  const [ready, setReady] = useState(false), [hasPassword, setHasPassword] = useState(false);
  const [visible, setVisible] = useState(false), [savedPassword, setSavedPassword] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const draft = usePreferenceDraft<WebDAVConnection>('WebDAV', { directory: '/Moyu', sync: {...syncDefaults} }, async value => {
    if (!root || !api.desktop) return;
    const saved = await api.feature<{ webdav: WebDAVConnection }>('connections.save', { kind: 'webdav', ...value });
    setHasPassword(!!saved.webdav.hasPassword);
    if (value.clearPassword) setSavedPassword('');
    window.dispatchEvent(new CustomEvent('moyu-webdav-settings'));
  });
  const value = draft.value;
  useEffect(() => {
    let alive = true; setReady(false); setVisible(false); setSavedPassword('');
    if (api.desktop && root) void api.feature<{ webdav: WebDAVConnection }>('connections.get').then(c => {
      if (alive) {
        draft.load({ directory: '/Moyu', ...c.webdav, password: '', clearPassword: false, sync: { ...syncDefaults, ...c.webdav.sync } });
        setHasPassword(!!c.webdav.hasPassword); setReady(true);
      }
    }).catch(e => alive && setError(e.message));
    return () => { alive = false; };
  }, [root]);
  const change = (input: Partial<WebDAVConnection>, immediate = false) => {
    draft.set(v => ({...v, ...input})); setMessage(''); if (immediate) draft.apply();
  };
  const changePolicy = (input: Partial<SyncPolicy>, immediate = false) => {
    draft.set(v => ({...v, sync: {...v.sync, ...input}})); setMessage(''); if (immediate) draft.apply();
  };
  useImperativeHandle(ref, () => ({ reset: () => { if (ready) changePolicy({...syncDefaults}, true); } }));
  const reveal = async () => {
    if (visible) { setVisible(false); setSavedPassword(''); return; }
    try {
      if (!value.password && hasPassword && !value.clearPassword) {
        await draft.commit();
        const saved = await api.feature<{password:string}>('connections.password', {root}); setSavedPassword(saved.password);
      }
      setVisible(true);
    } catch (e) { setError((e as Error).message); }
  };
  const test = async () => {
    setBusy(true); setError(''); setMessage('');
    try { await draft.commit(); setMessage((await api.feature<{message:string}>('webdav.test')).message); }
    catch (e) { if((e as {code?:string}).code!=='DOWNLOAD_CANCELLED')setError((e as Error).message); } finally { setBusy(false); }
  };
  const toggle = (label: string, key: 'onOpen' | 'afterSave' | 'includeCodeData') => <div className='pref-row'>
    <span>{label}</span><button className={`toggle ${value.sync[key] ? 'on' : ''}`} role='switch' aria-label={label}
      aria-checked={value.sync[key]} onClick={() => changePolicy({[key]:!value.sync[key]}, true)}><span /></button>
  </div>;
  const number = (label: string, key: 'interval' | 'timeout' | 'retries' | 'concurrency' | 'maxFileMB', min: number, max: number, unit = '') => <label className='pref-row'>
    <span>{label}</span><div className='dav-number'><NumberField label={label} value={value.sync[key]} min={min} max={max}
      change={v => changePolicy({[key]:Math.round(v)})} />{unit && <small>{unit}</small>}</div>
  </label>;
  return <section className='dav-preferences' aria-label='WebDAV 设置' {...draft.events}>
    {!root || !api.desktop ? <p className='muted-note'>先打开本地知识库。</p> : !ready ? <p>加载中…</p> : <>
      <fieldset disabled={busy}>
        <h3 className='pref-section-heading'>连接</h3>
        {([['url','WebDAV 地址','https://…'],['directory','远端目录','/Moyu'],['username','用户名','']] as const).map(([key,label,placeholder]) =>
          <label className='pref-row dav-connection' key={key}><span>{label}</span><input aria-label={label} value={value[key] || ''}
            placeholder={placeholder} autoComplete='off' onChange={e => change({[key]:e.target.value})} /></label>)}
        <label className='pref-row dav-connection'><span>密码</span><div className='dav-password'>
          <input aria-label='密码' type={visible ? 'text' : 'password'} autoComplete='off'
            value={value.password || (visible ? savedPassword : '')} placeholder={hasPassword && !value.clearPassword ? '已保存' : ''}
            onChange={e => {setSavedPassword(''); change({password:e.target.value, clearPassword:!e.target.value});}} />
          <button className='icon-button' type='button' aria-label={visible ? '隐藏密码' : '显示密码'} onClick={() => void reveal()}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        </div></label>
        <div className='dav-actions dav-connection-actions'>
          <button className='secondary-button' disabled={!value.url} onClick={() => void test()}>测试连接</button>
          {hasPassword && <button className='text-button' onClick={() => {setSavedPassword('');change({password:'',clearPassword:true},true);}}>清除密码</button>}
        </div>
      </fieldset>
      <DownloadProgress scope='webdav-test'/>
      <fieldset disabled={busy}>
        {message && <p className='feature-message' role='status'>{message}</p>}
        <h3 className='pref-section-heading'>同步</h3>
        {toggle('打开知识库后同步','onOpen')}{toggle('保存后同步','afterSave')}
        {number('定时同步间隔','interval',0,1440,'分钟，0 关闭')}
        <p className='muted-note'>自动同步仅处理已保存的文件。</p>
        <label className='pref-row'><span>删除策略</span><select aria-label='删除策略' value={value.sync.deletion}
          onChange={e => changePolicy({deletion:e.target.value as SyncPolicy['deletion']},true)}>
          <option value='confirm'>确认后同步删除</option><option value='sync'>同步删除</option><option value='keep'>不同步删除</option>
        </select></label>
        {toggle('同步代码数据','includeCodeData')}
        <label className='dav-excludes'><span>排除规则</span><textarea aria-label='排除规则' value={value.sync.excludes} rows={3}
          placeholder={'*.tmp\n草稿/'} onChange={e => changePolicy({excludes:e.target.value})} /></label>
        <p className='muted-note'>每行一条，支持 *、** 和 ?。</p>
        <details className='dav-advanced'><summary>高级</summary>
          {number('请求超时','timeout',5,600,'秒')}{number('失败重试次数','retries',0,5)}
          {number('下载并发数','concurrency',1,4)}{number('单文件大小上限','maxFileMB',1,1024,'MB')}
        </details>
      </fieldset>
      {(error || draft.error) && <p className='feature-error' role='alert'>{error || draft.error}</p>}
    </>}
  </section>;
});
