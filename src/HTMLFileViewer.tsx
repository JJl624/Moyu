import {Code2,RotateCw,X,BookOpen} from 'lucide-react';
import {useEffect,useRef,useState,type RefObject} from 'react';
import {api} from './bridge';
import TextFileEditor from './TextFileEditor';
import type {EditorHandle,EditorProps,EditorSelection} from './editorTypes';
import './htmlFileViewer.css';
export default function HTMLFileViewer(props:EditorProps&{editor:RefObject<EditorHandle|null>;onClose():void}){
  const key=(props.root||'')+'/'+props.path;
  const [mode,setMode]=useState<'read'|'source'>('source'),[revision,setRevision]=useState(0),[url,setURL]=useState(''),[error,setError]=useState('');
  const selection=useRef<EditorSelection|null>(props.selection||null);
  useEffect(()=>{
    if(mode!=='read')return;
    let alive=true,token='';setURL('');setError('');
    void api.feature<{token:string;url:string}>('file.html-open',{path:props.path,content:props.value}).then(view=>{token=view.token;if(alive)setURL(view.url);else void api.feature('file.html-close',{token});}).catch(e=>{if(alive)setError(e.message);});
    return()=>{alive=false;if(token)void api.feature('file.html-close',{token}).catch(()=>{});};
  },[key,mode,revision,props.value]);
  const switchMode=(next:'read'|'source')=>{
    if(mode===next)return;
    if(mode==='source')selection.current=props.editor.current?.captureSelection?.()||null;
    setMode(next);
  };
  return <div className='html-file-viewer'>
    <div className='document-toolbar'><div className='breadcrumbs'><button className='icon-button' title='关闭当前文档' onClick={props.onClose}><X size={16}/></button><strong>{props.path.split('/').pop()}</strong></div>
      <div className='html-file-modes'>{mode==='read'&&<button className='icon-button' title='刷新 HTML' onClick={()=>setRevision(v=>v+1)}><RotateCw size={14}/></button>}<button className={mode==='read'?'selected':''} onClick={()=>switchMode('read')}><BookOpen size={14}/>阅读</button><button className={mode==='source'?'selected':''} onClick={()=>switchMode('source')}><Code2 size={14}/>源码</button></div>
    </div>
    {mode==='source'?<TextFileEditor {...props} ref={props.editor} selection={selection.current}/>:error?<p role='alert'>{error}</p>:url?<iframe title='HTML 文件' src={url} sandbox='allow-scripts' referrerPolicy='no-referrer' allow="autoplay; camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'; display-capture 'none'; local-fonts 'none'"/>:<p>正在打开文件…</p>}
  </div>;
}
