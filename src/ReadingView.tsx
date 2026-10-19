import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { applyAttachmentSize } from './attachmentLayout';
import { renderMarkdown } from './markdownRender';
import { drawingSvg,resourceImageURL } from './resourcePreview';
import { bindReadingCodeTabs } from './tabbedCodePreview';
import 'katex/dist/katex.min.css';
function sizeDrawing(svg: SVGSVGElement, alt: string) {
  applyAttachmentSize(
    svg,
    alt,
    Number((svg.getAttribute('viewBox') || '').split(/[ ,]+/)[2]) || 400,
  );
}
export default function ReadingView(
  { value, path, scrollTop = 0 }: { value: string; path: string; scrollTop?: number },
) {
  const [rendered, setRendered] = useState<HTMLElement | null>(null);
  const element = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!rendered || !element.current) return;
    const fragment = document.createDocumentFragment();
    while (rendered.firstChild) fragment.append(rendered.firstChild);
    element.current.replaceChildren(fragment);
  }, [rendered]);
  useEffect(() => element.current ? bindReadingCodeTabs(element.current) : undefined, [rendered]);
  useLayoutEffect(() => {
    if (!rendered || !element.current) return;
    const root = element.current, scroll = root.closest('.document-scroll');
    // Images and toolbar space are resolved by renderMarkdown. Restore once
    // before paint rather than competing with subsequent scroll operations.
    if (scroll) scroll.scrollTop = scrollTop;
    delete root.dataset.editorPending;
  }, [rendered, scrollTop]);
  useEffect(() => {
    let alive = true;
    const revisions = new WeakMap<HTMLElement, number>();
    const refresh = (event: Event) => {
      const paths = (event as CustomEvent<string[]>).detail;
      for(const image of element.current?.querySelectorAll<HTMLImageElement>('img[data-resource-link]')||[]){
        if(paths.includes(image.dataset.resourcePath||''))image.src=resourceImageURL(path,image.dataset.resourceLink||'');
      }
      for (
        const resource of element.current?.querySelectorAll<HTMLElement>('.resource-preview') || []
      ) {
        if (paths.includes(resource.dataset.resourcePath || '')) {
          const revision = (revisions.get(resource) || 0) + 1;
          revisions.set(resource, revision);
          void drawingSvg(resource.dataset.resourcePath!).then(svg => {
            if (
              alive && revisions.get(resource) === revision && element.current?.contains(resource)
            ) {
              sizeDrawing(svg, resource.dataset.resourceAlt || '');
              resource.replaceChildren(svg);
            }
          }).catch(() => {
            if (
              alive && revisions.get(resource) === revision && element.current?.contains(resource)
            ) resource.textContent = resource.dataset.resourceLabel || '绘图文件不可用';
          });
        }
      }
    };
    const themeChanged = () =>
      refresh(
        new CustomEvent('moyu-resources-changed', {
          detail: [...element.current?.querySelectorAll<HTMLElement>('.resource-preview') || []]
            .map(resource => resource.dataset.resourcePath),
        }),
      );
    window.addEventListener('moyu-resources-changed', refresh);
    window.addEventListener('moyu-diagram-theme', themeChanged);
    return () => {
      alive = false;
      window.removeEventListener('moyu-resources-changed', refresh);
      window.removeEventListener('moyu-diagram-theme', themeChanged);
    };
  }, [path]);
  useEffect(() => {
    const images = [
      ...element.current?.querySelectorAll<HTMLImageElement>('img[data-resource-alt]') || [],
    ];
    const loaded = (event: Event) => {
      const image = event.currentTarget as HTMLImageElement;
      applyAttachmentSize(image, image.dataset.resourceAlt || '', image.naturalWidth);
    };
    for (const image of images) {
      applyAttachmentSize(image, image.dataset.resourceAlt || '', image.naturalWidth);
      image.addEventListener('load', loaded);
    }
    return () => {
      for (const image of images) image.removeEventListener('load', loaded);
    };
  }, [rendered]);
  useEffect(() => {
    let alive = true;
    void renderMarkdown(value, path, { interactiveTabs: true, sourceLocations: true }).then(root => {
      if (alive) setRendered(root);
    }).catch(error => {
      if (alive) setRendered(document.createElement('div'));
      console.error('Markdown 阅读渲染失败', error);
    });
    return () => {
      alive = false;
    };
  }, [value, path]);
  return (
    <article
      ref={element}
      className='reading-view'
      data-editor-pending='true'
      aria-label='Markdown 阅读模式'
    />
  );
}
