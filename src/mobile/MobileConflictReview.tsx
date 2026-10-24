import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ChevronRight,X} from 'lucide-react';
import {MobileSyncJob,type SyncConfig,type SyncConflict} from './sync';
import {mobileFeature,refreshAndroidWorkspace} from './native';
import {useMobileOverwriteConfirmation} from './useMobileOverwriteConfirmation';
import {MobileSyncComparison} from './MobileSyncComparison';

export function MobileConflictReview({root,items,back,changed}:{root:string;items:SyncConflict[];back():void;changed(items:SyncConflict[]):void}){
  const [selected,setSelected]=useState<SyncConflict|null>(items.length===1?items[0]:null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const job=useRef<MobileSyncJob|null>(null),live=useRef(true),overwrite=useMobileOverwriteConfirmation(root);
  const leave=()=>{if(busy)job.current?.cancel();else if(selected)setSelected(null);else back();};
  useEffect(()=>{const previous=()=>leave();window.addEventListener('moyu-mobile-back',previous);return()=>window.removeEventListener('moyu-mobile-back',previous);},[busy,selected]);
  useEffect(()=>{const pause=()=>job.current?.cancel();window.addEventListener('moyu-mobile-pause',pause);return()=>{live.current=false;pause();window.removeEventListener('moyu-mobile-pause',pause);};},[]);
  const resolve=async(choice:'local'|'remote'|'both')=>{if(!selected||busy)return;setBusy(true);setError('');try{const config=await mobileFeature<SyncConfig>('mobile.webdav-config',{root}),active=new MobileSyncJob(config,root,()=>{},overwrite.confirm);job.current=active;if(await active.resolve(selected,choice)){await refreshAndroidWorkspace();if(live.current){changed(items.filter(item=>item.path!==selected.path));setSelected(null);}}}catch(error){if(live.current)setError((error as Error).message);}finally{job.current=null;if(live.current)setBusy(false);}};
  return <div className='mobile-conflict-review'><header className='mobile-editor-header'><button aria-label={busy?'中断处理':selected?'返回冲突列表':'返回'} onClick={leave}>{busy?<X size={22}/>:<ArrowLeft size={22}/>}</button><h1 className='mobile-page-title'>同步冲突</h1></header>
    <main className='mobile-conflict-body'>{selected?<><p className='mobile-sync-path'>{selected.path}</p><MobileSyncComparison key={selected.path} root={root} value={selected}/></>:<div className='mobile-home-content'>{items.length?items.map(item=><button className='mobile-sync-conflict-row' key={item.path} onClick={()=>setSelected(item)}><span>{item.path}</span><ChevronRight size={18}/></button>):<p className='mobile-caption'>冲突已处理</p>}</div>}</main>
    {selected&&<footer className='mobile-sync-resolve'><button disabled={busy} onClick={()=>void resolve('local')}>{selected.local===null?'云端也删除':'保留本地'}</button><button disabled={busy} onClick={()=>void resolve('remote')}>{selected.remote===null?'本地也删除':'使用云端'}</button>{selected.local!==null&&selected.remote!==null&&<button disabled={busy} onClick={()=>void resolve('both')}>保留两份</button>}</footer>}
    {error&&<p role='alert' className='mobile-inline-error'>{error}</p>}{overwrite.confirmation}
  </div>;
}
