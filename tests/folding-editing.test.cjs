const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const compiled=require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../src/editor/foldingQuoteEditing.ts')],bundle:true,write:false,platform:'node',format:'cjs',external:['prosemirror-*']}).outputFiles[0].text;
const loaded=new Module(__filename,module);loaded.filename=__filename;loaded.paths=module.paths;loaded._compile(compiled,__filename);
const {foldingInput,unfoldAtStart,toggleFoldDefault,foldHeadingAt,leaveFoldHeading}=loaded.exports;
const {Schema}=require('prosemirror-model'),{EditorState,TextSelection}=require('prosemirror-state'),{history,undo,redo,closeHistory}=require('prosemirror-history');
const schema=new Schema({nodes:{doc:{content:'block+'},paragraph:{content:'inline*',group:'block'},blockquote:{content:'block+',group:'block',attrs:{folding:{default:null},foldingDraft:{default:false}}},resource_link:{inline:true,group:'inline',content:'text*'},text:{group:'inline'}}});
const p=text=>schema.node('paragraph',null,text?schema.text(text):undefined),q=(folding,...children)=>schema.node('blockquote',{folding},children);
function state(content,pos){const doc=schema.node('doc',null,content);return EditorState.create({doc,selection:TextSelection.create(doc,pos),plugins:[history()]});}
test('Typing a marker keeps its draft literal and completes both defaults in one quote',()=>{
 for(const sign of ['+','-']){
  let s=state(q(null,p('')),2);
  for(const char of '['+sign+']'){
   const tr=foldingInput(s,s.selection.head,s.selection.head,char);assert(tr);s=s.apply(tr);
   assert.equal(s.doc.firstChild.attrs.foldingDraft,char!==']');
  }
  assert.equal(s.doc.firstChild.attrs.folding,sign==='+');assert.equal(s.doc.textContent,'['+sign+']');
  assert(undo(s,tr=>s=s.apply(tr)));assert.equal(s.doc.textContent,'['+sign);assert.equal(s.doc.firstChild.attrs.folding,null);
  assert(redo(s,tr=>s=s.apply(tr)));assert.equal(s.doc.firstChild.attrs.folding,sign==='+');
 }
 const normal=state(q(null,p('ordinary')),3);assert.equal(foldingInput(normal,3,3,'x'),null);
});
test('Backspace at the visible heading start removes only ] and undo restores folding',()=>{
 for(const open of [false,true])for(const offset of [0,3,4]){
  const marker=open?'[+]':'[-]';let s=state(q(open,p(marker+' Title'),p('Body')),2+offset);
  assert(unfoldAtStart(s,tr=>s=s.apply(tr)));assert.equal(s.doc.firstChild.attrs.folding,null);
  assert.equal(s.doc.firstChild.attrs.foldingDraft,true);assert.equal(s.doc.firstChild.firstChild.textContent,marker.slice(0,2)+' Title');
  assert.equal(s.selection.head,4);assert.equal(s.doc.firstChild.lastChild.textContent,'Body');
  assert(undo(s,tr=>s=s.apply(tr)));assert.equal(s.doc.firstChild.attrs.folding,open);assert.equal(s.doc.firstChild.firstChild.textContent,marker+' Title');
 }
 assert.equal(unfoldAtStart(state(q(true,p('[+] Title')),8)),false);
 assert.equal(unfoldAtStart(state(q(true,p('[+] Title'),p('Body')),14)),false);
});
test('Default toggle edits the nearest nested fold, preserves the caret and supports undo/redo',()=>{
 let s=state(q(false,p('[-] Outer'),q(true,p('[+] Inner'),p('Body'))),16);
 const original=s.doc,head=s.selection.head;
 assert(toggleFoldDefault(s,tr=>s=s.apply(closeHistory(tr))));
 assert.equal(s.doc.firstChild.attrs.folding,false);assert.equal(s.doc.firstChild.child(1).attrs.folding,false);
 assert.equal(s.doc.firstChild.child(1).firstChild.textContent,'[-] Inner');assert.equal(s.selection.head,head);
 assert(undo(s,tr=>s=s.apply(tr)));assert.deepEqual(s.doc.toJSON(),original.toJSON());
 assert(redo(s,tr=>s=s.apply(tr)));assert.equal(s.doc.firstChild.child(1).attrs.folding,false);
 assert.equal(toggleFoldDefault(state(q(null,p('normal')),2)),false);
});

test('Collapsing the default from the body leaves the caret in the visible heading',()=>{
 let s=state(q(true,p('[+] Title'),p('Body')),16);
 assert(toggleFoldDefault(s,tr=>s=s.apply(tr)));assert.equal(s.doc.firstChild.attrs.folding,false);
 assert.equal(s.selection.$head.parent,s.doc.firstChild.firstChild);assert.equal(s.selection.$head.parentOffset,'[+] Title'.length);
 assert(undo(s,tr=>s=s.apply(tr)));assert.equal(s.selection.head,16);
});

test('Backspace before a formatted title unfolds without deleting its formatting',()=>{
 const title=schema.node('paragraph',null,[schema.text('[+] '),schema.node('resource_link',null,schema.text('**Title**'))]);
 let s=state(q(true,title,p('Body')),7);assert(unfoldAtStart(s,tr=>s=s.apply(tr)));
 assert.equal(s.doc.firstChild.attrs.folding,null);assert.equal(s.doc.firstChild.firstChild.textContent,'[+ **Title**');
 assert.equal(s.doc.firstChild.firstChild.lastChild.type.name,'resource_link');
});

test('Visible folding caret starts after the whole marker and Left leaves the heading',()=>{
 for(const marker of ['[+]','[-] ','[+]\t']){
  let s=state([p('Before'),q(marker[1]==='+',p(marker+'Title'),p('Body'))],10);
  const start=10+marker.length;
  assert.deepEqual(foldHeadingAt(s.doc,10),{pos:8,start});
  s=s.apply(s.tr.setSelection(TextSelection.create(s.doc,start)));
  assert(leaveFoldHeading(s,tr=>s=s.apply(tr)));assert.equal(s.selection.$head.parent.textContent,'Before');assert.equal(s.selection.$head.parentOffset,6);
 }
 const first=state(q(true,p('[+]')),5);assert(leaveFoldHeading(first));
 assert.equal(foldHeadingAt(state(q(null,p('plain')),2).doc,2),null);
 assert.equal(leaveFoldHeading(state(q(true,p('[+] Title')),7)),false);
});
