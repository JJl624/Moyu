const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const source=require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../src/editor/inlineInput.ts')],bundle:true,write:false,platform:'node',format:'cjs',external:['prosemirror-*']}).outputFiles[0].text;
const mod=new Module(__filename,module);mod.filename=__filename;mod.paths=module.paths;mod._compile(source,__filename);
const {inlineInputTransaction}=mod.exports,{Schema}=require('prosemirror-model'),{EditorState,TextSelection}=require('prosemirror-state'),{history,undo,redo}=require('prosemirror-history');
const schema=new Schema({nodes:{doc:{content:'block+'},paragraph:{content:'inline*',group:'block'},heading:{content:'inline*',group:'block'},code_block:{content:'text*',group:'block',code:true},resource_link:{inline:true,group:'inline',content:'text*',code:true},text:{group:'inline'}}});
const resource=value=>schema.node('resource_link',null,schema.text(value));
test('Delimiter conversion uses model boundaries around existing source nodes and never duplicates surrounding text',()=>{
 for(const [left,old,right,typed,expected]of [
  ['# *','*标题*','','*','# **标题**'],
  ['# _','_标题_','','_','# __标题__'],
  ['前 **原文** ',null,'**标题*','*','前 **原文** **标题**'],
  ['前 ', '**原文**',' **标题*','*','前 **原文** **标题**'],
  ['# *','**标题**','','*','# ***标题***'],
  ['# _','__标题__','','_','# ___标题___'],
  ['','![图](图.svg)',' **中文😀*','*','![图](图.svg) **中文😀**'],
  ['# ','**已有**',' [标题](链接.md',')','# **已有** [标题](链接.md)'],
  ['# ','[已有](链接.md)',' ![标题](图片.svg',')','# [已有](链接.md) ![标题](图片.svg)'],
 ]){
  const children=[left&&schema.text(left),old&&resource(old),right&&schema.text(right)].filter(Boolean),doc=schema.node('doc',null,schema.node('heading',null,children)),pos=doc.firstChild.nodeSize-1;
  const state=EditorState.create({doc,selection:TextSelection.create(doc,pos)}),tr=inlineInputTransaction(state,pos,pos,typed);assert(tr,expected);
  const next=state.apply(tr);next.doc.check();assert.equal(next.doc.textContent,expected);assert.equal(next.selection.$head.parent.type.name,'resource_link');
 }
});
test('Source conversion is idempotent on composition replay and preserves literal/code boundaries',()=>{
 for(const raw of ['**标题**','__标题__','***中文😀***','==高亮==']){
  const doc=schema.node('doc',null,schema.node('heading',null,schema.text('# '+raw))),pos=doc.firstChild.nodeSize-1,state=EditorState.create({doc,selection:TextSelection.create(doc,pos)});
  const tr=inlineInputTransaction(state,pos,pos,'');assert(tr);const next=state.apply(tr);assert.equal(next.doc.textContent,'# '+raw);assert.equal(next.selection.$head.parent.type.name,'resource_link');assert.equal(inlineInputTransaction(next,next.selection.head,next.selection.head,''),null);
 }
 for(const content of [resource('**标题**'),resource('__标题__'),resource('==高亮==')]){
  const doc=schema.node('doc',null,schema.node('heading',null,[schema.text('# '),content])),pos=doc.firstChild.nodeSize-1,state=EditorState.create({doc,selection:TextSelection.create(doc,pos)});
  assert.equal(inlineInputTransaction(state,pos,pos,''),null);assert.equal(inlineInputTransaction(state,pos-1,pos-1,'*'),null);
 }
 for(const [type,raw,char]of [['code_block','**代码*','*'],['paragraph','\\*文字','*'],['paragraph','乘号 2','*'],['paragraph','word_abc','_']]){
  const doc=schema.node('doc',null,schema.node(type,null,schema.text(raw))),pos=doc.firstChild.nodeSize-1,state=EditorState.create({doc,selection:TextSelection.create(doc,pos)});assert.equal(inlineInputTransaction(state,pos,pos,char),null,raw+char);
 }
});
test('The input transaction keeps selection replacements and undo/redo character-exact',()=>{
 const doc=schema.node('doc',null,schema.node('heading',null,[schema.text('# **'),resource('*原文*'),schema.text(' 删除')]));
 const from=doc.firstChild.nodeSize-4,to=doc.firstChild.nodeSize-1,state=EditorState.create({doc,selection:TextSelection.create(doc,from,to),plugins:[history()]});
 const tr=inlineInputTransaction(state,from,to,'**');
 // This replacement remains valid even when no completed region is formed.
 let next=state.apply(tr||state.tr.insertText('**',from,to));next.doc.check();
 assert.equal(next.doc.textContent,'# ***原文***');
 assert(undo(next,t=>{next=next.apply(t)}));assert.deepEqual(next.doc.toJSON(),doc.toJSON());
 assert(redo(next,t=>{next=next.apply(t)}));assert.equal(next.doc.textContent,'# ***原文***');
});
