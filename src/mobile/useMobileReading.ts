import {useEffect,type RefObject} from 'react';
import {mobileFeature} from './native';
import {numberMobileCode} from './codeLines';

export interface MobileMedia {src?:string;svg?:string;label:string}

export function readingMedia(target:Element):MobileMedia|null {
  if(target.closest('a,button,summary'))return null;
  const image=target.closest('img');
  if(image instanceof HTMLImageElement)return {src:image.currentSrc||image.src,label:image.alt||'图片'};
  const svg=target.closest('.mermaid-diagram,.resource-preview')?.querySelector('svg');
  if(svg)return {svg:new XMLSerializer().serializeToString(svg),label:target.closest('.mermaid-diagram')?'图表':'绘图'};
  return null;
}

export function useMobileReading(ref:RefObject<HTMLDivElement|null>,enabled:boolean,path:string,content:string,error:(message:string)=>void) {
  useEffect(()=>{
    const root=ref.current;if(!root||!enabled)return;
    const observed=new Set<Element>();let queued=false,live=true;
    const measure=()=>{for(const wrapper of root.querySelectorAll<HTMLElement>('.mobile-table-scroll'))wrapper.dataset.overflow=String(wrapper.scrollWidth>wrapper.clientWidth+1);};
    const sizes=new ResizeObserver(measure);
    const decorate=()=>{
      queued=false;if(!live)return;
      for(const table of root.querySelectorAll<HTMLTableElement>('.reading-view table')){
        if(!table.parentElement?.classList.contains('mobile-table-scroll')){
          const wrapper=document.createElement('div');wrapper.className='mobile-table-scroll';wrapper.tabIndex=0;wrapper.setAttribute('role','region');wrapper.setAttribute('aria-label','表格，可左右滑动');table.replaceWith(wrapper);wrapper.append(table);
        }
        for(const node of [table,table.parentElement!])if(!observed.has(node)){observed.add(node);sizes.observe(node);}
      }
      for(const shell of root.querySelectorAll<HTMLElement>('.reading-view .code-block-shell')){
        if(shell.dataset.language?.toLowerCase()==='mermaid'&&shell.querySelector(':scope > .mermaid-diagram')){
          shell.classList.add('mobile-diagram-shell');shell.querySelector(':scope > .mobile-code-copy')?.remove();continue;
        }
        for(const code of shell.querySelectorAll<HTMLElement>('pre code'))numberMobileCode(code);
        if(shell.querySelector(':scope > .mobile-code-copy,[data-tabs-copy]'))continue;
        const copy=document.createElement('button');copy.className='mobile-code-copy';copy.type='button';copy.textContent='复制';copy.setAttribute('aria-label','复制代码');shell.prepend(copy);
      }
      // Give non-link media a keyboard/touch entry point without changing Markdown.
      for(const media of root.querySelectorAll<HTMLElement>('.reading-view img,.reading-view .mermaid-diagram,.reading-view .resource-preview')){
        if(media.closest('a'))continue;media.tabIndex=0;media.setAttribute('role','button');media.setAttribute('aria-label','全屏查看'+(media instanceof HTMLImageElement?media.alt||'图片':media.classList.contains('mermaid-diagram')?'图表':'绘图'));
      }
      measure();
    };
    const observer=new MutationObserver(()=>{if(!queued){queued=true;queueMicrotask(decorate);}});
    observer.observe(root,{childList:true,subtree:true});decorate();
    const copy=async(event:MouseEvent)=>{
      const target=(event.target as Element).closest('.mobile-code-copy');if(!target)return;
      event.preventDefault();const shell=target.parentElement!;
      // For a tabbed block copy only the visible pane, matching what is displayed.
      const code=[...shell.querySelectorAll<HTMLElement>('pre code')].find(node=>node.getClientRects().length);
      if(!code)return;
      try{await mobileFeature('mobile.copy-text',{text:code.textContent||''});target.textContent='已复制';}
      catch(failure){error((failure as Error).message);}
    };
    root.addEventListener('click',copy);
    return()=>{live=false;observer.disconnect();sizes.disconnect();root.removeEventListener('click',copy);};
  },[enabled,path,content]);
}
