const {test}=require('node:test'),assert=require('node:assert/strict');
const editorModule=require('./helpers/editor-module.cjs');

test('Attachment navigation selects the complete reference in paragraphs, lists and quotes without selecting adjacent text',async()=>{
  const {Schema}=await import('@milkdown/kit/prose/model'),{resourceSelection}=await editorModule('resourceSelection.ts');
  const schema=new Schema({nodes:{doc:{content:'block+'},text:{group:'inline'},paragraph:{content:'inline*',group:'block'},resource_link:{inline:true,group:'inline',content:'text*'},blockquote:{group:'block',content:'block+'},bullet_list:{group:'block',content:'list_item+'},list_item:{content:'paragraph block*'}}});
  const p=()=>schema.node('paragraph',null,[schema.text('前 '),schema.node('resource_link',null,schema.text('![名称](图片.svg)')),schema.text(' 后')]);
  for(const block of [p(),schema.node('blockquote',null,p()),schema.node('bullet_list',null,schema.node('list_item',null,p()))]){
    const document=schema.node('doc',null,block);let from,size;document.descendants((node,pos)=>{if(node.type.name==='resource_link'){from=pos;size=node.nodeSize;}});
    for(let pos=from;pos<from+size;pos++){const selection=resourceSelection(document,pos);assert.equal(selection.from,from);assert.equal(selection.to,from+size);assert.equal(selection.empty,false);}
    assert.equal(resourceSelection(document,from-1),null);assert.equal(resourceSelection(document,from+size),null);assert.equal(document.child(0),block);
  }
});

test('Restoring an identical native caret does not emit redundant collapse operations; a changed caret still reconciles once',async()=>{
  const {Schema}=await import('@milkdown/kit/prose/model'),{EditorState,TextSelection}=await import('@milkdown/kit/prose/state'),{focusEditorSelection}=await editorModule('selectionOwnership.ts');
  const schema=new Schema({nodes:{doc:{content:'paragraph+'},paragraph:{content:'text*'},text:{}}}),doc=schema.node('doc',null,schema.node('paragraph',null,schema.text('abc'))),text={nodeType:3,parentElement:{closest:()=>null}};
  let collapses=0;const native={isCollapsed:true,anchorNode:text,anchorOffset:1,collapse(node,offset){collapses++;this.anchorNode=node;this.anchorOffset=offset;this.isCollapsed=true;}};
  const view=require('./helpers/headless-editor-view.cjs')(EditorState.create({doc,selection:TextSelection.create(doc,2)}));view.dom.ownerDocument.getSelection=()=>native;view.domAtPos=()=>({node:text,offset:1});
  focusEditorSelection(view,'restore');assert.equal(collapses,0);assert.equal(view.focusCount,1);
  native.anchorOffset=0;focusEditorSelection(view,'restore');assert.equal(collapses,1);assert.equal(native.anchorOffset,1);
  native.isCollapsed=false;focusEditorSelection(view,'restore');assert.equal(collapses,2);
});
