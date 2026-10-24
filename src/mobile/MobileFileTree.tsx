import {useEffect,useRef} from 'react';
import {CheckCircle2,ChevronDown,ChevronRight,Circle,Cloud,CloudAlert,CloudCheck,CloudOff,CloudUpload,Folder,FolderOpen,MoreHorizontal} from 'lucide-react';
import {displayName,folderOf,type FileNode} from '../types';
import {FileIcon} from '../FileIcon';
import {cloudLabels,type CloudState} from './useMobileCloud';
const visible=(node:FileNode)=>!node.system&&!node.companionFor&&!node.name.endsWith('.assets')&&node.name!=='code-data';
export function FileCloudBadge({state}:{state?:CloudState}){if(!state)return null;const Icon=state==='excluded'?CloudOff:state==='synced'?CloudCheck:state==='conflict'?CloudAlert:state==='pending'||state==='local'?CloudUpload:Cloud;return <span className={'mobile-file-cloud '+state} data-sync-state={state} aria-label={cloudLabels[state]} title={cloudLabels[state]}><Icon size={14}/><span>{cloudLabels[state]}</span></span>;}
export function MobileFileTree({tree,folder,active,states,open,chooseFolder,more,expanded,setExpanded,selecting,selected,select,startSelection,showHidden=false}:{tree:FileNode[];folder:string;active:string;states:Record<string,CloudState>;open(path:string):void;chooseFolder(path:string):void;more(file:FileNode):void;expanded:Set<string>;setExpanded:React.Dispatch<React.SetStateAction<Set<string>>>;selecting:boolean;selected:Set<string>;select(path:string):void;startSelection(path:string):void;showHidden?:boolean}){
  const included=(node:FileNode)=>showHidden||visible(node);
  const press=useRef({timer:0,x:0,y:0,suppress:''});
  const cancel=()=>clearTimeout(press.current.timer);
  useEffect(()=>cancel,[]);
  useEffect(()=>{if(folder)setExpanded(previous=>new Set([...previous,...folder.split('/').map((_,index,parts)=>parts.slice(0,index+1).join('/'))]));},[folder]);
  const rows:{node:FileNode;depth:number}[]=[];const visit=(nodes:FileNode[],depth=0)=>{for(const node of nodes.filter(included)){rows.push({node,depth});if(node.kind==='folder'&&expanded.has(node.path))visit(node.children||[],depth+1);}};visit(tree);
  const toggle=(node:FileNode)=>{const opened=expanded.has(node.path);setExpanded(previous=>{const next=new Set(previous);if(opened)next.delete(node.path);else next.add(node.path);return next;});chooseFolder(opened?folderOf(node.path):node.path);};
  return <div className='mobile-file-list mobile-file-tree' role='tree' aria-label='文档目录' aria-multiselectable={selecting}>{rows.map(({node,depth})=><div className={'mobile-file-row'+(folder===node.path?' selected-folder':'')+(selecting&&selected.has(node.path)?' selected-file':'')} key={node.path} data-path={node.path} role='treeitem' aria-level={depth+1} aria-expanded={node.kind==='folder'?expanded.has(node.path):undefined} aria-selected={selecting?selected.has(node.path):node.path===(node.kind==='folder'?folder:active)} style={{paddingLeft:8+Math.min(depth,6)*16}}>
    <button className='mobile-file-open' onClick={()=>{cancel();if(press.current.suppress===node.path){press.current.suppress='';return;}selecting?select(node.path):node.kind==='folder'?toggle(node):open(node.path);}} title={node.path}
      onPointerDown={event=>{if(event.pointerType==='mouse'&&event.button!==0)return;cancel();press.current={timer:0,x:event.clientX,y:event.clientY,suppress:''};if(!selecting)press.current.timer=window.setTimeout(()=>{press.current.suppress=node.path;startSelection(node.path);},450);}}
      onPointerMove={event=>{if(Math.hypot(event.clientX-press.current.x,event.clientY-press.current.y)>10)cancel();}} onPointerUp={cancel} onPointerCancel={cancel}
      onContextMenu={event=>{event.preventDefault();cancel();press.current.suppress=node.path;startSelection(node.path);}}>
      <span className='mobile-tree-chevron'>{node.kind==='folder'?(expanded.has(node.path)?<ChevronDown size={16}/>:<ChevronRight size={16}/>):null}</span>
      <span className={'mobile-file-icon '+node.kind}>{selecting?(selected.has(node.path)?<CheckCircle2 size={21}/>:<Circle size={21}/>):node.kind==='folder'?(expanded.has(node.path)?<FolderOpen size={21}/>:<Folder size={21}/>):<FileIcon path={node.path}/>}</span>
      <span className='mobile-file-details'><strong>{node.kind==='folder'?node.name:displayName(node.path)}</strong><small>{[node.kind==='folder'?`${node.children?.filter(included).length||0} 项`:node.name.split('.').pop()?.toUpperCase(),node.updated?new Date(node.updated).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):''].filter(Boolean).join(' · ')}</small></span>
      <FileCloudBadge state={states[node.path]}/>
    </button>{selecting?node.kind==='folder'&&<button aria-label={(expanded.has(node.path)?'收起 ':'展开 ')+node.name} onClick={()=>toggle(node)}>{expanded.has(node.path)?<ChevronDown size={20}/>:<ChevronRight size={20}/>}</button>:<button aria-label={'操作 '+node.name} onClick={()=>more(node)}><MoreHorizontal size={20}/></button>}
  </div>)}</div>;
}
