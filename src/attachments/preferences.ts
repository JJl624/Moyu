import {settingsStore} from '../settingsStore';
import {viewerPages,rememberViewerPage} from '../../shared/attachment-view-state.mjs';
let scope='';
export const setAttachmentScope=(value:string)=>{scope=value;};
export const attachmentViewKey=(path:string)=>JSON.stringify([scope,path]);
const pageKey='moyu-attachment-pages';
function pages(){try{return viewerPages(JSON.parse(settingsStore.getItem(pageKey)||'[]'));}catch{return [];}}
export const rememberedPage=(key:string,fallback=1)=>pages().find(row=>row[0]===key)?.[1]||fallback;
export function rememberPage(key:string,page:number){
  const rows=pages(),previous=rows.find(row=>row[0]===key)?.[1];if(previous===page||previous===undefined&&page===1)return;
  settingsStore.setItem(pageKey,JSON.stringify(rememberViewerPage(rows,key,page)));
}
export const attachmentCaptions=()=>settingsStore.getItem('moyu-attachment-captions')!=='false';
export function syncAttachmentPreferences(){document.documentElement.dataset.attachmentCaptions=attachmentCaptions()?'show':'hide';}
export function setAttachmentCaptions(value:boolean){settingsStore.setItem('moyu-attachment-captions',String(value));syncAttachmentPreferences();}
