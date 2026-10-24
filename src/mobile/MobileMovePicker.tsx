import {useState} from 'react';
import {ArrowLeft,ChevronRight,Folder} from 'lucide-react';
import {folderOf,type FileNode} from '../types';

export function MobileMovePicker({tree,file,files=[file],busy,move,showHidden=false}:{tree:FileNode[];file:FileNode;files?:FileNode[];busy:boolean;move(folder:string):void;showHidden?:boolean}){
  const [folder,setFolder]=useState(folderOf(file.path));let nodes=tree;
  for(const part of folder.split('/').filter(Boolean))nodes=nodes.find(node=>node.name===part)?.children||[];
  const children=nodes.filter(node=>node.kind==='folder'&&(showHidden||!node.system&&!node.companionFor&&!node.name.endsWith('.assets')&&node.name!=='code-data')&&!files.some(file=>node.path===file.path||node.path.startsWith(file.path+'/')));
  return <div className='mobile-move-picker'>
    <p className='mobile-caption'>{files.length===1?'将“'+file.name+'”移到':'将所选 '+files.length+' 项移到'}</p>
    <div className='mobile-move-location'>{folder&&<button aria-label='上一级文件夹' disabled={busy} onClick={()=>setFolder(folderOf(folder))}><ArrowLeft size={20}/></button>}<strong>{folder||'知识库根目录'}</strong></div>
    <div className='mobile-actions'>{children.map(child=><button disabled={busy} key={child.path} onClick={()=>setFolder(child.path)}><Folder size={21}/><span>{child.name}</span><ChevronRight size={18}/></button>)}</div>
    {!children.length&&<p className='mobile-caption'>没有子文件夹</p>}
    <button className='mobile-primary mobile-full' disabled={busy||files.every(file=>folder===folderOf(file.path))} onClick={()=>move(folder)}>{busy?'正在移动…':'移到这里'}</button>
  </div>;
}
