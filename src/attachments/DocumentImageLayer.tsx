import {useEffect,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {ChevronLeft,ChevronRight,Minus,Plus,RotateCcw,RotateCw,Scan,X,LoaderCircle} from 'lucide-react';
import {attachmentSize} from '../attachmentLayout';
import {drawingSvg,resourceImageURL,resourcePath} from '../resourcePreview';
import type {EditorHandle,EditorContext} from '../editorTypes';
import {attachmentState,type AttachmentViewState,reportAttachmentViewError} from './viewState';
import type {AttachmentView} from '../../shared/attachment-view-state.mjs';
import {useImageWindow} from './imageWindow';
import './imageGallery.css';

type Picture={href:string;name:string;kind:'image'|'drawing';media?:Element};
type Gallery={items:Picture[];index:number;restore?:EditorContext|null};
const cardSelector='.attachment-card:is([data-preview-kind=image],[data-preview-kind=drawing])';

export default function DocumentImageLayer({path,editor,mode}:{path:string;editor:RefObject<EditorHandle|null>;mode:'rich'|'read'}){
  const anchor=useRef<HTMLSpanElement>(null),[gallery,setGallery]=useState<Gallery|null>(null),[parent,setParent]=useState<HTMLElement|null>(null);
  const latest=useRef(gallery);latest.current=gallery;
  const close=()=>{const restore=latest.current?.restore;setGallery(null);requestAnimationFrame(()=>{if(document.activeElement===document.body&&!document.querySelector('.modal[role="dialog"]'))restore?.restore();});};
  useEffect(()=>{
    const scroll=anchor.current?.closest<HTMLElement>('.document-scroll');if(!scroll)return;setParent(scroll.closest<HTMLElement>('.main-area'));
    const find=(target:EventTarget|null)=>target instanceof Element?target.closest<HTMLElement>(cardSelector):null;
    const select=(event:MouseEvent)=>{
      const card=find(event.target);
      for(const old of scroll.querySelectorAll('.preview-selected'))if(old!==card)old.classList.remove('preview-selected');
      if(mode==='read'&&event.button===0&&card)card.classList.add('preview-selected');
    };
    const open=(card:HTMLElement)=>{
      const ordered=mode==='rich'?[...scroll.querySelectorAll<HTMLElement>('[data-attachment-preview]')].map(source=>document.getElementById(source.dataset.attachmentPreview||'')?.querySelector<HTMLElement>(cardSelector)).filter((value):value is HTMLElement=>!!value):[...scroll.querySelectorAll<HTMLElement>(cardSelector)];
      const index=ordered.indexOf(card);if(index<0)return;
      const items:Picture[]=ordered.map(element=>({href:element.dataset.previewHref||element.dataset.resourceLink||'',name:attachmentSize(element.dataset.previewLabel||element.dataset.resourceLabel||'').label||'图片',kind:element.dataset.previewKind as 'image'|'drawing',media:element.querySelector('.attachment-preview-body > :is(img,svg)')||undefined}));
      const box=card.getBoundingClientRect(),restore=mode==='rich'?editor.current?.prepareContext?.(card,{left:box.left+box.width/2,top:box.top+box.height/2}):null;
      setGallery({items,index,restore});
    };
    const double=(event:MouseEvent)=>{const card=find(event.target);if(!card||(event.target as Element).closest('.attachment-preview-caption'))return;event.preventDefault();event.stopPropagation();open(card);};
    const key=(event:KeyboardEvent)=>{const card=find(event.target);if(!card||event.key!=='Enter'||(event.target as Element).closest('.attachment-preview-caption'))return;event.preventDefault();event.stopPropagation();open(card);};
    scroll.addEventListener('click',select);scroll.addEventListener('dblclick',double,true);scroll.addEventListener('keydown',key,true);
    return()=>{scroll.removeEventListener('click',select);scroll.removeEventListener('dblclick',double,true);scroll.removeEventListener('keydown',key,true);};
  },[path,mode,editor]);
  return <><span hidden ref={anchor}/>{gallery&&parent&&createPortal(<PictureDialog documentPath={path} gallery={gallery} change={index=>setGallery(value=>value?{...value,index}:null)} close={close}/>,parent)}</>;
}

function PictureDialog({documentPath,gallery,change,close}:{documentPath:string;gallery:Gallery;change(index:number):void;close():void}){
  const picture=gallery.items[gallery.index],canvas=useRef<HTMLDivElement>(null),panel=useRef<HTMLElement>(null),controller=useRef<AttachmentViewState|null>(null);
  const imageWindow=useImageWindow(documentPath,panel);
  const [source,setSource]=useState(''),[error,setError]=useState(''),[readyPicture,setReadyPicture]=useState<Picture|null>(null),[preferences,setPreferences]=useState<AttachmentView>({}),[dimensions,setDimensions]=useState({width:0,height:0}),[viewport,setViewport]=useState({width:0,height:0});
  const drag=useRef<{id:number;x:number;y:number;left:number;top:number}|null>(null),zoomAnchor=useRef<{x:number;y:number}|null>(null);
  useEffect(()=>{
    let active=true,url='',unsubscribe:(()=>void)|undefined;setReadyPicture(null);setSource('');setError('');setDimensions({width:0,height:0});controller.current=null;
    void (async()=>{
      try{const state=await attachmentState(documentPath,picture.href);if(!active)return;controller.current=state;setPreferences(state.get());unsubscribe=state.subscribe(()=>setPreferences(state.get()));}
      catch(failure){if(active){setPreferences({});reportAttachmentViewError(failure);}}
      if(!active)return;
      try{
        if(picture.kind==='drawing'){
          const svg=picture.media instanceof SVGSVGElement&&picture.media.isConnected?picture.media.cloneNode(true) as SVGSVGElement:await drawingSvg(resourcePath(documentPath,picture.href));
          if(!active)return;
          const bounds=svg.viewBox.baseVal;svg.setAttribute('width',String(bounds.width||400));svg.setAttribute('height',String(bounds.height||200));svg.style.removeProperty('width');svg.style.removeProperty('height');svg.style.removeProperty('max-width');
          if(picture.media?.isConnected)svg.style.color=getComputedStyle(picture.media).color;
          url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));setSource(url);
        }else setSource(picture.media instanceof HTMLImageElement&&picture.media.isConnected?picture.media.currentSrc||picture.media.src:resourceImageURL(documentPath,picture.href));
      }catch(failure){if(active)setError(String((failure as Error).message||failure));}
      finally{if(active)setReadyPicture(picture);}
    })();
    return()=>{active=false;unsubscribe?.();void controller.current?.flush().catch(reportAttachmentViewError);controller.current=null;if(url)URL.revokeObjectURL(url);};
  },[documentPath,picture]);
  useLayoutEffect(()=>{
    const element=canvas.current;if(!element)return;
    const measure=()=>setViewport(old=>old.width===element.clientWidth&&old.height===element.clientHeight?old:{width:element.clientWidth,height:element.clientHeight});
    const observer=new ResizeObserver(measure);observer.observe(element);measure();return()=>observer.disconnect();
  },[]);
  const rotation=preferences.imageRotation||0,turned=rotation%180!==0;
  const width=turned?dimensions.height:dimensions.width,height=turned?dimensions.width:dimensions.height;
  const fit=width&&height?Math.min(1,Math.max(1,viewport.width-32)/width,Math.max(1,viewport.height-32)/height):1;
  const scale=typeof preferences.imageZoom==='number'?preferences.imageZoom:fit;
  const frame={width:Math.max(viewport.width,width*scale+32),height:Math.max(viewport.height,height*scale+32)};
  const save=(patch:AttachmentView)=>{if(controller.current)controller.current.update(patch);else setPreferences(value=>({...value,...patch}));};
  const zoom=(next:number)=>{
    const element=canvas.current;if(element)zoomAnchor.current={x:(element.scrollLeft+element.clientWidth/2)/Math.max(1,frame.width),y:(element.scrollTop+element.clientHeight/2)/Math.max(1,frame.height)};
    save({imageZoom:Math.round(Math.max(.05,Math.min(16,next))*1000)/1000});
  };
  const actions=useRef({scale,zoom,change,close,index:gallery.index,total:gallery.items.length,loaded:false});actions.current={scale,zoom,change,close,index:gallery.index,total:gallery.items.length,loaded:readyPicture===picture&&!!dimensions.width};
  useLayoutEffect(()=>{
    const element=canvas.current,point=zoomAnchor.current;if(!element)return;
    if(point){element.scrollLeft=point.x*frame.width-element.clientWidth/2;element.scrollTop=point.y*frame.height-element.clientHeight/2;zoomAnchor.current=null;}
  },[frame.width,frame.height]);
  useEffect(()=>{
    const element=canvas.current!;
    const wheel=(event:WheelEvent)=>{if(!(event.ctrlKey||event.metaKey)||!event.deltaY)return;event.preventDefault();event.stopImmediatePropagation();if(actions.current.loaded)actions.current.zoom(actions.current.scale*(event.deltaY<0?1.1:1/1.1));};
    const key=(event:KeyboardEvent)=>{
      if([...document.querySelectorAll('.modal[role="dialog"]')].at(-1)!==panel.current)return;
      const current=actions.current;
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();current.close();return;}
      if(['ArrowLeft','ArrowRight'].includes(event.key)&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!(event.target instanceof Element&&event.target.closest('.image-window-resize'))){event.preventDefault();event.stopImmediatePropagation();const next=current.index+(event.key==='ArrowLeft'?-1:1);if(next>=0&&next<current.total)current.change(next);}
      if(event.key==='Tab'){const nodes=[...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]:not([disabled])')],first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    };
    const outside=(event:MouseEvent)=>{if(event.target instanceof Element&&!event.target.closest('.document-image-overlay'))actions.current.close();};
    element.addEventListener('wheel',wheel,{capture:true,passive:false});window.addEventListener('keydown',key,true);window.addEventListener('mousedown',outside,true);panel.current?.querySelector<HTMLButtonElement>('[aria-label="关闭图片查看器"]')?.focus({preventScroll:true});
    return()=>{element.removeEventListener('wheel',wheel,true);window.removeEventListener('keydown',key,true);window.removeEventListener('mousedown',outside,true);};
  },[]);
  const previous=gallery.index>0,next=gallery.index<gallery.items.length-1,ready=readyPicture===picture,adjustable=ready&&!!dimensions.width;
  return <div className='document-image-overlay' onMouseDown={event=>{if(event.target===event.currentTarget)close();}} onContextMenu={event=>{event.preventDefault();event.stopPropagation();}}>
    <section className='document-image-viewer modal' role='dialog' aria-modal='true' aria-label='文档图片查看器' ref={panel} style={imageWindow.style}>
      <header><strong title={picture.name}>{picture.name}</strong><span className='image-gallery-count' aria-label='图片位置'>{gallery.index+1} / {gallery.items.length}</span><span className='image-gallery-spacer'/>
        <button aria-label='上一张图片' title='上一张（←）' disabled={!previous} onClick={()=>change(gallery.index-1)}><ChevronLeft size={17}/></button><button aria-label='下一张图片' title='下一张（→）' disabled={!next} onClick={()=>change(gallery.index+1)}><ChevronRight size={17}/></button>
        <button aria-label='缩小图片' title='缩小' disabled={!adjustable} onClick={()=>zoom(scale/1.25)}><Minus size={16}/></button><span className='image-gallery-percent' aria-label='图片缩放比例'>{ready?Math.round(scale*100)+'%':'—'}</span><button aria-label='放大图片' title='放大' disabled={!adjustable} onClick={()=>zoom(scale*1.25)}><Plus size={16}/></button>
        <button aria-label='适应窗口' title='适应窗口' disabled={!adjustable} onClick={()=>save({imageZoom:'fit'})}><Scan size={16}/></button><button aria-label='向左旋转图片' title='向左旋转' disabled={!adjustable} onClick={()=>save({imageRotation:(rotation+270)%360})}><RotateCcw size={16}/></button><button aria-label='向右旋转图片' title='向右旋转' disabled={!adjustable} onClick={()=>save({imageRotation:(rotation+90)%360})}><RotateCw size={16}/></button><button aria-label='关闭图片查看器' title='关闭（Esc）' onClick={close}><X size={18}/></button>
      </header>
      <div className='document-image-canvas' ref={canvas} onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();const element=event.currentTarget;drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,left:element.scrollLeft,top:element.scrollTop};element.setPointerCapture(event.pointerId);}} onPointerMove={event=>{const start=drag.current;if(start?.id!==event.pointerId)return;event.currentTarget.scrollLeft=start.left+start.x-event.clientX;event.currentTarget.scrollTop=start.top+start.y-event.clientY;}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
        {!ready?<div className='image-gallery-loading'><LoaderCircle size={22} className='spin' aria-label='正在加载图片'/></div>:error?<p role='alert'>{error}</p>:source&&<div className='document-image-frame' style={frame}><img key={source} src={source} alt={picture.name} draggable={false} style={{opacity:dimensions.width?1:0,width:dimensions.width||undefined,height:dimensions.height||undefined,transform:`translate(-50%,-50%) rotate(${rotation}deg) scale(${scale})`}} onLoad={event=>setDimensions({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})} onError={()=>setError('图片无法读取。')}/></div>}
      </div>
      <div className='image-window-resize' role='button' tabIndex={0} aria-label='调整图片查看器大小' title='拖动调整大小，双击恢复默认' {...imageWindow.handle}><svg width='14' height='14' viewBox='0 0 16 16' fill='none' stroke='currentColor'><path d='M3 13 13 3M8 13l5-5'/></svg></div>
    </section>
  </div>;
}
