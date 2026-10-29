import type {Node} from '@milkdown/kit/prose/model';
import {Plugin,type EditorState,type Transaction} from '@milkdown/kit/prose/state';
import {canJoin,Mapping} from '@milkdown/kit/prose/transform';

const isList=(node:Node)=>node.type.name==='ordered_list'||node.type.name==='bullet_list';

// Keep original starts when editing a list in place. A suffix split out of it
// by liftListItem is a new list, so it starts at one, just like block outdent.
function resetSplitStarts(tr:Transaction,before:EditorState,transactions:readonly Transaction[]){
  const owners=new WeakMap<Node,{position:number}>(),mapping=new Mapping();
  transactions.forEach(transaction=>mapping.appendMapping(transaction.mapping));
  before.doc.descendants((node,pos)=>{
    if(node.type.name==='ordered_list'&&node.attrs.order!==1)
      node.forEach((item,_offset,index)=>{if(index)owners.set(item,{position:pos});});
    return !node.isTextblock;
  });
  tr.doc.descendants((node,pos)=>{
    if(node.type.name==='ordered_list'&&node.attrs.order!==1&&node.firstChild){
      const owner=owners.get(node.firstChild);
      if(owner&&mapping.map(owner.position)!==pos)tr.setNodeMarkup(pos,undefined,{...node.attrs,order:1});
    }
    return !node.isTextblock;
  });
}

export function normalizeLists(tr:Transaction){
  const boundaries:number[]=[];
  let joins=0;
  const walk=(parent:Node,start:number)=>{
    let previous:Node|undefined;
    parent.forEach((node,offset)=>{
      if(previous&&isList(node)&&node.type===previous.type)boundaries.push(start+offset);
      if(!node.isTextblock)walk(node,start+offset+1);
      previous=node;
    });
  };
  walk(tr.doc,0);
  // Joining right to left preserves all remaining boundary positions.
  for(const position of boundaries.sort((a,b)=>b-a))if(canJoin(tr.doc,position)){tr.join(position);joins++;}
  tr.doc.descendants((node,pos,parent,index)=>{
    if(node.type.name==='list_item'&&parent&&isList(parent)){
      const ordered=parent.type.name==='ordered_list',listType=ordered?'ordered':'bullet';
      const label=ordered?`${(parent.attrs.order??1)+index}.`:'•';
      if(node.attrs.label!==label||node.attrs.listType!==listType)tr.setNodeMarkup(pos,undefined,{...node.attrs,label,listType});
    }
    return !node.isTextblock;
  });
  return joins;
}

export function listNormalizationPlugin(){
  return new Plugin({
    appendTransaction(transactions,before,state){
      if(!transactions.some(tr=>tr.docChanged))return null;
      const tr=state.tr;
      resetSplitStarts(tr,before,transactions);
      const split=tr.docChanged,joins=normalizeLists(tr);
      if(!tr.docChanged)return null;
      // Structural joins belong to the triggering history event. Excluding
      // them would make undo reinsert a removed separator inside a list item.
      return split||joins?tr:tr.setMeta('addToHistory',false);
    },
  });
}
