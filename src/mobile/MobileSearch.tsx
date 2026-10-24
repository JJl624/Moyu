import {useRef} from 'react';
import {Search,X} from 'lucide-react';
import {displayName,folderOf,type SearchResult} from '../types';

export function MobileSearchInput({value,change}:{value:string;change(value:string):void}){
  const input=useRef<HTMLInputElement>(null);
  return <form className='mobile-search-field' role='search' aria-label='知识库搜索' onSubmit={event=>{event.preventDefault();input.current?.blur();}}>
    <Search size={18}/><input ref={input} aria-label='搜索笔记' type='search' enterKeyHint='search' autoCapitalize='none' autoCorrect='off' placeholder='搜索标题和正文' value={value} onChange={event=>change(event.target.value)}/>
    {value&&<button type='button' aria-label='清空搜索' onPointerDown={event=>event.preventDefault()} onClick={()=>change('')}><X size={18}/></button>}
  </form>;
}

export function MobileSearchResults({results,searching,open}:{results:SearchResult[];searching:boolean;open(path:string,line?:number):void}){
  return <div className='mobile-search-results' aria-live='polite' aria-busy={searching}>{searching?<p className='mobile-caption'>正在搜索…</p>:!results.length?<div className='mobile-empty'><p>没有找到相关笔记</p></div>:results.map(result=><article key={result.path}>
    <button onClick={()=>open(result.path,result.matches[0]?.line)}><strong>{displayName(result.path)}</strong><small>{folderOf(result.path)||'根目录'}</small></button>
    {result.matches.slice(0,3).map(match=><button className='mobile-search-match' key={match.line} onClick={()=>open(result.path,match.line)}><small>{match.line}</small><span>{match.text}</span></button>)}
  </article>)}</div>;
}
