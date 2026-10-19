import { X } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, TextLayer } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';
import './pdfTextLayer.css';
import { assetURL } from './bridge';
import { NumberField } from './NumberField';
GlobalWorkerOptions.workerSrc = workerUrl;
export default function PdfViewer({ path, onClose }: { path: string; onClose?: () => void }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [page, setPage] = useState(1),
    [zoom, setZoom] = useState(1),
    [error, setError] = useState(''),
    [password, setPassword] = useState(''),
    [locked, setLocked] = useState(false),
    [busy, setBusy] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null),
    layer = useRef<HTMLDivElement>(null),
    passwordCallback = useRef<((value: string) => void) | null>(null);
  useEffect(() => {
    let alive = true;
    const base = new URL('pdfjs/', document.baseURI).href;
    const task = getDocument({
      url: assetURL('', path.split('/').map(encodeURIComponent).join('/')),
      cMapUrl: base + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: base + 'standard_fonts/',
      wasmUrl: base + 'wasm/',
    });
    task.onPassword = (callback: (password: string) => void) => {
      if (alive) {
        passwordCallback.current = callback;
        setLocked(true);
        setBusy(false);
      }
    };
    task.promise.then(doc => {
      if (alive) {
        setPdf(doc);
        setLocked(false);
      }
    }).catch(e => {
      if (alive) {
        setError(String(e.message));
        setBusy(false);
      }
    });
    return () => {
      alive = false;
      passwordCallback.current = null;
      void task.destroy();
    };
  }, [path]);
  useEffect(() => {
    if (!pdf || !canvas.current || !layer.current) return;
    let alive = true,
      render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined,
      text: TextLayer | undefined;
    setBusy(true);
    setError('');
    const target = canvas.current, textTarget = layer.current;
    textTarget.replaceChildren();
    void pdf.getPage(page).then(async p => {
      if (!alive) return;
      const viewport = p.getViewport({ scale: zoom }),
        ratio = Math.min(2, window.devicePixelRatio || 1),
        // Bound canvas allocation even for oversized PDF page dimensions.
        scale = Math.min(ratio, Math.sqrt(16_000_000 / (viewport.width * viewport.height)));
      target.width = Math.max(1, Math.floor(viewport.width * scale));
      target.height = Math.max(1, Math.floor(viewport.height * scale));
      target.style.width = viewport.width + 'px';
      target.style.height = viewport.height + 'px';
      textTarget.style.setProperty('--scale-factor', String(zoom));
      textTarget.style.setProperty('--total-scale-factor', 'calc(var(--scale-factor) * var(--user-unit, 1))');
      textTarget.style.width = viewport.width + 'px';
      textTarget.style.height = viewport.height + 'px';
      render = p.render({ canvas: target, viewport, transform: [scale, 0, 0, scale, 0, 0] });
      await render.promise;
      if (!alive) return;
      text = new TextLayer({ textContentSource: p.streamTextContent(), container: textTarget, viewport });
      await text.render();
      if (alive) {
        p.cleanup();
        setBusy(false);
      }
    }).catch(e => {
      if (alive && e.name !== 'RenderingCancelledException') {
        setError(String(e.message));
        setBusy(false);
      }
    });
    return () => {
      alive = false;
      render?.cancel();
      text?.cancel();
    };
  }, [pdf, page, zoom]);
  return (
    <section className='pdf-viewer file-viewer' aria-label='PDF 阅读器'>
      <header className='file-viewer-toolbar'>
        <button className='icon-button' title='关闭当前文档' aria-label='关闭当前文档' onClick={onClose}><X size={16}/></button>
        <strong>{path}</strong>
        <span className='drawing-toolbar-spacer' />
        <button aria-label='PDF 上一页' disabled={!pdf || page <= 1} onClick={() => setPage(page - 1)}>
          ‹
        </button>
        <NumberField
          label='PDF 页码'
          min={1}
          max={pdf?.numPages || 1}
          value={page}
          change={n => { if (pdf) setPage(Math.round(n)); }}
        />
        <span>/ {pdf?.numPages || '—'}</span>
        <button
          aria-label='PDF 下一页'
          disabled={!pdf || page >= pdf.numPages}
          onClick={() => setPage(page + 1)}
        >
          ›
        </button>
        <button aria-label='缩小 PDF' onClick={() => setZoom(Math.max(.25, zoom / 1.25))}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button aria-label='放大 PDF' onClick={() => setZoom(Math.min(3, zoom * 1.25))}>+</button>
      </header>
      {error && <p role='alert'>{error}</p>}
      {locked && (
        <form
          className='pdf-password'
          onSubmit={e => {
            e.preventDefault();
            passwordCallback.current?.(password);
            setBusy(true);
          }}
        >
          <input
            aria-label='PDF 密码'
            type='password'
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <button>打开</button>
        </form>
      )}
      <div className='pdf-pages' aria-busy={busy}>
        <div className='pdf-page' style={{ visibility: busy || !!error || locked ? 'hidden' : 'visible' }}>
          <canvas ref={canvas} />
          <div className='textLayer' ref={layer} />
        </div>
      </div>
    </section>
  );
}
