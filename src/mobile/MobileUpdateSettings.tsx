import {Download,RefreshCw,X} from 'lucide-react';
import {api} from '../bridge';
import type {MobileUpdateController} from './useMobileUpdates';
export function MobileUpdateSettings({updates}:{updates:MobileUpdateController}){
  const {state,busy,error,checked}=updates;
  return <><label className='mobile-setting-row mobile-setting-toggle'><span>启动时检查更新</span><input aria-label='启动时检查更新' role='switch' type='checkbox' checked={state.automatic} onChange={event=>void updates.configure(event.target.checked)}/></label>
    <div className='mobile-update-check'><button disabled={busy} onClick={()=>void updates.check()}><RefreshCw size={16} className={busy?'mobile-sync-spinning':undefined}/>{busy?'正在检查':'检查更新'}</button><span role='status'>{state.latest?'新版本 '+state.latest.version:checked&&!error?'已是最新版本':''}</span></div>
    {state.latest?.downloadUrl&&<a className='mobile-update-download' href={state.latest.downloadUrl} onClick={event=>{event.preventDefault();void api.openExternal(state.latest!.downloadUrl!);}}><Download size={17}/>下载 APK</a>}
    {error&&<p className='mobile-inline-error' role='alert'>{error}</p>}</>;
}
export function MobileUpdateNotice({updates}:{updates:MobileUpdateController}){
  const latest=updates.state.latest;if(!updates.state.automatic||!latest?.downloadUrl||updates.dismissed===latest.version)return null;
  return <div className='mobile-update-notice' role='status'><span>新版本 {latest.version}</span><button onClick={()=>void api.openExternal(latest.downloadUrl!)}>下载 APK</button><button aria-label='关闭更新提示' onClick={updates.dismiss}><X size={18}/></button></div>;
}
