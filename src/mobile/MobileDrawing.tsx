import { useMemo, useRef } from 'react';
import { Excalidraw, serializeAsJSON } from 'moyu-excalidraw';
import '@excalidraw/excalidraw/index.css';
(window as unknown as {EXCALIDRAW_ASSET_PATH:string}).EXCALIDRAW_ASSET_PATH=new URL('./excalidraw/',document.baseURI).href;

export default function MobileDrawing({value,theme,readOnly,change}:{value:string;theme:'light'|'dark';readOnly:boolean;change(value:string):void}) {
  const original=useMemo(()=>{try{const scene=JSON.parse(value);return Array.isArray(scene.elements)?scene:null;}catch{return null;}},[]);
  const last=useRef<string|null>(null);
  if(!original)return <div className='mobile-empty'><h2>无法读取绘图</h2><p>请在源码视图检查 Excalidraw 文件格式。</p></div>;
  return <div className='mobile-drawing-canvas'><Excalidraw initialData={original} theme={theme} langCode='zh-CN' viewModeEnabled={readOnly}
    UIOptions={{canvasActions:{loadScene:false,saveToActiveFile:false,export:false,saveAsImage:false}}}
    onChange={(elements,appState,files)=>{
      const next=JSON.parse(serializeAsJSON(elements,appState,files,'local'));
      for(const [key,value]of Object.entries(original))if(!['type','version','source','elements','appState','files'].includes(key))next[key]=value;
      const content=JSON.stringify(next,null,2);if(readOnly){last.current=content;return;}if(last.current===null){last.current=content;return;}if(content!==last.current){last.current=content;change(content);}
    }}/></div>;
}
