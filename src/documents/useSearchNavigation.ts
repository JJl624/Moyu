import { useEffect, useState, type RefObject } from 'react';
import type { EditorHandle } from '../editorTypes';
import { revealReadingLocation } from './readingLocation';
import {resourcePath} from '../resourcePreview';

type Jump = { root: string; path: string; offset: number; source: string; attachment?:string };

// A search can open a lazy editor. Consume the location only after its initial
// selection/scroll restoration has finished, and observe only while waiting.
export function useSearchNavigation(root: string, path: string, mode: string, editor: RefObject<EditorHandle | null>) {
  const [jump, setJump] = useState<Jump | null>(null);
  useEffect(() => {
    if (!jump || jump.root !== root || jump.path !== path) return;
    const scope = document.querySelector('.document-scroll');
    if (!scope) return;
    let consumed = false;
    const reveal = () => {
      if (consumed) return;
      if (mode === 'read') {
        const reading = scope.querySelector('.reading-view');
        if (!reading || reading.hasAttribute('data-editor-pending')) return;
        if(jump.attachment){
          const target=[...reading.querySelectorAll<HTMLElement>('[data-resource-link],a[href],img[src]')].find(el=>resourcePath(path,el.dataset.resourceLink||el.getAttribute('href')||el.getAttribute('src')||'')===jump.attachment);
          if(target){
            for(const old of reading.querySelectorAll('.preview-selected'))old.classList.remove('preview-selected');
            const card=target.closest<HTMLElement>('.attachment-card');card?.classList.add('preview-selected');
            (card||target).scrollIntoView({block:'center'});target.tabIndex=-1;target.focus({preventScroll:true});
          }
          consumed=true;setJump(null);return;
        }
        const blocks = [...reading.querySelectorAll<HTMLElement>('[data-source-from]')];
        const distance = (node: HTMLElement) => {
          const from = Number(node.dataset.sourceFrom), to = Number(node.dataset.sourceTo);
          return jump.offset < from ? from - jump.offset : jump.offset > to ? jump.offset - to : 0;
        };
        blocks.sort((a, b) => distance(a) - distance(b)
          || (Number(a.dataset.sourceTo) - Number(a.dataset.sourceFrom))
            - (Number(b.dataset.sourceTo) - Number(b.dataset.sourceFrom)));
        if (blocks[0]) {
          revealReadingLocation(blocks[0], jump.source, jump.offset);
        }
      } else {
        const host = scope.querySelector('.source-editor,.editor-host');
        if (!host || host.hasAttribute('data-editor-pending') || !editor.current?.scrollToOffset) return;
        editor.current.scrollToOffset(jump.offset,jump.attachment?{focus:false,selectAttachment:mode==='rich'}:undefined);
      }
      consumed = true;
      setJump(null);
    };
    const observer = new MutationObserver(reveal);
    observer.observe(scope, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-editor-pending'] });
    window.addEventListener('moyu-code-dom', reveal);
    reveal();
    return () => {
      observer.disconnect();
      window.removeEventListener('moyu-code-dom', reveal);
    };
  }, [jump, root, path, mode, editor]);
  useEffect(() => { setJump(null); }, [root]);
  return { reveal: setJump, cancel: () => setJump(null) };
}
