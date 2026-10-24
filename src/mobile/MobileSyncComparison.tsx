import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import type {SyncConflict} from './sync';
import {mobileFeature} from './native';
const HistoryDiff=lazy(()=>import('../documents/HistoryDiff').then(module=>({default:module.HistoryDiff})));
const text=(base64:string)=>new TextDecoder().decode(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)));

function DrawingSnapshot({value}:{value:string|null}){
  const host=useRef<HTMLDivElement>(null),[error,setError]=useState('');
  useEffect(()=>{if(!value)return;let live=true;void(async()=>{try{const scene=JSON.parse(value);if(!Array.isArray(scene.elements))throw Error('绘图格式无效');const {exportToSvg}=await import('moyu-excalidraw');const svg=await exportToSvg({elements:scene.elements,appState:{...scene.appState,exportBackground:true},files:scene.files||{}});if(live)host.current?.replaceChildren(svg);}catch(error){if(live)setError((error as Error).message);}})();return()=>{live=false;};},[value]);
  return <div className='mobile-drawing-snapshot' ref={host}>{value?error||'正在生成预览…':'此文件已删除'}</div>;
}
export function MobileSyncComparison({value,root}:{value:SyncConflict;root:string}){
  const [local,setLocal]=useState(value.local),[error,setError]=useState(''),[ready,setReady]=useState(!value.truncated&&!/\.excalidraw$/i.test(value.path));
  useEffect(()=>{let live=true;setLocal(value.local);setError('');const full=value.truncated||/\.excalidraw$/i.test(value.path);setReady(!full||value.local===null);if(full&&value.local!==null)void mobileFeature<{base64:string;hash:string}>('mobile.read-bytes',{root,path:value.path}).then(result=>{if(result.hash!==value.localHash)throw Error('本地文件已改变，请重新同步。');if(live){setLocal(text(result.base64));setReady(true);}}).catch(error=>{if(live)setError((error as Error).message);});return()=>{live=false;};},[root,value]);
  if(error)return <p role='alert' className='mobile-inline-error'>{error}</p>;
  if(!ready)return <p className='mobile-caption'>正在读取文件…</p>;
  const remote=value.remoteBytes===null?value.remote:value.remote==='二进制文件'?'二进制文件':text(value.remoteBytes);
  return /\.excalidraw$/i.test(value.path)?<div className='mobile-drawing-comparison'>{[['本地',local],['云端',remote]].map(([label,content])=><section key={label}><h3>{label}</h3><DrawingSnapshot value={content}/></section>)}</div>
    :<Suspense fallback={<p className='mobile-caption'>正在比较…</p>}><HistoryDiff left={local??'本地已删除'} right={remote??'云端已删除'} labels={['本地','云端']}/></Suspense>;
}
