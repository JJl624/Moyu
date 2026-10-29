import {attachmentPreviewKind, type AttachmentPreviewKind} from '../../shared/attachment-previews.mjs';
import {api} from '../bridge';
import {applyAttachmentSize,attachmentSize} from '../attachmentLayout';
import {drawingSvg,resourceImageURL,resourcePath} from '../resourcePreview';
import {syncAttachmentPreferences} from './preferences';
import {attachmentState} from './viewState';
import {resizeAttachmentViewport} from './viewportResize';
import './previews.css';

export const previewKind=(href:string,image=false,standalone=false)=>attachmentPreviewKind(href,{image,standalone,platform:api.platform});
type Context={host:HTMLElement;body:HTMLElement;document:string;href:string;label:string;signal:AbortSignal;layout():void};
type Renderer=(context:Context)=>Promise<void>;
const label=(c:Context)=>c.host.dataset.previewLabel??c.label;
export function updateAttachmentPreviewLabel(host:HTMLElement,value:string) {
  host.dataset.previewLabel=value;
  const body=host.querySelector<HTMLElement>(':scope > .attachment-preview-body');
  const svg=host.dataset.previewKind==='drawing'?body?.querySelector('svg'):null;
  if(svg)applyAttachmentSize(svg,value,Number(svg.viewBox.baseVal.width)||400);
  const image=host.dataset.previewKind==='image'?body?.querySelector('img'):null;
  if(image){image.alt=attachmentSize(value).label;applyAttachmentSize(image,value,image.naturalWidth);}
  if(body&&['pdf','score'].includes(host.dataset.previewKind||''))applyAttachmentSize(body,value,640);
  let slot=host.querySelector<HTMLElement>(':scope > .attachment-caption-slot');
  if(!slot){slot=document.createElement('span');slot.className='attachment-caption-slot';host.append(slot);}
  let caption=slot.querySelector<HTMLElement>('.attachment-preview-caption');
  let fallback=(host.dataset.previewHref||'').split(/[?#]/)[0].split('/').pop()||'附件';
  try{fallback=decodeURIComponent(fallback);}catch{/* Preserve malformed external names. */}
  const name=attachmentSize(value).label||fallback;
  if(!caption){
    caption=document.createElement(host.dataset.previewEditable==='true'?'button':'span');if(caption instanceof HTMLButtonElement){caption.type='button';caption.title='编辑引用';}caption.className='attachment-preview-caption';
    slot.append(caption);
  }
  caption.textContent=name;
  if(['image','drawing'].includes(host.dataset.previewKind||'')){host.tabIndex=-1;host.setAttribute('role','group');host.setAttribute('aria-label','图片：'+name);host.title='双击查看，点击名称编辑引用';if(body){body.tabIndex=0;body.setAttribute('role','button');body.setAttribute('aria-label','查看图片：'+name);}}
}
const renderers:Record<AttachmentPreviewKind,Renderer>={
  async image(c){
    const image=document.createElement('img');image.draggable=false;c.body.replaceChildren(image);
    await new Promise<void>(resolve=>{
      image.onload=()=>{if(!c.signal.aborted){image.width=image.naturalWidth;image.height=image.naturalHeight;image.alt=attachmentSize(label(c)).label;applyAttachmentSize(image,label(c),image.naturalWidth);c.layout();}resolve();};
      image.onerror=()=>{if(!c.signal.aborted)c.host.dataset.previewError='true';resolve();};
      c.signal.addEventListener('abort',()=>{image.onload=image.onerror=null;resolve();},{once:true});
      image.alt=attachmentSize(label(c)).label;applyAttachmentSize(image,label(c),0);image.src=resourceImageURL(c.document,c.href);
    });
  },
  async drawing(c){
    const svg=await drawingSvg(resourcePath(c.document,c.href));if(c.signal.aborted)return;
    applyAttachmentSize(svg,label(c),Number(svg.viewBox.baseVal.width)||400);c.body.replaceChildren(svg);
  },
  async pdf(c){
    const state=await attachmentState(c.document,c.href);if(c.signal.aborted)return;
    const {mountPdfViewer}=await import('./pdfAdapter');if(c.signal.aborted)return;
    const viewport=document.createElement('div');viewport.className='attachment-pdf-viewport embedpdf-host';viewport.dataset.attachmentControl='true';
    viewport.setAttribute('aria-label','PDF 附件阅读器');c.body.replaceChildren(viewport);
    resizeAttachmentViewport(viewport,'调整 PDF 视窗高度',c.signal,state,()=>500);
    await mountPdfViewer(viewport,resourceImageURL(c.document,c.href),c.signal,{path:resourcePath(c.document,c.href),embedded:true,state});
  },
  async score(c){
    const state=await attachmentState(c.document,c.href);if(c.signal.aborted)return;
    const {mountScoreControls}=await import('./scoreControls');if(c.signal.aborted)return;
    await mountScoreControls(c.body,resourcePath(c.document,c.href),c.signal,{embedded:true,state});
  },
};
const active=new WeakMap<HTMLElement,()=>void>();
export function disposePreview(host:HTMLElement){active.get(host)?.();active.delete(host);}
export function disposePreviews(root:HTMLElement){for(const host of root.querySelectorAll<HTMLElement>('[data-preview-kind]'))disposePreview(host);}
export function mountAttachmentPreview(host:HTMLElement,kind:AttachmentPreviewKind,documentPath:string,href:string,label:string,layout=()=>{},options:{editReference?:boolean}={}) {
  syncAttachmentPreferences();
  disposePreview(host);const abort=new AbortController();let observer:IntersectionObserver|undefined;
  active.set(host,()=>{observer?.disconnect();abort.abort();});
  host.dataset.previewEditable=String(!!options.editReference);host.dataset.previewKind=kind;host.dataset.previewLabel=label;host.dataset.previewHref=href;host.dataset.previewLoading='true';delete host.dataset.previewError;
  host.classList.add('attachment-card');host.contentEditable='false';
  const body=document.createElement('span');body.className='attachment-preview-body';host.replaceChildren(body);
  updateAttachmentPreviewLabel(host,label);
  const run=async()=>{
    observer?.disconnect();
    try {await renderers[kind]({host,body,document:documentPath,href,label,signal:abort.signal,layout});if(!abort.signal.aborted&&!host.dataset.previewError)updateAttachmentPreviewLabel(host,host.dataset.previewLabel??label);}
    catch(error){if(!abort.signal.aborted){host.textContent=attachmentSize(label).label||href;host.dataset.previewError='true';host.title='预览不可用，可通过链接打开文件';}}
    finally{if(!abort.signal.aborted){delete host.dataset.previewLoading;layout();}}
  };
  if(kind==='pdf'||kind==='score'){
    body.textContent=attachmentSize(label).label||href.split('/').pop()||'附件';
    observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))void run();},{rootMargin:'200px'});observer.observe(host);
    return Promise.resolve();
  }
  return run();
}
