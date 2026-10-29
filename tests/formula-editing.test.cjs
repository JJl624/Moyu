const {test}=require('node:test'),assert=require('node:assert/strict'),editorModule=require('./helpers/editor-module.cjs');
const modules=Promise.all([editorModule('formulaEditing.ts'),editorModule('sourceFormulaEditing.ts'),import('@milkdown/kit/prose/model'),import('@milkdown/kit/prose/state'),import('@codemirror/state')]);
async function rich(raw,position){
  const [{prepareFormula},,{Schema},{EditorState,TextSelection}]=await modules;
  const schema=new Schema({nodes:{doc:{content:'block+'},paragraph:{content:'inline*',group:'block'},resource_link:{inline:true,group:'inline',content:'text*',code:true},math_block:{group:'block',content:'text*',code:true},text:{group:'inline'}}});
  const resource=schema.node('resource_link',null,schema.text(raw)),doc=schema.node('doc',null,[schema.node('paragraph',null,[schema.text('前 '),resource,schema.text(' 后')])]);
  const view={editable:true,composing:false,isDestroyed:false,state:EditorState.create({doc,selection:TextSelection.create(doc,position??5)}),nodeDOM:()=>null,hasFocus:()=>false,focus(){},dom:{closest:()=>null,ownerDocument:{getSelection:()=>null,documentElement:{dataset:{}},defaultView:null}},dispatch(tr){this.state=this.state.apply(tr);}};
  return {view,prepareFormula,schema,EditorState,TextSelection};
}
test('Formula drafts do not mutate rich text; applying one inline formula preserves sibling syntax',async()=>{
  const f=await rich('**a $x$ b $y$**',15),before=f.view.state.doc;
  const session=f.prepareFormula(f.view);assert.equal(session.value,'y');assert.equal(f.view.state.doc,before);
  assert.equal(session.apply('z^2'),true);assert.equal(f.view.state.doc.textContent,'前 **a $x$ b $z^2$** 后');assert.equal(session.apply('second'),false);
});
test('Rich formula sessions reject changed documents, readonly state and detached owners',async()=>{
  for(const mutation of ['document','readonly','destroyed']){const f=await rich('$x$'),session=f.prepareFormula(f.view);if(mutation==='document')f.view.dispatch(f.view.state.tr.insertText('edit',1));if(mutation==='readonly')f.view.editable=false;if(mutation==='destroyed')f.view.isDestroyed=true;const before=f.view.state.doc;assert.equal(session.apply('y'),false);assert.equal(f.view.state.doc,before);}
});
test('Applying an unchanged formula preserves its original delimiters and document identity',async()=>{
  const f=await rich('$$x$$'),before=f.view.state.doc,session=f.prepareFormula(f.view);assert.equal(session.value,'x');assert.equal(session.apply('x'),true);assert.equal(f.view.state.doc,before);
});
async function source(markdown,offset){
  const [,{prepareSourceFormula},,,{EditorState}]=await modules;
  const view={state:EditorState.create({doc:markdown,selection:{anchor:offset}}),dom:{isConnected:true},composing:false,dispatch(spec){this.state=this.state.update(spec).state;}};
  return {view,prepareSourceFormula};
}
for(const prefix of ['', '   ', '> ', '>    '])test('Source formula replacement preserves its surrounding container prefix: '+JSON.stringify(prefix),async()=>{
  const markdown=prefix+'$$\n'+prefix+'x+1\n'+prefix+'$$\n\n尾文',f=await source(markdown,markdown.indexOf('x+1')+1),session=f.prepareSourceFormula(f.view);assert.equal(session.value,'x+1');assert.equal(session.apply('a\nb'),true);assert.equal(f.view.state.doc.toString(),prefix+'$$\n'+prefix+'a\n'+prefix+'b\n'+prefix+'$$\n\n尾文');
});
test('Source formula helpers ignore code literals and reject stale snapshots',async()=>{
  for(const markdown of ['`$x$`','```js\n$x$\n```']){const f=await source(markdown,markdown.indexOf('x'));assert.equal(f.prepareSourceFormula(f.view),null);}
  const f=await source('前 $x$ 后',4),session=f.prepareSourceFormula(f.view);f.view.dispatch({changes:{from:0,insert:'新'}});const before=f.view.state.doc;assert.equal(session.apply('y'),false);assert.equal(f.view.state.doc,before);
});
