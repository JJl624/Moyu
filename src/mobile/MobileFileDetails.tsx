import {FileIcon} from '../FileIcon';
import {Folder} from 'lucide-react';
import {fileKind} from '../fileKinds';
import type {FileNode} from '../types';
import {cloudLabels,type CloudState} from './useMobileCloud';
import {useEffect,useState} from 'react';
import {mobileFeature} from './native';

const kinds:Record<string,string>={markdown:'Markdown 文档',text:'文本文件',image:'图片',pdf:'PDF 文档',html:'HTML 文档',drawing:'Excalidraw 绘图',sqlite:'SQLite 数据库'};
export function MobileFileDetails({file,vault,root,state,configured}:{file:FileNode;vault:string;root:string;state?:CloudState;configured:boolean}){
  const [location,setLocation]=useState(''),[history,setHistory]=useState<{id:string;time:number}[]|null>(null);
  useEffect(()=>{let live=true;setLocation('');setHistory(null);void mobileFeature<string>('mobile.file-location',{root,path:file.path}).then(value=>{if(live)setLocation(value);}).catch(()=>{});if(file.kind!=='folder')void mobileFeature<{entries:{id:string;time:number}[]}>('file.history-list',{document:file.path}).then(value=>{if(live)setHistory(value.entries);}).catch(()=>{});return()=>{live=false;};},[root,file.path,file.kind]);
  let bytes=file.size,files=0,folders=0;
  if(file.kind==='folder'){bytes=0;const visit=(nodes:FileNode[])=>{for(const node of nodes)if(node.kind==='folder'){folders++;visit(node.children||[]);}else{files++;bytes=(bytes||0)+(node.size||0);}};visit(file.children||[]);}
  const extension=file.name.includes('.')?file.name.split('.').pop()?.toUpperCase():'';
  return <div className='mobile-file-info'><div className='mobile-file-info-name'>{file.kind==='folder'?<Folder size={24}/>:<FileIcon path={file.path}/>}<strong>{file.name}</strong></div><dl>
    <dt>知识库</dt><dd>{vault}</dd><dt>{location.startsWith('content:')?'文档 URI':location?'完整路径':'知识库内路径'}</dt><dd>{location||file.path}</dd>
    <dt>类型</dt><dd>{file.kind==='folder'?'文件夹':kinds[fileKind(file.path)]||(extension?extension+' 文件':'文件')}</dd>
    <dt>大小</dt><dd>{bytes===undefined?'未提供':bytes.toLocaleString('zh-CN')+' 字节'}</dd>
    {file.kind==='folder'&&<><dt>包含</dt><dd>{files} 个文件，{folders} 个文件夹</dd></>}
    <dt>修改时间</dt><dd>{file.updated?new Date(file.updated).toLocaleString('zh-CN'):'未提供'}</dd>
    {!!file.created&&<><dt>创建时间</dt><dd>{new Date(file.created).toLocaleString('zh-CN')}</dd></>}
    <dt>同步状态</dt><dd>{state?cloudLabels[state]:configured?'尚未检查':'未配置同步'}</dd>
    {history&&<><dt>历史版本</dt><dd>{history.length} 个版本</dd>{history.length>0&&<><dt>最近版本</dt><dd>{new Date(Math.max(...history.map(item=>item.time))).toLocaleString('zh-CN')}</dd></>}</>}
  </dl></div>;
}
