// Adjacent lists of the same kind are one editing run, even if the source
// switches from "1." to "3)". A real intervening block keeps lists separate.
// Reading and editing must use the same boundary and numbering rules.
export default function remarkLists(){
  return tree=>{
    const walk=node=>{
      if(!node.children)return;
      const children=[];
      for(const child of node.children){
        walk(child);
        const previous=children.at(-1);
        if(previous?.type==='list'&&child.type==='list'&&!!previous.ordered===!!child.ordered){
          previous.children.push(...child.children);
          previous.spread=!!previous.spread||!!child.spread;
          if(previous.position&&child.position)previous.position={start:previous.position.start,end:child.position.end};
        }else children.push(child);
      }
      node.children=children;
      for(const child of children)if(child.type==='list'){
        child.children.forEach((item,index)=>{
          if(child.ordered)item.label=(child.start??1)+index;
          else delete item.label;
        });
      }
    };
    walk(tree);
  };
}
