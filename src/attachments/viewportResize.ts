import {type AttachmentViewState,reportAttachmentViewError} from './viewState';

/** A height-only resize control. Browser resize grips can retain a pixel width
 * and cannot distinguish user changes from responsive layout restoration. */
export function resizeAttachmentViewport(viewport:HTMLElement,label:string,signal:AbortSignal,state?:AttachmentViewState,defaultHeight:()=>number=()=>400){
  const handle=document.createElement('div');handle.className='attachment-viewport-resize';handle.dataset.attachmentControl='true';handle.tabIndex=0;
  handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','horizontal');handle.setAttribute('aria-label',label);handle.title='拖动调整高度，双击恢复默认';
  handle.setAttribute('aria-valuemin','120');handle.setAttribute('aria-valuemax','4000');
  let drag:{id:number;y:number;height:number;style:string}|undefined;
  const bounded=(height:number)=>Math.max(120,Math.min(4000,Math.round(height)));
  const show=(height:number)=>{const value=bounded(height)+'px';if(viewport.style.height!==value)viewport.style.height=value;handle.setAttribute('aria-valuenow',String(bounded(height)));};
  const restore=()=>{if(drag)return;const saved=state?.get().height;if(saved!==undefined)show(saved||defaultHeight());};restore();
  const unsubscribe=state?.subscribe(restore);
  handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();drag={id:event.pointerId,y:event.clientY,height:viewport.getBoundingClientRect().height,style:viewport.style.height};handle.setPointerCapture(event.pointerId);handle.classList.add('resizing');},{signal});
  handle.addEventListener('pointermove',event=>{if(drag?.id===event.pointerId){event.preventDefault();show(drag.height+event.clientY-drag.y);}},{signal});
  const end=(event:PointerEvent)=>{if(drag?.id!==event.pointerId)return;if(event.type==='pointercancel')viewport.style.height=drag.style;else state?.update({height:parseFloat(viewport.style.height)});drag=undefined;handle.classList.remove('resizing');};
  handle.addEventListener('pointerup',end,{signal});handle.addEventListener('pointercancel',end,{signal});
  handle.addEventListener('dblclick',event=>{event.preventDefault();show(defaultHeight());state?.update({height:0});},{signal});
  handle.addEventListener('keydown',event=>{if(!['ArrowUp','ArrowDown','Home'].includes(event.key))return;event.preventDefault();show(event.key==='Home'?defaultHeight():viewport.getBoundingClientRect().height+(event.key==='ArrowUp'?-24:24));state?.update({height:event.key==='Home'?0:parseFloat(viewport.style.height)});},{signal});
  viewport.after(handle);
  signal.addEventListener('abort',()=>{unsubscribe?.();void state?.flush().catch(reportAttachmentViewError);},{once:true});
  return handle;
}
