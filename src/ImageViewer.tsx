import { X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { assetURL } from './bridge';
import { fileKind } from './fileKinds';
export const isImage = (path: string) => fileKind(path) === 'image';
export default function ImageViewer({ path, onClose }: { path: string; onClose?: () => void }) {
  const [scale, setScale] = useState(1),
    [error, setError] = useState(false),
    [dimensions, setDimensions] = useState({ width: 0, height: 0 }),
    [viewport, setViewport] = useState({ width: 0, height: 0 });
  const scroller = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    setScale(1);
    setError(false);
    const image = scroller.current?.querySelector('img');
    setDimensions({ width: image?.naturalWidth || 0, height: image?.naturalHeight || 0 });
  }, [path]);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const update = () => {
      const width = Math.max(1, element.clientWidth - 40),
        height = Math.max(1, element.clientHeight - 40);
      setViewport(old => old.width === width && old.height === height ? old : { width, height });
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, []);
  const fit = dimensions.width && dimensions.height
    ? Math.min(1, viewport.width / dimensions.width, viewport.height / dimensions.height)
    : 1;
  const zoom = (next: number) => setScale(Math.max(.1, Math.min(8, next)));
  return (
    <section className='image-viewer' aria-label='图片查看器'>
      <header>
        <button className='icon-button' title='关闭当前文档' aria-label='关闭当前文档' onClick={onClose}><X size={16}/></button>
        <strong>{path}</strong>
        <small>{dimensions.width ? `${dimensions.width} × ${dimensions.height}` : ''}</small>
        <span className='drawing-toolbar-spacer' />
        <button aria-label='缩小图片' onClick={() => zoom(scale / 1.25)}>−</button>
        <span>{Math.round(scale * 100)}%</span>
        <button aria-label='放大图片' onClick={() => zoom(scale * 1.25)}>+</button>
        <button onClick={() => setScale(1)}>适应窗口</button>
      </header>
      <div
        className='image-canvas'
        ref={scroller}
        onWheel={e => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            zoom(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
          }
        }}
        onPointerDown={e => {
          if (e.button !== 0 || !scroller.current) return;
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            left: scroller.current.scrollLeft,
            top: scroller.current.scrollTop,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={e => {
          const d = drag.current, s = scroller.current;
          if (d && s) {
            s.scrollLeft = d.left + d.x - e.clientX;
            s.scrollTop = d.top + d.y - e.clientY;
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        {error
          ? <p role='alert'>图片无法读取。</p>
          : (
            <img
              key={path}
              src={assetURL('', path.split('/').map(encodeURIComponent).join('/'))}
              alt={path.split('/').pop()}
              draggable={false}
              style={{
                width: dimensions.width ? dimensions.width * fit * scale : undefined,
                height: dimensions.height ? dimensions.height * fit * scale : undefined,
                maxWidth: 'none',
                maxHeight: 'none',
              }}
              onLoad={e => {
                const width = e.currentTarget.naturalWidth, height = e.currentTarget.naturalHeight;
                setDimensions(old =>
                  old.width === width && old.height === height ? old : { width, height }
                );
              }}
              onError={() => setError(true)}
            />
          )}
      </div>
    </section>
  );
}
