import {useEffect,useRef,useState} from 'react';
import {ChevronRight} from 'lucide-react';
import {MobileSheet} from './MobileSheet';
import {MobileSyncComparison} from './MobileSyncComparison';
import type {OverwriteChoice,OverwriteReview,SyncConflict} from './sync';
type Request={paths:string[];kind:'overwrite'|'scope';destination:string;serviceRoot?:boolean;review?:OverwriteReview};
export function useMobileOverwriteConfirmation(root:string){
  const [request,setRequest]=useState<Request|null>(null),pending=useRef<((approved:OverwriteChoice)=>void)|null>(null),generation=useRef(0);
  const [comparisons,setComparisons]=useState<SyncConflict[]|null>(null),[selected,setSelected]=useState<SyncConflict|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const settle=(approved:OverwriteChoice)=>{generation.current++;const resolve=pending.current;pending.current=null;setRequest(null);setComparisons(null);setSelected(null);setLoading(false);setError('');resolve?.(approved);};
  useEffect(()=>{const back=(event:Event)=>{if(pending.current){event.stopImmediatePropagation();if(selected)setSelected(null);else settle(false);}};const pause=()=>settle(false);window.addEventListener('moyu-mobile-back',back,true);window.addEventListener('moyu-mobile-pause',pause);return()=>{window.removeEventListener('moyu-mobile-back',back,true);window.removeEventListener('moyu-mobile-pause',pause);};},[selected]);
  useEffect(()=>()=>settle(false),[root]);
  const ask=(value:Request)=>new Promise<OverwriteChoice>(resolve=>{settle(false);pending.current=resolve;setRequest(value);});
  const confirm=(files:string[],destination='',review?:OverwriteReview)=>ask({paths:files,kind:'overwrite',destination,review});
  const confirmScope=async(destination:string,serviceRoot:boolean)=>(await ask({paths:[],kind:'scope',destination,serviceRoot}))===true;
  const compare=async(path:string)=>{if(!request?.review||loading)return;const ticket=generation.current;setLoading(true);setError('');try{const cached=comparisons?.find(item=>item.path===path);if(cached){setSelected(cached);return;}const values=await request.review.load(path);if(ticket!==generation.current)return;setComparisons(previous=>[...(previous||[]).filter(item=>!values.some(value=>value.path===item.path)),...values]);setSelected(values.find(item=>item.path===path)||null);}catch(error){if(ticket===generation.current)setError((error as Error).message);}finally{if(ticket===generation.current)setLoading(false);}};
  const confirmation=request?<MobileSheet title={request.kind==='scope'?'确认同步范围':'确认覆盖云端'} close={()=>settle(false)} back={selected?()=>setSelected(null):undefined}>
    {selected?<><p className='mobile-sync-path'>{selected.path}</p><MobileSyncComparison root={root} value={selected}/></>:<>
      <p className='mobile-caption'>{request.kind==='scope'?(request.serviceRoot?'当前同步目录为 /，将同步服务地址下的全部文件和子目录。':'同步目录已更改，是否同步以下目录？'):'以下 '+request.paths.length+' 个云端文件与本地内容不同。请选择保留哪一端。'}</p>
      <p className='mobile-sync-destination'>{request.destination}</p>
      {!!request.paths.length&&<ul className='mobile-overwrite-list'>{request.paths.map(path=><li key={path}>{request.review?<button disabled={loading} onClick={()=>void compare(path)} aria-label={'对比 '+path}><span>{path}</span><ChevronRight size={17}/></button>:path}</li>)}</ul>}
    </>}
    {loading&&<p role='status' className='mobile-caption'>正在读取对比内容…</p>}{error&&<p role='alert' className='mobile-inline-error'>{error}</p>}
    <div className='mobile-overwrite-actions'><button onClick={()=>settle(false)}>{request.kind==='scope'?'取消同步':'取消上传'}</button>{request.kind==='overwrite'&&request.review?.allowRemote&&<button disabled={loading||!!error} onClick={()=>settle('remote')}>使用云端覆盖本地</button>}<button className='mobile-primary' disabled={loading||!!error} onClick={()=>settle(true)}>{request.kind==='scope'?'继续同步':'覆盖云端'}</button></div>
  </MobileSheet>:null;
  return {confirm,confirmScope,confirmation};
}
