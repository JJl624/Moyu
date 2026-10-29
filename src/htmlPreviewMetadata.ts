import {parseBlocks,withAttribute} from '../shared/code-documents.mjs';

/** Presentation changes keep the iframe connected, so pin/resize cannot restart its page. */
export function patchHTMLPreviewMetadata(root:HTMLElement,before:string,after:string){
  const previous=parseBlocks(before),next=parseBlocks(after);
  if(previous.length!==next.length)return false;
  if(previous.some((block,index)=>block.meta!==next[index].meta&&!/^html?$/i.test(block.language)))return false;
  const strip=(meta:string)=>withAttribute(withAttribute(meta,'preview',''),'previewHeight','');
  const plain=(source:string,blocks:ReturnType<typeof parseBlocks>)=>{
    let result=source;for(const block of [...blocks].reverse())result=result.slice(0,block.start)+block.fence+block.language+' '+strip(block.meta)+result.slice(block.headerEnd);return result;
  };
  if(plain(before,previous)!==plain(after,next))return false;
  const shells=root.querySelectorAll<HTMLElement>('.code-block-shell');
  // Non-code renderers (such as math) need the normal renderer's indexing.
  if(shells.length!==next.length)return false;
  const edits=previous.map((block,index)=>({from:block.start,to:block.headerEnd,length:next[index].headerEnd-next[index].start}));
  const map=(position:number)=>{let delta=0;for(const edit of edits){if(position<edit.from)break;if(position<edit.to)return edit.from+delta+Math.min(position-edit.from,edit.length);delta+=edit.length-(edit.to-edit.from);}return position+delta;};
  for(const node of root.querySelectorAll<HTMLElement>('[data-source-from],[data-source-to]')){
    for(const key of ['sourceFrom','sourceTo'])if(node.dataset[key]!==undefined)node.dataset[key]=String(map(Number(node.dataset[key])));
  }
  shells.forEach((shell,index)=>{shell.dataset.codeMeta=next[index].meta;const pre=shell.querySelector<HTMLElement>('pre');if(pre)pre.dataset.codeMeta=next[index].meta;});
  return true;
}
