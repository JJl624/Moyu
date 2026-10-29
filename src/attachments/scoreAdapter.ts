import type * as AlphaTab from '@coderline/alphatab';
import {resourceImageURL} from '../resourcePreview';
import {scoreText} from '../../shared/attachment-previews.mjs';
const base=()=>new URL('vendor/alphatab/',document.baseURI).href;
let module:Promise<typeof AlphaTab>|undefined;
const load=():Promise<typeof AlphaTab>=>module ||= (import(/* @vite-ignore */ base()+'alphaTab.min.mjs') as Promise<typeof AlphaTab>).catch(error=>{module=undefined;throw error;});
export const initialScore='\\title "新乐谱"\n\\tempo 100\n.\n:4 0.6 2.6 3.6 0.5 | 2.5 3.5 0.4 2.4 |\n';
export async function mountScore(host:HTMLElement,path:string,signal:AbortSignal,source?:string,preferences:{scale?:number;layout?:string}={}) {
  const alpha=await load();if(signal.aborted)return;
  const api=new alpha.AlphaTabApi(host,{core:{scriptFile:base()+'alphaTab.min.mjs',fontDirectory:base()+'font/',useWorkers:true},
    player:{enablePlayer:false},display:{scale:preferences.scale??0.85,layoutMode:preferences.layout==='horizontal'?alpha.LayoutMode.Horizontal:alpha.LayoutMode.Page}});
  let destroyed=false,rendered=false;
  const dispose=()=>{if(!destroyed){destroyed=true;api.destroy();}};
  const ready=new Promise<void>((resolve,reject)=>{
    api.renderFinished.on(()=>{rendered=true;resolve();});api.error.on((error:Error)=>{if(!rendered){dispose();reject(error);}});
    signal.addEventListener('abort',()=>{dispose();reject(new DOMException('Aborted','AbortError'));},{once:true});
  });
  void ready.catch(()=>{});
  try {
  if(source!==undefined){if(/\.musicxml$/i.test(path))api.load(new TextEncoder().encode(source));else api.tex(source);}
  else {
    const response=await fetch(resourceImageURL('',path),{signal});if(!response.ok)throw Error('乐谱文件不可用');
    if(signal.aborted)return;
    if(scoreText(path)&&/\.(alphatex|atex)$/i.test(path))api.tex(await response.text());
    else api.load(new Uint8Array(await response.arrayBuffer()));
  }
  return {api,ready,alpha};
  } catch(error){dispose();throw error;}
}
