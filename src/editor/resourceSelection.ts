import type {Node} from '@milkdown/kit/prose/model';
import {TextSelection} from '@milkdown/kit/prose/state';

/** Select an attachment's whole source node without entering its name/path. */
export function resourceSelection(document:Node,position:number){
  const at=document.resolve(Math.max(0,Math.min(position,document.content.size)));
  for(let depth=at.depth;depth>0;depth--){
    const node=at.node(depth);
    if(node.type.name==='resource_link'){
      const from=at.before(depth);return TextSelection.create(document,from,from+node.nodeSize);
    }
  }
  if(at.nodeAfter?.type.name==='resource_link')return TextSelection.create(document,at.pos,at.pos+at.nodeAfter.nodeSize);
  return null;
}
