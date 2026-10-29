import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { applyAttachmentSize } from './attachmentLayout';
import { renderMarkdown } from './markdownRender';
import { resourceImageURL } from './resourcePreview';
import { bindReadingCodeTabs } from './tabbedCodePreview';
import {patchHTMLPreviewMetadata} from './htmlPreviewMetadata';
import {previewKind,mountAttachmentPreview,disposePreviews} from './attachments/previewRegistry';
import 'katex/dist/katex.min.css';
export default function ReadingView(
  { value, path, scrollTop = 0 }: { value: string; path: string; scrollTop?: number },
) {
  const [rendered, setRendered] = useState<HTMLElement | null>(null);
  const element = useRef<HTMLElement>(null);
  const installed = useRef<HTMLElement|null>(null);
  const renderedSource=useRef<{value:string;path:string}|null>(null);
  useEffect(()=>{const root=element.current;return()=>{if(root)disposePreviews(root);};},[]);
  useLayoutEffect(() => {
    if (!rendered || !element.current || installed.current===rendered) return;
    installed.current=rendered;
    disposePreviews(element.current);
    const fragment = document.createDocumentFragment();
    while (rendered.firstChild) fragment.append(rendered.firstChild);
    element.current.replaceChildren(fragment);
  }, [rendered]);
  useEffect(() => {const root=element.current;const unbind=root?bindReadingCodeTabs(root):undefined;return ()=>{unbind?.();};}, [rendered]);
  useLayoutEffect(() => {
    if (!rendered || !element.current) return;
    const root = element.current, scroll = root.closest('.document-scroll');
    // Images and toolbar space are resolved by renderMarkdown. Restore once
    // before paint rather than competing with subsequent scroll operations.
    if (scroll) scroll.scrollTop = scrollTop;
    delete root.dataset.editorPending;
  }, [rendered, scrollTop]);
  useEffect(() => {
    const refresh = (event: Event) => {
      const paths = (event as CustomEvent<string[]>).detail;
      for(const image of element.current?.querySelectorAll<HTMLImageElement>('img[data-resource-link]')||[]){
        if(paths.includes(image.dataset.resourcePath||''))image.src=resourceImageURL(path,image.dataset.resourceLink||'');
      }
      for (
        const resource of element.current?.querySelectorAll<HTMLElement>('.resource-preview') || []
      ) {
        if (paths.includes(resource.dataset.resourcePath || '')) {
          const kind=previewKind(resource.dataset.resourceLink||'',resource.dataset.resourceImage==='true',true);
          if(kind)void mountAttachmentPreview(resource,kind,path,resource.dataset.resourceLink||'',resource.dataset.resourceAlt||'');
        }
      }
    };
    const themeChanged = () =>
      refresh(
        new CustomEvent('moyu-resources-changed', {
          detail: [...element.current?.querySelectorAll<HTMLElement>('.resource-preview[data-preview-kind=drawing]') || []]
            .map(resource => resource.dataset.resourcePath),
        }),
      );
    window.addEventListener('moyu-resources-changed', refresh);
    window.addEventListener('moyu-diagram-theme', themeChanged);
    return () => {
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
    const previous=renderedSource.current;
    if(element.current&&previous?.path===path&&!element.current.hasAttribute('data-editor-pending')&&patchHTMLPreviewMetadata(element.current,previous.value,value)){
      renderedSource.current={value,path};return;
    }
    void renderMarkdown(value, path, { interactiveTabs: true, sourceLocations: true, attachmentPreviews:true }).then(root => {
      if (alive) {renderedSource.current={value,path};setRendered(root);}else disposePreviews(root);
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
