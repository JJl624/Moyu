const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const source=require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../src/editor/blockNavigation.ts')],bundle:true,write:false,platform:'node',format:'cjs',external:['prosemirror-*','@codemirror/*']}).outputFiles[0].text;
const mod=new Module(__filename,module);mod.filename=__filename;mod.paths=module.paths;mod._compile(source,__filename);
const {continueList,leaveCodeBlock}=mod.exports,{Schema}=require('prosemirror-model'),{EditorState,TextSelection}=require('prosemirror-state');
const schema=new Schema({nodes:{doc:{content:'block+'},paragraph:{content:'text*',group:'block'},code_block:{content:'text*',group:'block',code:true},text:{},bullet_list:{content:'list_item+',group:'block'},ordered_list:{content:'list_item+',group:'block',attrs:{order:{default:1}}},list_item:{content:'paragraph block*',attrs:{checked:{default:null}}}}});
const paragraph=text=>schema.node('paragraph',null,text?schema.text(text):null),item=(nodes,checked=null)=>schema.node('list_item',{checked},nodes);
function stateAtEmpty(doc){let pos;doc.descendants((node,at)=>{if(node.type.name==='paragraph'&&!node.content.size)pos=at+1;});return EditorState.create({doc,selection:TextSelection.create(doc,pos)});}
function enter(state){let next;assert(continueList(state,tr=>{next=state.apply(tr);}));next.doc.check();return next;}
test('A block continuation becomes a sibling, then exits the outer list without modifying the code',()=>{
  const code=schema.node('code_block',null,schema.text('console.log(42)'));
  for(const type of ['bullet_list','ordered_list'])for(const checked of [null,false,true]){
    let state=stateAtEmpty(schema.node('doc',null,schema.node(type,null,item([paragraph('标题'),code,paragraph()],checked))));
    state=enter(state);assert.equal(state.doc.firstChild.childCount,2);assert.equal(state.doc.firstChild.firstChild.childCount,2);assert.equal(state.selection.$from.node(-1).attrs.checked,checked==null?null:false);
    state=enter(state);assert.equal(state.selection.$from.depth,1);assert.equal(state.doc.childCount,2);assert.equal(state.doc.firstChild.firstChild.lastChild.textContent,'console.log(42)');
  }
});
test('Nested list continuations lift one level on each Enter, retaining the preceding nested item',()=>{
  const code=schema.node('code_block',null,schema.text('print(1)'));
  const inner=schema.node('bullet_list',null,item([paragraph('三级'),code,paragraph()]));
  const middle=schema.node('ordered_list',null,item([paragraph('二级'),inner]));
  let state=stateAtEmpty(schema.node('doc',null,schema.node('bullet_list',null,item([paragraph('一级'),middle]))));
  assert.equal(state.selection.$from.depth,7);
  state=enter(state);assert.equal(state.selection.$from.depth,7);
  state=enter(state);assert.equal(state.selection.$from.depth,5);
  state=enter(state);assert.equal(state.selection.$from.depth,3);
  state=enter(state);assert.equal(state.selection.$from.depth,1);
  let found=0;state.doc.descendants(n=>{if(n.type.name==='code_block'){found++;assert.equal(n.textContent,'print(1)');}});assert.equal(found,1);
});
test('Ordinary text and nonempty selections keep the normal editing keymap',()=>{
  const doc=schema.node('doc',null,schema.node('bullet_list',null,item([paragraph('文本')])));
  let state=EditorState.create({doc,selection:TextSelection.create(doc,4)});assert.equal(continueList(state),false);
  state=EditorState.create({doc,selection:TextSelection.create(doc,3,4)});assert.equal(continueList(state),false);
});
test('Leaving an empty code block uses its own position despite a stale outer selection and stays inside lists',()=>{
  const code=schema.node('code_block');
  for(const nested of [false,true]){
    const doc=schema.node('doc',null,nested?[paragraph('outside'),schema.node('bullet_list',null,item([paragraph('item'),code]))]:[paragraph('outside'),code,code]);
    let state=EditorState.create({doc,selection:TextSelection.create(doc,2)}),pos;
    doc.descendants((node,at)=>{if(node===code&&pos===undefined)pos=at;});
    const view={state,editable:true,dispatch:tr=>{state=state.apply(tr);view.state=state;},focus:()=>{}};
    assert(leaveCodeBlock(view,pos));state.doc.check();
    assert.equal(state.selection.$head.parent.type.name,'paragraph');
    assert.equal(state.selection.$head.depth,nested?3:1);
    const previousCount=state.doc.childCount;assert(leaveCodeBlock(view,pos));assert.equal(state.doc.childCount,previousCount);
    view.editable=false;assert.equal(leaveCodeBlock(view,pos),false);
  }
});
