import {settingsStore} from '../settingsStore';
import type {SyncPolicy} from '../../shared/sync-policy.mjs';
export interface SyncConfig {url:string;directory?:string;username:string;password:string;sync?:Partial<SyncPolicy>}
export type Baseline=Record<string,{localHash:string;remoteEtag:string}>;
export interface CloudEntry {path:string;etag:string;size:number;modified:string;type?:'file'|'folder';excluded?:string}
export interface SyncSummary {lastSync:number;checkedAt:number;conflicts:string[];remote:CloudEntry[];pendingUploads:string[];error?:string;needsConfirmation?:boolean;needsDirectoryConfirmation?:boolean}
export const emptySummary=():SyncSummary=>({lastSync:0,checkedAt:0,conflicts:[],remote:[],pendingUploads:[]});
export const hashBytes=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.slice().buffer))].map(value=>value.toString(16).padStart(2,'0')).join('');
export function syncURL(config:SyncConfig){
  const address=config.url.trim();let url:URL;try{url=new URL(address.endsWith('/')?address:address+'/');}catch{throw Error('请填写有效的 HTTPS 服务地址。');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('请填写 HTTPS 服务地址，用户名和密码分别填写。');
  const parts=(config.directory||'').split('/').filter(Boolean);
  if(parts.some(part=>part==='.'||part==='..'||/[\\\u0000-\u001f]/.test(part)))throw Error('同步目录不能包含 .、.. 或反斜杠。');
  if(parts.length)url.pathname+=parts.map(encodeURIComponent).join('/')+'/';
  return url;
}
export async function syncKey(root:string,config:SyncConfig){return 'moyu-mobile-sync-'+await hashBytes(new TextEncoder().encode(root+'\n'+syncURL(config).href+'\n'+config.username));}
export async function syncRootKey(root:string){return 'moyu-mobile-sync-scope-'+await hashBytes(new TextEncoder().encode(root));}
export function readBaseline(key:string):Baseline{return Object.assign(Object.create(null),JSON.parse(settingsStore.getItem(key)||'{}'));}
export function readSummary(key:string):SyncSummary{return {...emptySummary(),...JSON.parse(settingsStore.getItem(key+'-summary')||'{}')};}
export function notifySync(){window.dispatchEvent(new Event('moyu-mobile-sync-changed'));}
export interface SyncOperation {id:string;root:string;kind:'sync'|'list'|'test';stage:string;path:string;full?:boolean;cancel():void}
let operation:SyncOperation|null=null;
const publishOperation=()=>window.dispatchEvent(new Event('moyu-mobile-sync-progress'));
export const currentSyncOperation=()=>operation;
export function beginSyncOperation(value:SyncOperation){if(operation)throw Error('已有同步任务正在执行。');operation=value;publishOperation();}
export function progressSyncOperation(id:string,value:{stage:string;path:string}){if(operation?.id===id){operation={...operation,...value};publishOperation();}}
export function endSyncOperation(id:string){if(operation?.id===id){operation=null;publishOperation();}}
export async function writeSummary(key:string,value:Partial<SyncSummary>){settingsStore.setItem(key+'-summary',JSON.stringify({...readSummary(key),...value}));await settingsStore.flush();notifySync();}
