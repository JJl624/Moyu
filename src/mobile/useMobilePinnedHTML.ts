import {useEffect,useMemo,useRef,useState} from 'react';
import {api} from '../bridge';
import type {FileNode} from '../types';
import {relativeHref} from '../../shared/link-destinations.mjs';
import {pinnedItems,resultGroups,resultId} from '../../shared/pinned-results.mjs';

export interface MobilePinnedHTML {id:string;index:number;metadata:string;file:string;code:string;height:number}
export function useMobilePinnedHTML(root:string,path:string,files:FileNode[]){
  const [results,setResults]=useState<MobilePinnedHTML[]>([]),[error,setError]=useState('');
  const scope=useRef('');
  const companion=path.replace(/\.(?:md|markdown)$/i,'')+'.assets/',prefix=companion+'results/';
  const metadata=useMemo(()=>api.platform==='android'?files.filter(file=>file.kind==='file'&&(file.path===companion+'document.json'||file.path.startsWith(prefix)&&/^([a-f\d]{4})\/results\.json$/i.test(file.path.slice(prefix.length)))):[],[files,prefix,companion]);
  const signature=useMemo(()=>JSON.stringify(metadata.map(file=>[file.path,file.updated,file.size])),[metadata]);
  useEffect(()=>{
    let live=true;setError('');const key=JSON.stringify([root,path]);
    if(scope.current!==key||!metadata.length)setResults([]);scope.current=key;if(!metadata.length)return;
    const inventory=new Set(files.map(file=>file.path));
    void (async()=>{
      const all:MobilePinnedHTML[]=[];
      const groups=new Map<string,{metadata:string;items:ReturnType<typeof pinnedItems>}>();
      for(const item of [...metadata].sort((a,b)=>Number(b.path.endsWith('/document.json'))-Number(a.path.endsWith('/document.json')))){
        if(item.path!==companion+'document.json'&&groups.has(item.path.slice(prefix.length,prefix.length+4)))continue;
        let text:string;try{text=(await api.read(item.path)).content;}catch(failure){if(!await api.feature<boolean>('file.exists',{path:item.path}))continue;throw failure;}if(item.path!==companion+'document.json'&&text.length>1024*1024)throw Error('HTML 结果记录过大。');
        const data=JSON.parse(text);
        if(item.path===companion+'document.json'){
          for(const [id,record]of Object.entries(resultGroups(data)))if(resultId(id))groups.set(id,{metadata:item.path,items:pinnedItems(record)});
        }else{
          const id=item.path.slice(prefix.length,prefix.length+4);if(resultId(id)&&!groups.has(id))groups.set(id,{metadata:item.path,items:pinnedItems(data)});
        }
      }
      for(const [id,group]of groups)for(const pin of group.items){
        const file=prefix+id+'/'+pin.file;if(!inventory.has(file))continue;
        all.push({id,index:pin.index,metadata:group.metadata,file,code:'src='+JSON.stringify(relativeHref(path,file)),height:Math.max(160,Math.min(900,Number(pin.height)||360))});
      }
      if(live)setResults(previous=>JSON.stringify(previous)===JSON.stringify(all)?previous:all);
    })().catch(failure=>{if(live)setError('HTML 结果未能打开：'+(failure as Error).message);});
    return()=>{live=false;};
  },[root,path,signature]);
  const update=async(result:MobilePinnedHTML,patch:{height?:number;pinned?:boolean})=>{
    const state=await api.feature<{height:number;pinned:boolean}>('mobile.html-result-update',{root,metadata:result.metadata,id:result.id,index:result.index,...patch});
    setResults(previous=>state.pinned?previous.map(item=>item.file===result.file?{...item,height:state.height}:item):previous.filter(item=>item.file!==result.file));
    if(!state.pinned)await (await import('./native')).refreshAndroidWorkspace();
  };
  return{results,error,update};
}
