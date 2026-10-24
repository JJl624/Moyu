import {useEffect,useRef,useState} from 'react';
import {MobileSheet} from './MobileSheet';

type Choice='save'|'discard'|'cancel';
type Request={paths:string[];reason?:'sync';resolve(choice:Choice):void};
export function confirmMobileClose(paths:string[],reason?:'sync'):Promise<Choice>{
  return new Promise(resolve=>window.dispatchEvent(new CustomEvent<Request>('moyu-mobile-confirm-close',{detail:{paths,reason,resolve}})));
}
export function MobileSaveConfirmation(){
  const [request,setRequest]=useState<Request|null>(null),pending=useRef<Request|null>(null);
  useEffect(()=>{
    const receive=(event:Event)=>{pending.current?.resolve('cancel');pending.current=(event as CustomEvent<Request>).detail;setRequest(pending.current);};
    window.addEventListener('moyu-mobile-confirm-close',receive);
    return()=>{window.removeEventListener('moyu-mobile-confirm-close',receive);pending.current?.resolve('cancel');};
  },[]);
  const choose=(choice:Choice)=>{pending.current?.resolve(choice);pending.current=null;setRequest(null);};
  useEffect(()=>{if(!request)return;const cancel=(event:Event)=>{event.stopImmediatePropagation();choose('cancel');};window.addEventListener('moyu-mobile-back',cancel,true);return()=>window.removeEventListener('moyu-mobile-back',cancel,true);},[request]);
  if(!request)return null;
  return <MobileSheet title={request.reason==='sync'?'同步前处理修改':'未保存的修改'} close={()=>choose('cancel')}>
    <p className='mobile-caption'>{request.paths.length===1?'“'+request.paths[0].split('/').pop()+'”尚未保存。':request.paths.length+' 篇文档尚未保存。'}</p>
    {request.reason==='sync'&&<ul className='mobile-overwrite-list'>{request.paths.map(path=><li key={path}>{path}</li>)}</ul>}
    <div className='mobile-actions'><button className='mobile-primary' onClick={()=>choose('save')}>保存并继续</button><button className='danger' onClick={()=>choose('discard')}>放弃修改</button><button onClick={()=>choose('cancel')}>取消</button></div>
  </MobileSheet>;
}
