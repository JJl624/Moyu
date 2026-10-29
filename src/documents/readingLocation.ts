import { lineOffset } from '../../shared/search-location.mjs';

export function revealReadingLocation(block: HTMLElement, source: string, offset: number,options?:{top?:number;focus?:boolean}) {
  for(let parent:HTMLElement|null=block;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)parent.open=true;
  const tabs = block.querySelector<HTMLElement>('[data-tabbed-code]');
  if (tabs && tabs.dataset.tabsDisplay !== 'source') tabs.querySelector<HTMLButtonElement>('[data-tabs-toggle]')?.click();
  const code = block.matches('code') ? block : block.querySelector<HTMLElement>('pre:not([hidden]) code');
  block.scrollIntoView({ block: 'center' });
  if(options?.top!==undefined){const scroll=block.closest('.document-scroll');if(scroll)scroll.scrollTop+=block.getBoundingClientRect().top-scroll.getBoundingClientRect().top-options.top;}
  if (code) {
    const start = Number(block.dataset.sourceFrom),
      firstLine = source.indexOf('\n', start) + 1,
      row = Math.max(1, source.slice(firstLine, offset).split('\n').length),
      position = lineOffset(code.textContent || '', row),
      walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    let remaining = position, node: Node | null;
    while ((node = walker.nextNode())) {
      if (remaining >= (node.textContent?.length || 0)) { remaining -= node.textContent?.length || 0; continue; }
      const range = document.createRange();
      range.setStart(node, remaining);
      range.setEnd(node, Math.min(remaining + 1, node.textContent!.length));
      const scroll = code.closest<HTMLElement>('.document-scroll');
      for (let container: HTMLElement | null = code; container && container !== scroll; container = container.parentElement) {
        if (container.clientHeight && container.scrollHeight > container.clientHeight
          && /auto|scroll|hidden/.test(getComputedStyle(container).overflowY)) {
          container.scrollTop += range.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientHeight / 2;
        }
      }
      if (scroll) scroll.scrollTop += range.getBoundingClientRect().top - scroll.getBoundingClientRect().top - (options?.top??scroll.clientHeight / 2);
      break;
    }
  }else if(options?.top!==undefined){
    const from=Number(block.dataset.sourceFrom),to=Number(block.dataset.sourceTo),walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);
    let cursor=from,node:Node|null,found=false;
    while(!found&&(node=walker.nextNode())){
      const text=node.textContent||'';
      for(let index=0;index<text.length;index++){
        const match=source.indexOf(text[index],cursor);if(match<0||match>=to)break;cursor=match+1;
        if(match>=offset){const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+1);const scroll=block.closest('.document-scroll'),box=range.getBoundingClientRect();if(scroll&&box.height)scroll.scrollTop+=box.top-scroll.getBoundingClientRect().top-options.top;found=true;break;}
      }
    }
  }
  if(options?.focus!==false){block.tabIndex = -1;block.focus({ preventScroll: true });}
}
