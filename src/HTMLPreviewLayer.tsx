import {useEffect,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {Copy,Pin,PinOff,RefreshCw} from 'lucide-react';
import {attribute,withAttribute,parseBlocks} from '../shared/code-documents.mjs';
import type {CodeIdentity} from './codeBlocks';
import type {EditorHandle} from './editorTypes';
import {htmlPreviewSource} from './htmlPreviewSource';
import {bindCodeResize} from './codeResizeGesture';
import {api} from './bridge';
import type {FileNode} from './types';
import {useMobilePinnedHTML,type MobilePinnedHTML} from './mobile/useMobilePinnedHTML';
import {keepCodeControlFocus} from './editor/controlFocus';
import './htmlPreview.css';

type Patch=Record<string,string>;
type Block=Pick<CodeIdentity,'language'|'code'|'id'|'meta'>&{start?:number};
type Target={key:string;dom:HTMLElement;host:HTMLElement;block:Block;snapshot?:MobilePinnedHTML};
const bounded=(value:unknown)=>Math.max(100,Math.min(1600,Number(value)||280));

function HTMLPreview({path,block,host,owner,codeControls,readOnly,update}:{path:string;block:Block;host:HTMLElement;owner:HTMLElement;codeControls:boolean;readOnly:boolean;update(patch:Patch):void|Promise<void>}){
  const pinned=attribute(block.meta||'','preview')==='pin',stored=bounded(attribute(block.meta||'','previewHeight'));
  const [view,setView]=useState<'source'|'preview'>(pinned?'preview':'source'),[height,setHeight]=useState(stored);
  const opened=view==='preview';
  const [html,setHTML]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,reload]=useState(0),[visible,setVisible]=useState(false);
  const [url,setURL]=useState('');
  const nativeFrame=api.desktop&&api.platform!=='android';
  const handle=useRef<HTMLDivElement>(null),heightRef=useRef(height),latest=useRef({pinned,readOnly,update});
  heightRef.current=height;latest.current={pinned,readOnly,update};
  const apply=(patch:Patch)=>{void Promise.resolve().then(()=>latest.current.update(patch)).catch(failure=>setError((failure as Error).message));};
  useEffect(()=>{setHeight(stored);},[stored]);
  useEffect(()=>{if(pinned)setView('preview');},[pinned]);
  useEffect(()=>{
    if(!nativeFrame||!html){setURL('');return;}
    let live=true,token='';
    void api.feature<{token:string;url:string}>('file.html-inline-open',{path,content:html}).then(view=>{token=view.token;if(live)setURL(view.url);else void api.feature('file.html-close',{token});}).catch(failure=>{if(live)setError((failure as Error).message);});
    return()=>{live=false;if(token)void api.feature('file.html-close',{token}).catch(()=>{});};
  },[html,path,nativeFrame]);
  useEffect(()=>{
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'240px'});
    observer.observe(owner);return()=>observer.disconnect();
  },[owner]);
  useLayoutEffect(()=>{
    const dom=owner;
    dom.dataset.htmlSource=String(!opened);
    dom.dataset.htmlCode=String(codeControls);
    return()=>{delete dom.dataset.htmlSource;delete dom.dataset.htmlCode;};
  },[owner,opened,codeControls]);
  useEffect(()=>{
    if(!opened||!visible){setHTML('');return;}
    let live=true;setBusy(true);setError('');
    const timer=setTimeout(()=>{void htmlPreviewSource(path,block.code).then(value=>{if(live)setHTML(value);}).catch(failure=>{if(live){setHTML('');setError((failure as Error).message);}}).finally(()=>{if(live)setBusy(false);});},150);
    return()=>{live=false;clearTimeout(timer);};
  },[path,block.code,opened,visible,revision]);
  useEffect(()=>{
    if(!handle.current)return;
    return bindCodeResize(handle.current,{mobile:!!host.closest('.mobile-app'),measure:()=>heightRef.current,value:()=>heightRef.current,
      preview:value=>setHeight(bounded(value)),commit:value=>{const height=bounded(value);setHeight(height);if(latest.current.pinned&&!latest.current.readOnly)apply({previewHeight:String(height)});}});
  },[host,opened]);
  const halt=(event:React.SyntheticEvent)=>event.stopPropagation();
  return <section className='html-note-preview' aria-label='HTML 预览' onClick={halt} onPointerDown={event=>{if((event.target as Element).closest('button'))event.preventDefault();}}>
    <div className='html-note-tools' onPointerDown={event=>keepCodeControlFocus(event.currentTarget,event)} onMouseDown={event=>keepCodeControlFocus(event.currentTarget,event)}>
      {!opened&&!codeControls&&<span>HTML</span>}
      <div className='html-note-tabs' role='tablist' aria-label='HTML 视图'>
        <button role='tab' aria-label='HTML 源码' aria-selected={!opened} onClick={()=>setView('source')}>源码</button>
        <button role='tab' aria-label='预览 HTML' aria-selected={opened} onClick={()=>setView('preview')}>预览</button>
      </div>
      {!opened&&!codeControls&&<button aria-label='复制 HTML 源码' title='复制源码' onClick={()=>{
        void (api.desktop?api.feature('clipboard.write',{text:block.code}):navigator.clipboard.writeText(block.code)).catch(failure=>setError((failure as Error).message));
      }}><Copy size={15}/></button>}
      {opened&&<>
        <button aria-label={pinned?'取消钉住 HTML 预览':'钉住 HTML 预览'} title={pinned?'取消钉住':'钉住'} aria-pressed={pinned} disabled={readOnly} onClick={()=>apply({preview:pinned?'':'pin',previewHeight:String(height)})}>{pinned?<PinOff size={15}/>:<Pin size={15}/>}</button>
        <button aria-label='刷新 HTML 预览' title='刷新' disabled={busy} onClick={()=>reload(value=>value+1)}><RefreshCw size={15}/></button>
      </>}
    </div>
    {!opened&&error&&<p className='html-note-error' role='alert'>{error}</p>}
    {opened&&<div className='html-note-window' style={{height}} aria-busy={busy}>
      {error?<p className='html-note-error' role='alert'>{error}</p>:html&&(!nativeFrame||url)?<iframe title='HTML 内嵌页面' sandbox='allow-scripts' referrerPolicy='no-referrer' src={nativeFrame?url:undefined} srcDoc={nativeFrame?undefined:html} allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"/>:<div className='html-note-placeholder'>{busy?'正在加载…':''}</div>}
      <div className='code-resize html-note-resize' ref={handle} role='separator' aria-label='调整 HTML 预览高度' aria-orientation='horizontal' aria-valuenow={height} tabIndex={0} onKeyDown={event=>{
        if(!['ArrowUp','ArrowDown','Home'].includes(event.key))return;event.preventDefault();event.stopPropagation();const next=event.key==='Home'?280:bounded(height+(event.key==='ArrowUp'?-10:10));setHeight(next);if(pinned&&!readOnly)apply({previewHeight:String(next)});
      }}/>
    </div>}
  </section>;
}

/** A single portable preview UI for read and rich-edit views on desktop and Android. */
export function HTMLPreviewLayer({root,path,mode,editor,content,change,files,readOnly=false}:{root:string;path:string;mode:string;editor:RefObject<EditorHandle|null>;content:string;change(value:string):void;files:FileNode[];readOnly?:boolean}){
  const snapshots=useMobilePinnedHTML(root,path,files),snapshotRef=useRef(snapshots);snapshotRef.current=snapshots;
  const [targets,setTargets]=useState<Target[]>([]),latest=useRef({content,change,mode}),rescan=useRef<(()=>void)|null>(null);latest.current={content,change,mode};
  useEffect(()=>{rescan.current?.();},[content]);
  useEffect(()=>{rescan.current?.();},[snapshots.results]);
  useEffect(()=>{
    const scope=document.querySelector('.document-scroll');if(!scope||mode==='source')return;
    const hosts=new Map<string,Target>();let frame=0,live=true;
    const scan=()=>{
      frame=0;if(!live)return;const next:Target[]=[];let ordinal=0;
      for(const dom of scope.querySelectorAll<HTMLElement>('.milkdown-code-block,.reading-view .code-block-shell')){
        const block=mode==='read'?{language:dom.dataset.language||'',code:dom.querySelector('pre > code')?.textContent||'',meta:dom.dataset.codeMeta||'',id:dom.dataset.codeId,start:Number(dom.dataset.sourceFrom)}:editor.current?.codeAt?.(dom);
        if(!block)continue;
        const pinned=snapshotRef.current.results.filter(result=>result.id===block.id);
        const displays=/^html?$/i.test(block.language)?[{key:block.id||'html-'+ordinal++,block,snapshot:undefined}]:pinned.map(snapshot=>({key:snapshot.id+':'+snapshot.index,block:{...block,code:snapshot.code,meta:'{preview=pin previewHeight='+snapshot.height+'}'},snapshot}));
        for(const display of displays){
          const {key}=display;let target=hosts.get(key);
          if(!target){const host=document.createElement('div');host.className='html-preview-ui';host.contentEditable='false';target={key,dom,host,block:display.block};hosts.set(key,target);}
          if(target.host.parentElement!==dom)dom.prepend(target.host);
          next.push({...target,dom,block:display.block,snapshot:display.snapshot});
        }
      }
      const active=new Set(next.map(target=>target.key));for(const [key,target]of hosts)if(!active.has(key)){target.host.remove();hosts.delete(key);}
      setTargets(previous=>previous.length===next.length&&previous.every((target,i)=>target.dom===next[i].dom&&target.host===next[i].host&&target.block.code===next[i].block.code&&target.block.meta===next[i].block.meta)?previous:next);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(scan);};
    rescan.current=schedule;
    const observer=new MutationObserver(records=>{if(records.some(record=>{const element=record.target instanceof Element?record.target:record.target.parentElement;return !element?.closest('.html-preview-ui,.code-language-menu,.code-ui,.cm-gutters,.cm-selectionLayer,.cm-cursorLayer');}))schedule();});
    observer.observe(scope,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-code-meta','data-language','data-editor-pending']});
    window.addEventListener('moyu-code-dom',schedule);scan();
    return()=>{live=false;rescan.current=null;cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('moyu-code-dom',schedule);for(const target of hosts.values())target.host.remove();};
  },[root,path,mode,editor]);
  const update=(target:Target,patch:Patch)=>{
    if(readOnly)return;
    if(target.snapshot)return snapshotRef.current.update(target.snapshot,{...(patch.preview!==undefined?{pinned:patch.preview==='pin'}:{}),...(patch.previewHeight?{height:Number(patch.previewHeight)}:{})});
    if(latest.current.mode!=='read'){
      editor.current?.setCodeAttributes?.(target.dom,target.block.code,patch);return;
    }
    const blocks=parseBlocks(latest.current.content),matching=target.block.id?blocks.filter(block=>block.id===target.block.id):blocks.filter(block=>block.start===target.block.start&&block.code.trimEnd()===target.block.code.trimEnd());
    if(matching.length!==1)return;
    const block=matching[0];let meta=block.meta;
    for(const [key,value]of Object.entries(patch))meta=withAttribute(meta,key,value);
    const header=block.fence+block.language+(meta?' '+meta:'');
    const value=latest.current.content.slice(0,block.start)+header+latest.current.content.slice(block.headerEnd);
    if(value!==latest.current.content)latest.current.change(value);
  };
  return <>{snapshots.error&&<p className='html-note-error' role='alert'>{snapshots.error}</p>}{targets.map(target=>createPortal(<HTMLPreview path={path} block={target.block} host={target.host} owner={target.dom} codeControls={mode!=='read'&&!target.snapshot} readOnly={readOnly} update={patch=>update(target,patch)}/>,target.host,target.key))}</>;
}
