import {useEffect,useRef,useState} from 'react';
import {Minus,Plus,RotateCcw,X} from 'lucide-react';
import type {MobileMedia} from './useMobileReading';

export function MobileMediaViewer({media,close}:{media:MobileMedia;close():void}) {
  const [zoom,setZoom]=useState(1),area=useRef<HTMLDivElement>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{dialog.current?.showModal();},[]);
  const pointers=useRef(new Map<number,{x:number;y:number}>()),gesture=useRef({distance:0,zoom:1});
  const tap=useRef({last:0,x:0,y:0,moved:false});
  const change=(value:number)=>setZoom(Math.max(1,Math.min(5,value)));
  const distance=()=>{const [a,b]=[...pointers.current.values()];return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;};
  return <dialog ref={dialog} className='mobile-media-viewer' aria-label='全屏查看' onCancel={event=>{event.preventDefault();close();}}>
    <header><button aria-label='关闭全屏查看' autoFocus onClick={close}><X size={22}/></button><strong>{media.label}</strong><button aria-label='缩小' disabled={zoom<=1} onClick={()=>change(zoom-.5)}><Minus size={20}/></button><button aria-label='还原大小' onClick={()=>{change(1);area.current?.scrollTo(0,0);}}><RotateCcw size={18}/></button><button aria-label='放大' disabled={zoom>=5} onClick={()=>change(zoom+.5)}><Plus size={20}/></button></header>
    <div className='mobile-media-pan' ref={area} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});tap.current={...tap.current,x:event.clientX,y:event.clientY,moved:pointers.current.size>1};if(pointers.current.size===2)gesture.current={distance:distance(),zoom};}}
      onPointerMove={event=>{const previous=pointers.current.get(event.pointerId);if(!previous)return;if(Math.hypot(event.clientX-tap.current.x,event.clientY-tap.current.y)>8)tap.current.moved=true;pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});if(pointers.current.size===2&&gesture.current.distance){event.preventDefault();change(gesture.current.zoom*distance()/gesture.current.distance);}else if(area.current){area.current.scrollLeft+=previous.x-event.clientX;area.current.scrollTop+=previous.y-event.clientY;}}}
      onPointerUp={event=>{pointers.current.delete(event.pointerId);if(tap.current.moved)return;const now=Date.now();if(now-tap.current.last<280){change(zoom===1?2:1);tap.current.last=0;}else tap.current.last=now;}} onPointerCancel={()=>{pointers.current.clear();tap.current.last=0;}}>
      <div className='mobile-media-content' style={{width:zoom*100+'%',minHeight:zoom*100+'%'}}>
        {media.src?<img src={media.src} alt={media.label} draggable={false}/>:<div className='mobile-media-svg' dangerouslySetInnerHTML={{__html:media.svg||''}}/>}
      </div>
    </div><footer><output>{Math.round(zoom*100)}%</output><span>双击缩放 · 放大后滑动查看</span></footer>
  </dialog>;
}
