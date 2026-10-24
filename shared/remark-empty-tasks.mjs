// GFM requires task text. Keep an intentionally empty task editable without
// inserting a visible placeholder or an invisible character into the file.
import {gfmTaskListItemToMarkdown} from 'mdast-util-gfm-task-list-item';
export default function remarkEmptyTasks(){
  const data=this.data(),extensions=data.toMarkdownExtensions||(data.toMarkdownExtensions=[]),original=gfmTaskListItemToMarkdown().handlers.listItem;
  extensions.push({handlers:{listItem(node,parent,state,info){
    const value=original(node,parent,state,info);
    // The GFM handler misses a completely empty item because its underlying
    // bullet serializer emits no space after the marker.
    return typeof node.checked==='boolean'&&/^(?:[*+-]|\d+[.)])$/.test(value)?value+' ['+(node.checked?'x':' ')+']':value;
  }}});
  return (tree,file)=>{
    const source=String(file.value||'');
    const walk=node=>{
      const paragraph=node.type==='listItem'&&node.checked==null?node.children?.[0]:null;
      const text=paragraph?.type==='paragraph'&&paragraph.children?.length===1?paragraph.children[0]:null;
      if(text?.type==='text'&&/^\[[ xX]\]$/.test(text.value)){
        const offset=text.position?.start?.offset;
        if(offset!==undefined&&source.slice(offset,offset+3)===text.value){node.checked=text.value[1].toLowerCase()==='x';paragraph.children=[];}
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}
