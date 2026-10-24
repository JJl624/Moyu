import type { DesktopAPI, DiskDocument, Workspace } from '../types';
import { flatten } from '../types';
import { rewrite } from '../../shared/reference-links.mjs';
import { relativeHref } from '../../shared/link-destinations.mjs';
import {confirmMobileClose} from './MobileSaveConfirmation';
import {CoalescedWrites} from '../../shared/coalesced-writes.mjs';

type Reply = { ok: boolean; data?: any; error?: { message: string; code?: string; current?: DiskDocument } };
declare global { interface Window { MoyuNative?: { postMessage(message: string): void; onmessage: ((event: MessageEvent<string>) => void) | null }; } }
const listeners = new Set<(workspace: Workspace) => void>();
let sequence = 0;
const pending = new Map<string, { resolve(value: Reply): void; reject(error: Error): void }>();
export const nativeAvailable = () => !!window.MoyuNative;
function sendRequest(method: string, ...args: unknown[]): Promise<Reply> {
  if (!window.MoyuNative) return Promise.reject(Error('请在安卓版中使用此功能。'));
  const id = String(++sequence);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try { window.MoyuNative!.postMessage(JSON.stringify({ id, method, args })); }
    catch (error) { pending.delete(id); reject(error as Error); }
  });
}
type Draft={root:string;path:string;content:string;version:string};
const drafts=new CoalescedWrites<Draft>(async value=>{
  const reply=await sendRequest('feature','mobile.draft',value);
  if(!reply.ok)throw Object.assign(Error(reply.error?.message||'无法保存恢复草稿。'),reply.error);
});
const writtenFiles=new Map<string,{root:string;path:string}>();
export const flushMobileDrafts=()=>drafts.flush();
export async function request(method:string,...args:unknown[]):Promise<Reply>{
  const action=method==='feature'?args[0]:'';
  if(action==='mobile.draft'){const value=args[1] as Draft;return{ok:true,data:await drafts.set(JSON.stringify([value.root,value.path]),{...value})};}
  if(action==='mobile.draft-clear'){const input=args[1] as {root?:string;path:string};await drafts.discard(value=>value.path===input.path&&(!input.root||value.root===input.root));}
  if(['save','rename','trash','openVault'].includes(method)||['mobile.finish','mobile.internal-vault','mobile.relocate','drawing.save'].includes(String(action)))await drafts.flush();
  const reply=await sendRequest(method,...args);
  if(reply.ok&&(action==='mobile.write-bytes'||action==='mobile.sync-delete')){const input=args[1] as {root:string;path:string};writtenFiles.set(JSON.stringify([input.root,input.path]),{root:input.root,path:input.path});}
  return reply;
}
export async function nativeCall<T>(method: string, ...args: unknown[]): Promise<T> {
  const reply = await request(method, ...args);
  if (!reply.ok) throw Object.assign(Error(reply.error?.message || '操作失败。'), reply.error);
  return reply.data;
}
export const mobileFeature = <T>(action: string, input?: unknown) => nativeCall<T>('feature', action, input);
export const bytesToBase64 = (bytes: Uint8Array) => {
  let result = ''; for (let i = 0; i < bytes.length; i += 32768) result += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(result);
};
let refreshing:Promise<void>|undefined,refreshTicket=0;
function changed():Promise<void> {
  if(refreshing)return refreshing;
  const ticket=++refreshTicket;
  return refreshing=Promise.resolve().then(async()=>{
    // Coalesce a burst before the read starts. A later request after a write
    // needs a fresh traversal and must not reuse an older in-flight snapshot.
    refreshing=undefined;const written=new Map(writtenFiles),workspace=await nativeCall<Workspace>('list');
    if(ticket===refreshTicket){
      workspace.changedPaths=[...written.values()].filter(item=>item.root===workspace.root).map(item=>item.path);
      for(const [key,item]of written)if(item.root===workspace.root&&writtenFiles.get(key)===item)writtenFiles.delete(key);
      listeners.forEach(listener=>listener(workspace));
    }
  });
}
export const refreshAndroidWorkspace = changed;
export const refreshMobileWrites=()=>writtenFiles.size?changed():Promise.resolve();

// The editors and useWorkspace keep their desktop API contract. Only I/O changes.
export function androidBridge(): DesktopAPI {
  if (!window.MoyuNative) throw Error('Android bridge unavailable');
  window.MoyuNative.onmessage = event => {
    try {
      const value = JSON.parse(event.data), job = pending.get(value.id);
      if (job) { pending.delete(value.id); job.resolve(value); }
    } catch { /* Malformed messages do not consume an unrelated pending request. */ }
  };
  const method = (name: string) => (...args: unknown[]) => request(name, ...args);
  const wrap = async (action: () => Promise<unknown>, notify = false) => {
    try { const data = await action(); if (notify) await changed(); return { ok: true, data }; }
    catch (error) { const failure = error as Error & { code?: string; current?: DiskDocument }; return { ok: false, error: { message: failure.message, code: failure.code, current: failure.current } }; }
  };
  const bridge = {
    desktop: true, platform: 'android',
    load: method('load'), list: method('list'), read: method('read'), save: method('save'),
    create: (...args: unknown[]) => wrap(() => nativeCall('create', ...args), true),
    rename: (...args: unknown[]) => wrap(() => nativeCall('rename', ...args), true),
    trash: (...args: unknown[]) => wrap(() => nativeCall('trash', ...args), true),
    openVault: method('openVault'), search: method('search'),
    importFiles: () => wrap(() => nativeCall('importFiles'), true),
    exportFile: method('exportFile'), exportPDF: method('exportPDF'), openExternal: method('openExternal'),
    upload: (document: string, name: string, bytes: Uint8Array) => wrap(async () => {
      const result = await mobileFeature<{ path: string }>('attachment.upload', { document, name, base64: bytesToBase64(bytes) });
      return relativeHref(document, result.path);
    }, true),
    assetData: (path: string) => wrap(async () => {
      const result = await mobileFeature<{ base64: string }>('mobile.read-bytes', { path });
      return 'data:application/octet-stream;base64,' + result.base64;
    }),
    feature: async (action: string, input: any = {}) => {
      if (action === 'attachment.rename') return wrap(async () => {
        const workspace = await nativeCall<Workspace>('list'), files = flatten(workspace.tree), inventory = files.map(file => file.path);
        const moves = [{ from: input.from, to: input.to }];
        const companion = (name: string) => name.replace(/\.(md|markdown)$/i, '') + '.assets';
        if (/\.(md|markdown)$/i.test(input.from) && await mobileFeature<boolean>('file.exists', { path: companion(input.from) }))
          moves.push({ from: companion(input.from), to: companion(input.to) });
        const remap = (path: string) => { const move = moves.find(move => path === move.from || path.startsWith(move.from + '/')); return move ? move.to + path.slice(move.from.length) : path; };
        const edits = [], buffers = [];
        for (const file of files.filter(file => /\.(md|markdown)$/i.test(file.path))) {
          const disk = await nativeCall<DiskDocument>('read', file.path), buffer = input.buffers?.find((buffer: any) => buffer.path === file.path);
          const content = await rewrite(disk.content, file.path, moves, undefined, inventory);
          if (content !== disk.content) edits.push({ original: file.path, path: remap(file.path), content, version: disk.version });
          if (buffer) {
            if (buffer.version !== disk.version) throw Object.assign(Error('文档已发生变更。'), { code: 'CONFLICT', current: disk });
            buffers.push({ original: file.path, path: remap(file.path), content: await rewrite(buffer.content, file.path, moves, undefined, inventory) });
          }
        }
        const result = await mobileFeature<{ moves: typeof moves; documents: DiskDocument[] }>('mobile.relocate', { root: input.root, moves, edits });
        return { ...result, buffers };
      });
      if (action === 'attachment.upload' && input.bytes) input = { ...input, bytes: undefined, base64: bytesToBase64(new Uint8Array(input.bytes)) };
      if (action === 'document.confirm-close') return wrap(async()=>{
        const choice=await confirmMobileClose(input.paths||[]);
        if(choice==='discard')for(const path of input.paths||[])await mobileFeature('mobile.draft-clear',{path});
        return choice;
      });
      return request('feature', action, input);
    },
    reveal: () => wrap(async () => {}), windowControl: () => wrap(async () => {}), confirmClose: () => wrap(async () => {}),
    onChange: (listener: (workspace: Workspace) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    onCommand: () => () => {}, onBeforeClose: () => () => {},
    updateState: () => wrap(async () => (await import('./mobileUpdates')).mobileUpdates.state()),
    checkUpdate: (manual:boolean) => wrap(async () => (await import('./mobileUpdates')).mobileUpdates.check(manual)),
    configureUpdate: (automatic:boolean) => wrap(async () => (await import('./mobileUpdates')).mobileUpdates.configure(automatic)),
  };
  return bridge as unknown as DesktopAPI;
}
