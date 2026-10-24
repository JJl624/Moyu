import {useState} from 'react';
import {ChevronDown,ChevronRight,FileText,Folder} from 'lucide-react';
import type {CloudEntry} from './syncState';
export function MobileCloudTree({entries}:{entries:CloudEntry[]}){
  const [expanded,setExpanded]=useState(new Set<string>()),known=new Map(entries.map(entry=>[entry.path,entry]));
  for(const entry of entries){const parts=entry.path.split('/');parts.pop();for(let index=1;index<=parts.length;index++){const path=parts.slice(0,index).join('/');if(!known.has(path))known.set(path,{path,type:'folder',etag:'',size:0,modified:''});}}
  const sorted=[...known.values()].sort((a,b)=>{const left=a.path.split('/'),right=b.path.split('/');let index=0;while(left[index]===right[index]&&index<Math.min(left.length,right.length))index++;if(index===left.length)return -1;if(index===right.length)return 1;const aFolder=index<left.length-1||a.type==='folder',bFolder=index<right.length-1||b.type==='folder';return aFolder!==bFolder?(aFolder?-1:1):left[index].localeCompare(right[index],'zh-CN',{numeric:true});});
  return <div className='mobile-cloud-list' role='tree' aria-label='云端目录'>{sorted.filter(entry=>entry.path.split('/').slice(0,-1).every((_,index,parts)=>expanded.has(parts.slice(0,index+1).join('/')))).map(entry=>{
    const parts=entry.path.split('/'),folder=entry.type==='folder',time=Date.parse(entry.modified),content=<><span className='mobile-tree-chevron'>{folder?(expanded.has(entry.path)?<ChevronDown size={16}/>:<ChevronRight size={16}/>):null}</span>{folder?<Folder size={19}/>:<FileText size={19}/>}<span><strong>{parts.at(-1)}</strong><small>{[entry.excluded,folder?'文件夹':entry.size<1024?entry.size+' B':Math.ceil(entry.size/1024)+' KB',Number.isFinite(time)?new Date(time).toLocaleString('zh-CN'):''].filter(Boolean).join(' · ')}</small></span></>;
    return <div className='mobile-cloud-tree-row' data-path={entry.path} key={entry.path} title={entry.path} role='treeitem' aria-level={parts.length} aria-expanded={folder?expanded.has(entry.path):undefined} style={{paddingLeft:Math.min(parts.length-1,6)*16}}>{folder?<button onClick={()=>setExpanded(previous=>{const next=new Set(previous);if(next.has(entry.path))next.delete(entry.path);else next.add(entry.path);return next;})}>{content}</button>:<div>{content}</div>}</div>;
  })}</div>;
}
