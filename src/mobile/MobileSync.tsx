import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, Eye, EyeOff, RefreshCw, UploadCloud, X } from 'lucide-react';
import { mobileFeature } from './native';
import {notifySync,syncURL} from './syncState';
import {policy} from '../../shared/sync-policy.mjs';
import {MobileSyncOptions} from './MobileSyncOptions';
import {MobileCloudTree} from './MobileCloudTree';
import { MobileSyncJob, syncResultMessage, type Remote, type SyncConfig, type SyncConflict, type SyncProgress } from './sync';
import {useMobileOverwriteConfirmation} from './useMobileOverwriteConfirmation';

export default function MobileSync({root,back,flush,refreshed,review}:{root:string;back():void;flush():Promise<boolean>;refreshed():Promise<void>;review(items:SyncConflict[]):void}) {
  const overwrite=useMobileOverwriteConfirmation(root);
  const [config,setConfig]=useState<SyncConfig>({url:'',directory:'/Moyu',username:'',password:''}),[loaded,setLoaded]=useState(false),[visible,setVisible]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[progress,setProgress]=useState<SyncProgress|null>(null);
  const [operationKind,setOperationKind]=useState<'test'|'sync'|'list'>('sync');
  const [waiting,setWaiting]=useState(false);
  const [conflicts,setConflicts]=useState<SyncConflict[]>([]),[remote,setRemote]=useState<Remote[]>([]),[viewCloud,setViewCloud]=useState(false);
  const job=useRef<MobileSyncJob|null>(null),live=useRef(true),current=useRef(config);current.current=config;
  const savedConfig=useRef('');
  useEffect(()=>{const pause=()=>job.current?.cancel();window.addEventListener('moyu-mobile-pause',pause);return()=>window.removeEventListener('moyu-mobile-pause',pause);},[]);
  useEffect(()=>{void mobileFeature<SyncConfig>('mobile.webdav-config',{root}).then(value=>{if(live.current){const initial={url:value.url||'',directory:value.directory??(value.url?'/':'/Moyu'),username:value.username||'',password:value.password||'',sync:policy(value.sync)};savedConfig.current=JSON.stringify(initial);setConfig(initial);setLoaded(true);}}).catch(error=>setError(error.message));return()=>{live.current=false;job.current?.cancel();};},[]);
  useEffect(()=>{const backEvent=()=>{void leave();};window.addEventListener('moyu-mobile-back',backEvent);return()=>window.removeEventListener('moyu-mobile-back',backEvent);},[viewCloud,busy,config,loaded]);
  const persist=async()=>{if(loaded){const value={...current.current,sync:policy(current.current.sync)},serialized=JSON.stringify(value);if(serialized===savedConfig.current)return;await mobileFeature('mobile.webdav-config',{root,config:value});savedConfig.current=serialized;notifySync();window.dispatchEvent(new Event('moyu-mobile-sync-config'));}};
  const execute=async(action:'test'|'sync'|'list')=>{
    if(busy)return;setOperationKind(action);setBusy(true);setError('');setStatus('');setWaiting(false);
    try{
      await persist();if(action==='sync'&&!await flush())return;
      const active=new MobileSyncJob(current.current,root,value=>{if(live.current)setProgress(value);},overwrite.confirm,overwrite.confirmScope);job.current=active;
      if(action==='test'){setProgress({stage:'测试连接',completed:0,total:0,path:''});const result=await active.test();setStatus(result.exists?'连接成功':'连接成功，同步时将创建云端目录');}
      else if(action==='list'){setRemote(await active.refreshTree());setViewCloud(true);}
      else{const result=await active.run();setConflicts(result.conflicts);setRemote(result.remote);setStatus(syncResultMessage(result));setWaiting(!!result.needsDirectoryConfirmation||!!result.pendingUploads.length);await refreshed();}
    }catch(error){if(live.current)setError((error as Error).message);}finally{if(live.current){setBusy(false);setProgress(null);}job.current=null;}
  };
  const leave=async()=>{if(busy){job.current?.cancel();return;}if(viewCloud){setViewCloud(false);return;}try{await persist();back();}catch(error){setError((error as Error).message);}};
  let destination='';try{if(config.url)destination=decodeURI(syncURL(config).href);}catch{/* The connection action reports invalid input; partial typing remains editable. */}
  return <>
    <header className='mobile-editor-header'><button aria-label={busy?operationKind==='list'?'取消读取目录':operationKind==='test'?'取消测试连接':'取消同步':viewCloud?'返回同步设置':'返回设置'} onClick={()=>void leave()}>{busy?<X size={22}/>:<ArrowLeft size={22}/>}</button><h1 className='mobile-page-title'>{viewCloud?'云端目录':'WebDAV 同步'}</h1></header>
    {viewCloud?<main className='mobile-home-content'><button className='mobile-back-link' onClick={()=>setViewCloud(false)}><ArrowLeft size={17}/>同步设置</button>{remote.length?<MobileCloudTree entries={remote}/>:<div className='mobile-empty'><UploadCloud size={35}/><p>云端目录为空</p></div>}</main>
    :<main className='mobile-home-content mobile-sync-content'>
      <section className='mobile-sync-card'>
        <label>服务地址<div className='mobile-url-field'><input aria-label='WebDAV 地址' inputMode='url' autoCapitalize='none' autoCorrect='off' placeholder='https://dav.jianguoyun.com/dav/' value={config.url} disabled={busy||!loaded} onChange={event=>{setConfig({...config,url:event.target.value});setStatus('');}} onBlur={()=>void persist().catch(error=>setError(error.message))}/><button aria-label='测试连接' disabled={busy||!loaded||!config.url} onClick={()=>void execute('test')}>测试</button></div></label>
        <label>同步目录<input aria-label='同步目录' autoCapitalize='none' autoCorrect='off' placeholder='/Moyu' value={config.directory||''} disabled={busy||!loaded} onChange={event=>{setConfig({...config,directory:event.target.value});setStatus('');}} onBlur={()=>void persist().catch(error=>setError(error.message))}/></label>
        <p className='mobile-caption mobile-directory-help'>相对于服务地址；填 / 表示该地址下的全部文件。</p>
        {destination&&<div className='mobile-sync-destination'><span>同步到</span><output aria-label='最终同步地址'>{destination}</output></div>}
        <label>用户名<input aria-label='WebDAV 用户名' autoCapitalize='none' autoCorrect='off' value={config.username} disabled={busy||!loaded} onChange={event=>setConfig({...config,username:event.target.value})} onBlur={()=>void persist().catch(error=>setError(error.message))}/></label>
        <label>密码<div className='mobile-url-field'><input aria-label='WebDAV 密码' type={visible?'text':'password'} value={config.password} disabled={busy||!loaded} onChange={event=>setConfig({...config,password:event.target.value})} onBlur={()=>void persist().catch(error=>setError(error.message))}/><button aria-label={visible?'隐藏密码':'显示密码'} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={19}/>:<Eye size={19}/>}</button></div></label>
      </section>
      <div className='mobile-sync-buttons'><button className='mobile-primary' disabled={busy||!config.url} onClick={()=>void execute('sync')}><RefreshCw size={18}/>立即同步</button><button disabled={busy||!config.url} onClick={()=>void execute('list')}>查看云端目录<ChevronRight size={17}/></button></div>
      {status&&<p className={'mobile-sync-status'+(waiting?' pending':'')} role='status'>{!waiting&&<Check size={17}/>}<span>{status}</span></p>}
      {conflicts.length>0&&<button className='mobile-setting-link' onClick={()=>review(conflicts)}>处理 {conflicts.length} 项冲突<ChevronRight size={18}/></button>}
      <MobileSyncOptions value={config.sync} busy={busy} change={sync=>setConfig({...config,sync})} persist={()=>void persist().catch(error=>setError(error.message))}/>
      <p className='mobile-caption'>同步已保存的文件。覆盖云端已有文件前需确认；自动同步会暂缓这些上传。</p>
    </main>}
    {progress&&<div className='mobile-sync-progress' role='status'><div><span>{progress.stage}</span><button aria-label={operationKind==='list'?'中断读取目录':operationKind==='test'?'中断测试连接':'中断同步'} onClick={()=>job.current?.cancel()}><X size={18}/></button></div><progress max={progress.total||1} {...(progress.total?{value:progress.completed}:{})}/><small>{progress.path||' '}</small></div>}
    {error&&<div className='mobile-error' role='alert'><span>{error}</span><button aria-label='关闭同步错误' onClick={()=>setError('')}><X size={18}/></button></div>}
    {overwrite.confirmation}
  </>;
}
