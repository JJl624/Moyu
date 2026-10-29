import {useEffect,useRef,useState} from 'react';
import {X,Code2,Music2} from 'lucide-react';
import {scoreText} from '../shared/attachment-previews.mjs';
import {mountScoreControls} from './attachments/scoreControls';
import TextFileEditor from './TextFileEditor';
import type {EditorProps,EditorHandle} from './editorTypes';
import type {RefObject} from 'react';
import './attachments/previews.css';
type Props=EditorProps&{editor:RefObject<EditorHandle|null>;onClose():void;revision:string};
export default function ScoreFileViewer({editor,onClose,revision,...props}:Props) {
  const [source,setSource]=useState(false),[error,setError]=useState(''),host=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(source)return;const abort=new AbortController();setError('');
    void mountScoreControls(host.current!,props.path,abort.signal,{source:scoreText(props.path)?props.value:undefined})
      .then(result=>result?.ready).catch(error=>{if(!abort.signal.aborted)setError(String(error.message||error));});
    return ()=>abort.abort();
  },[props.path,props.value,source,revision]);
  return <section className="score-file-viewer file-viewer" aria-label="乐谱编辑器">
    <header className="file-viewer-toolbar"><button className="icon-button" aria-label="关闭当前文档" title="关闭当前文档" onClick={onClose}><X size={16}/></button><strong>{props.path}</strong><span className="drawing-toolbar-spacer"/>
      {scoreText(props.path)&&<><button className={!source?'active':''} onClick={()=>setSource(false)}><Music2 size={14}/>预览</button><button className={source?'active':''} onClick={()=>setSource(true)}><Code2 size={14}/>源码</button></>}
    </header>
    {source?<div className="score-source"><TextFileEditor {...props} ref={editor}/></div>:<div className="score-page">{error&&<p role="alert">{error}</p>}<div className="score-sheet" ref={host}/></div>}
  </section>;
}
