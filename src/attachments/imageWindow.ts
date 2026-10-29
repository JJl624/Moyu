import {useEffect,useLayoutEffect,useRef,useState,type RefObject,type PointerEvent,type KeyboardEvent} from 'react';
import {attachmentState,type AttachmentViewState,reportAttachmentViewError} from './viewState';

/** One viewer window per document; its URI key is never treated as a file path. */
export function useImageWindow(path:string,panel:RefObject<HTMLElement|null>){
  const controller=useRef<AttachmentViewState|null>(null),drag=useRef<{id:number;x:number;y:number;width:number;height:number}|null>(null);
  const [size,setSize]=useState({width:0,height:0}),[limit,setLimit]=useState({width:0,height:0}),[ready,setReady]=useState(false);
  useEffect(()=>{
    let active=true,unsubscribe:(()=>void)|undefined;
    void attachmentState(path,'moyu-view:image-window').then(state=>{
      if(!active)return;controller.current=state;
      const restore=()=>{if(!drag.current){const value=state.get();setSize({width:value.imageWindowWidth||0,height:value.imageWindowHeight||0});}};
      unsubscribe=state.subscribe(restore);restore();setReady(true);
    }).catch(failure=>{if(active){setReady(true);reportAttachmentViewError(failure);}});
    return()=>{active=false;unsubscribe?.();void controller.current?.flush().catch(reportAttachmentViewError);controller.current=null;};
  },[path]);
  useLayoutEffect(()=>{
    const parent=panel.current?.parentElement;if(!parent)return;
    const measure=()=>setLimit(old=>{const next={width:Math.max(0,parent.clientWidth-24),height:Math.max(0,parent.clientHeight-24)};return old.width===next.width&&old.height===next.height?old:next;});
    const observer=new ResizeObserver(measure);observer.observe(parent);measure();return()=>observer.disconnect();
  },[panel]);
  const bounded=(width:number,height:number)=>({width:Math.min(limit.width,Math.max(Math.min(320,limit.width),width)),height:Math.min(limit.height,Math.max(Math.min(180,limit.height),height))});
  const save=(value:{width:number;height:number})=>{setSize(value);controller.current?.update({imageWindowWidth:value.width,imageWindowHeight:value.height});};
  const reset=()=>save({width:0,height:0});
  const end=(event:PointerEvent)=>{
    if(drag.current?.id!==event.pointerId)return;drag.current=null;
    if(event.type==='pointercancel'){const value=controller.current?.get();setSize({width:value?.imageWindowWidth||0,height:value?.imageWindowHeight||0});}
    else{const box=panel.current!.getBoundingClientRect();save({width:Math.round(box.width),height:Math.round(box.height)});}
  };
  return {style:{width:limit.width?Math.min(size.width||limit.width,limit.width):'100%',height:limit.height?Math.min(size.height||limit.height,limit.height):'100%',visibility:ready?'visible' as const:'hidden' as const},handle:{
    onPointerDown(event:PointerEvent){if(event.button!==0)return;event.preventDefault();event.stopPropagation();const box=panel.current!.getBoundingClientRect();drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,width:box.width,height:box.height};event.currentTarget.setPointerCapture(event.pointerId);},
    onPointerMove(event:PointerEvent){const start=drag.current;if(start?.id===event.pointerId)setSize(bounded(start.width+2*(event.clientX-start.x),start.height+2*(event.clientY-start.y)));},
    onPointerUp:end,onPointerCancel:end,onDoubleClick:reset,
    onKeyDown(event:KeyboardEvent){if(event.key==='Home'){event.preventDefault();reset();}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();event.stopPropagation();const box=panel.current!.getBoundingClientRect();save(bounded(box.width+(event.key==='ArrowLeft'?-24:event.key==='ArrowRight'?24:0),box.height+(event.key==='ArrowUp'?-24:event.key==='ArrowDown'?24:0)));}},
  }};
}
