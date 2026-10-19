const test = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module'), path = require('node:path');
const source = require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../src/editor/attachmentDeletion.ts')],bundle:true,write:false,platform:'node',format:'cjs',external:['prosemirror-*']}).outputFiles[0].text;
const mod = new Module(__filename,module);mod.filename=__filename;mod.paths=module.paths;mod._compile(source,__filename);
const {prepareResourceDeletion}=mod.exports;
const {Schema}=require('prosemirror-model'), {EditorState}=require('prosemirror-state'), {history,undo}=require('prosemirror-history');
const schema = new Schema({nodes:{doc:{content:'block+'},paragraph:{group:'block',content:'inline*'},text:{group:'inline'},resource_link:{inline:true,group:'inline',content:'text*'}}});
function fixture(raw){const doc=schema.node('doc',null,schema.node('paragraph',null,schema.node('resource_link',null,schema.text(raw))));return{isDestroyed:false,state:EditorState.create({doc,plugins:[history()]}),dispatch(tr){this.state=this.state.apply(tr);}};}
test('Deletion removes only the clicked duplicate inside surrounding inline source, and is undoable',()=>{
 const link='![中文](attachments/中文.svg)', raw='前文'+link+'中间'+link+'后文', v=fixture(raw), job=prepareResourceDeletion(v,1,raw.lastIndexOf(link)+2);
 assert.equal(job.valid(),true);assert.equal(job.remove(),true);assert.equal(v.state.doc.textContent,'前文'+link+'中间后文');v.state.doc.check();assert.equal(job.remove(),false);
 assert.equal(undo(v.state,tr=>v.dispatch(tr)),true);assert.equal(v.state.doc.textContent,raw);
});
test('Removing a complete attachment leaves an editable empty paragraph',()=>{
 const v=fixture('[绘图](图.excalidraw)'),job=prepareResourceDeletion(v,1,0);assert.equal(job.remove(),true);assert.equal(v.state.doc.firstChild.childCount,0);v.state.doc.check();
});
test('Changed or destroyed documents invalidate a pending confirmation without deleting another occurrence',()=>{
 for(const destroyed of [true,false]){const v=fixture('![图](图.svg)'),job=prepareResourceDeletion(v,1,0);if(destroyed)v.isDestroyed=true;else v.dispatch(v.state.tr.insertText('新增',2));const before=v.state.doc;assert.equal(job.valid(),false);assert.equal(job.remove(),false);assert.equal(v.state.doc,before);}
});
