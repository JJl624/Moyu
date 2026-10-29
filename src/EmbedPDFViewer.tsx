import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {assetURL} from './bridge';
import {mountPdfViewer} from './attachments/pdfAdapter';
import './attachments/previews.css';
export default function EmbedPDFViewer({path,onClose}:{path:string;onClose?:()=>void}) {
  const host=useRef<HTMLDivElement>(null),[error,setError]=useState('');
  useEffect(()=>{const abort=new AbortController();setError('');
    void mountPdfViewer(host.current!,assetURL('',path.split('/').map(encodeURIComponent).join('/')),abort.signal,{path})
      .catch(error=>{if(!abort.signal.aborted)setError(String(error.message||error));});
    return ()=>abort.abort();
  },[path]);
  return <section className="pdf-viewer file-viewer" aria-label="PDF 阅读器">
    <header className="file-viewer-toolbar"><button className="icon-button" title="关闭当前文档" aria-label="关闭当前文档" onClick={onClose}><X size={16}/></button><strong>{path}</strong></header>
    {error&&<p role="alert">{error}</p>}<div className="embedpdf-host" ref={host}/>
  </section>;
}
