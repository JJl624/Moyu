import {api} from '../bridge';
import {attachmentView,attachmentViews,type AttachmentView} from '../../shared/attachment-view-state.mjs';
import {attachmentViewKey} from './preferences';

export type AttachmentViewState={get():AttachmentView;update(patch:AttachmentView):void;subscribe(listener:()=>void):()=>void;flush():Promise<void>};
type DocumentState={rows:Record<string,AttachmentView>;pending:Map<string,AttachmentView>;listeners:Set<()=>void>;timer?:ReturnType<typeof setTimeout>;queue:Promise<void>;document:string;root:string;writes:number;recordPath:string};
const documents=new Map<string,Promise<DocumentState>>();
const error=(failure:unknown)=>window.dispatchEvent(new CustomEvent('moyu-attachment-view-error',{detail:String((failure as Error).message||failure)}));
function rootKey(){try{return String(JSON.parse(attachmentViewKey(''))[0]);}catch{return '';}}
async function flush(state:DocumentState){
  clearTimeout(state.timer);state.timer=undefined;
  if(!state.pending.size)return state.queue;
  const patches=[...state.pending];state.pending.clear();
  state.writes++;
  const task=state.queue.catch(()=>{}).then(async()=>{
    for(const [key,patch]of patches){
      if(api.desktop&&api.platform==='win32'&&/\.(md|markdown)$/i.test(state.document))await api.feature('attachment.views-update',{document:state.document,root:state.root,key,patch});
    }
  }).catch(failure=>{for(const [key,patch]of patches)state.pending.set(key,{...patch,...state.pending.get(key)});throw failure;}).finally(()=>state.writes--);state.queue=task;
  await task;
  if(state.pending.size)await flush(state);
}
export async function flushAttachmentViews(){await Promise.all([...documents.values()].map(async pending=>{const state=await pending;if(state.root===rootKey())await flush(state);}));}
export const reportAttachmentViewError=error;
type Response={views:unknown;directory:string};
async function reload(state:DocumentState){
  if(state.root!==rootKey()||state.pending.size||state.writes||!api.desktop||api.platform!=='win32')return;
  const value=await api.feature<Response>('attachment.views-read',{document:state.document,root:state.root}),rows=attachmentViews(value.views);
  state.recordPath=value.directory+'/document.json';
  if(JSON.stringify(rows)!==JSON.stringify(state.rows)){state.rows=rows;for(const listener of state.listeners)listener();}
}
export async function reloadAttachmentViews(paths:string[]){await Promise.all([...documents.values()].map(async pending=>{const state=await pending;if(paths.includes(state.document))await reload(state);}));}
export async function attachmentState(document:string,href:string):Promise<AttachmentViewState>{
  const id=attachmentViewKey(document),root=rootKey();
  let pending=documents.get(id);
  if(!pending){
    pending=(async()=>{const value=api.desktop&&api.platform==='win32'&&/\.(md|markdown)$/i.test(document)?await api.feature<Response>('attachment.views-read',{document,root}):{views:{},directory:''};return {document,root,rows:attachmentViews(value.views),recordPath:value.directory+'/document.json',pending:new Map(),listeners:new Set(),queue:Promise.resolve(),writes:0} as DocumentState;})();
    documents.set(id,pending);pending.catch(()=>{if(documents.get(id)===pending)documents.delete(id);});
    // Bound memory, without dropping an uncommitted preference change.
    if(documents.size>128){const first=documents.keys().next().value!;if(first!==id)void documents.get(first)!.then(state=>flush(state)).then(()=>documents.delete(first)).catch(error);}
  }
  const state=await pending,key=href;
  return {
    get:()=>({...state.rows[key]}),
    update(patch){
      const value=attachmentView({...state.rows[key],...patch});if(JSON.stringify(value)===JSON.stringify(state.rows[key]||{}))return;
      state.rows[key]=value;state.pending.set(key,{...state.pending.get(key),...attachmentView(patch)});
      for(const listener of state.listeners)listener();
      clearTimeout(state.timer);state.timer=setTimeout(()=>void flush(state).catch(error),400);
    },
    subscribe(listener){state.listeners.add(listener);return()=>state.listeners.delete(listener);},
    flush:()=>flush(state),
  };
}
if(typeof window!=='undefined')window.addEventListener('moyu-resources-changed',event=>{
  if(!(event as CustomEvent<string[]>).detail.some(path=>path.endsWith('/document.json')))return;
  for(const pending of documents.values())void pending.then(async state=>{
    if((event as CustomEvent<string[]>).detail.includes(state.recordPath))await reload(state);
  }).catch(error);
});
