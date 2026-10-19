import { ChevronDown, ChevronRight, File, Folder, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CloudEntry, CloudSnapshot } from './webdavTypes';
function CloudTime({entry}:{entry:CloudEntry}) {
  const stamp=entry.modified ?? entry.created;
  if(stamp===undefined)return null;
  const label=entry.modified!==undefined ? '云端修改时间' : '云端创建时间';
  return <time dateTime={new Date(stamp).toISOString()} aria-label={label}>{new Date(stamp).toLocaleString()}</time>;
}
export function fileSize(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
const parent = (name:string) => name.includes('/') ? name.slice(0,name.lastIndexOf('/')) : '';
export function WebDAVCloud({snapshot, busy, refresh}:{snapshot?:CloudSnapshot|null;busy:boolean;refresh():void}) {
  const [opened,setOpened] = useState(new Set<string>()), [query,setQuery] = useState(''), [limit,setLimit] = useState(150);
  const groups = useMemo(() => {
    const map = new Map<string,CloudEntry[]>();
    for (const entry of snapshot?.entries || []) {
      const key = parent(entry.path), group = map.get(key) || [];
      group.push(entry); map.set(key,group);
    }
    for (const group of map.values()) group.sort((a,b)=>a.path.localeCompare(b.path,'zh-CN',{numeric:true}));
    return map;
  },[snapshot]);
  const rows = useMemo(() => {
    const result:{entry:CloudEntry;depth:number}[] = [];
    const matching = new Set<string>();
    if (query) for (const entry of snapshot?.entries || []) if (entry.path.toLowerCase().includes(query.toLowerCase())) {
      matching.add(entry.path); let key=parent(entry.path);while(key){matching.add(key);key=parent(key);}
    }
    const visit=(key:string,depth:number) => {
      for(const entry of groups.get(key) || []) {
        if(query && !matching.has(entry.path))continue;
        result.push({entry,depth});
        if(entry.type==='folder' && (query || opened.has(entry.path)))visit(entry.path,depth+1);
      }
    };
    visit('',0);return result;
  },[groups,query,opened]);
  return <section className='dav-cloud' aria-label='云端目录'>
    <div className='dav-cloud-heading'><strong title={snapshot?.root}>{snapshot?.root || '云端目录'}</strong>
      <button className='icon-button' aria-label='刷新云端目录' title='刷新云端目录' disabled={busy} onClick={refresh}><RefreshCw size={14}/></button></div>
    {snapshot ? <><small className='muted-note'>扫描于 {new Date(snapshot.scannedAt).toLocaleString()}</small>
      <input className='dav-filter' aria-label='筛选云端文件' placeholder='筛选文件…' value={query} onChange={e=>{setQuery(e.target.value);setLimit(150);}}/>
      <div className='dav-cloud-tree' role='tree'>
        {rows.slice(0,limit).map(({entry,depth}) => <button key={entry.path} role='treeitem' aria-expanded={entry.type==='folder' ? opened.has(entry.path) : undefined}
          className={'dav-cloud-row'+(entry.excluded ? ' excluded' : '')} style={{paddingLeft:depth*14+4}}
          title={[entry.path,entry.modified ? '云端修改时间：'+new Date(entry.modified).toLocaleString() : '',entry.created ? '云端创建时间：'+new Date(entry.created).toLocaleString() : '',entry.excluded || ''].filter(Boolean).join('\n')}
          onClick={()=>{if(entry.type==='folder')setOpened(value=>{const next=new Set(value);next.has(entry.path)?next.delete(entry.path):next.add(entry.path);return next;});}}>
          {entry.type==='folder' ? <>{opened.has(entry.path)?<ChevronDown size={12}/>:<ChevronRight size={12}/>}<Folder size={14}/></> : <><span className='dav-tree-spacer'/><File size={14}/></>}
          <span className='dav-cloud-name'>{entry.path.slice(entry.path.lastIndexOf('/')+1)}
            {entry.type==='file' && <CloudTime entry={entry}/>}
          </span><small>{entry.type==='file' ? fileSize(entry.size) : ''}</small>
        </button>)}
      </div>
      {!rows.length && <p className='muted-note'>{query ? '没有匹配文件' : '目录为空'}</p>}
      {rows.length>limit && <button className='text-button' onClick={()=>setLimit(n=>n+150)}>显示更多</button>}
    </> : <p className='muted-note'>同步或刷新后显示云端目录。</p>}
  </section>;
}
