const {test} = require('node:test');
const assert = require('node:assert/strict');
const editorModule = require('./helpers/editor-module.cjs');
const modules = Promise.all([
  editorModule('selectionPolicy.ts'), editorModule('codeBoundary.ts'),
  editorModule('documentSession.ts'), editorModule('documentContract.ts'),
  import('@milkdown/kit/prose/model'), import('@milkdown/kit/prose/state'),
]);

const input = overrides => ({editable: true, composing: false, mobile: true,
  keyboardVisible: false, keyboardNavigation: false, deleting: false, outerFocused: true, ...overrides});

test('Metadata, restoration and history cannot acquire a closed mobile IME', async () => {
  const [{mayAcquireInput}] = await modules;
  for (const intent of ['node-update', 'history', 'restore']) assert.equal(mayAcquireInput(intent, input()), false, intent);
  assert.equal(mayAcquireInput('edit', input()), true);
  assert.equal(mayAcquireInput('history', input({keyboardVisible: true})), true);
  assert.equal(mayAcquireInput('restore', input({keyboardVisible: true})), true);
});

test('Readonly and composing owners reject every programmatic input transfer', async () => {
  const [{mayAcquireInput}] = await modules;
  for (const intent of ['edit', 'node-update', 'history', 'restore']) {
    assert.equal(mayAcquireInput(intent, input({editable: false, keyboardVisible: true})), false);
    assert.equal(mayAcquireInput(intent, input({composing: true, keyboardVisible: true})), false);
  }
});

test('Only keyboard navigation or deletion can transfer a node update into code', async () => {
  const [{mayAcquireInput, clampCodeRange}] = await modules;
  assert.equal(mayAcquireInput('node-update', input({keyboardNavigation: true})), true);
  assert.equal(mayAcquireInput('node-update', input({deleting: true})), true);
  assert.equal(mayAcquireInput('node-update', input({deleting: true, outerFocused: false})), false);
  assert.deepEqual(clampCodeRange(99, -3, 4), {anchor: 4, head: 0});
});

async function fixture() {
  const [, boundary, session, contract, {Schema}, state] = await modules;
  const schema = new Schema({nodes: {
    doc: {content: 'block+'}, text: {group: 'inline'}, paragraph: {content: 'inline*', group: 'block'},
    code_block: {content: 'text*', group: 'block', code: true, attrs: {language: {default: 'text'}, meta: {default: ''}}},
    ordered_list: {content: 'list_item+', group: 'block', attrs: {order: {default: 1}}},
    list_item: {content: 'paragraph block*', attrs: {checked: {default: null}}},
  }});
  const p = text => schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
  const doc = children => schema.nodes.doc.create(null, children);
  const code = text => schema.nodes.code_block.create(null, text ? schema.text(text) : undefined);
  return {schema, p, doc, code, ...boundary, ...session, ...contract, ...state};
}

test('Code boundaries require a collapsed direct-sibling edge in the current document', async () => {
  const f = await fixture(), document = f.doc([f.p('a'), f.code(''), f.p('tail')]);
  const state = f.EditorState.create({doc: document});
  const edge = f.TextSelection.create(document, 6), boundary = f.codeBoundaryAt(state, edge, true);
  assert.ok(boundary); assert.equal(boundary.position, 3);
  assert.equal(f.codeBoundaryAt(state, f.TextSelection.create(document, 7), true), null);
  assert.equal(f.codeBoundaryAt(state, f.TextSelection.create(document, 6, 7), true), null);
  assert.equal(f.codeBoundaryAt(state, f.TextSelection.create(f.doc([f.p('other')]), 1), true), null);
  assert.equal(f.isEmptyCodeBridge(boundary, f.TextSelection.create(document, 4, 6)), true);
  assert.equal(f.isEmptyCodeBridge(boundary, edge), false);
});

test('Reading current Markdown does not consume the pending publication', async () => {
  const f = await fixture(), before = f.doc([f.p('before')]), after = f.doc([f.p('after')]);
  let writes = 0;
  const codec = {parse: source => f.schema.nodeFromJSON(JSON.parse(source)),
    serialize: document => { writes++; return JSON.stringify(document.toJSON()); }, spans: () => []};
  const source = JSON.stringify(before.toJSON()), session = new f.DocumentSession(source, before, codec, source);
  const read = session.read(after, source), published = [];
  session.publish(after, source, source, value => published.push(value));
  session.publish(after, source, read, value => published.push(value));
  assert.deepEqual(published, [read]); assert.equal(writes, 1);
});

test('Failed publication remains pending and a saved baseline never hides newer input', async () => {
  const f = await fixture(), a = f.doc([f.p('a')]), b = f.doc([f.p('b')]), c = f.doc([f.p('c')]);
  const codec = {parse: source => f.schema.nodeFromJSON(JSON.parse(source)), serialize: document => JSON.stringify(document.toJSON()), spans: () => []};
  const initial = codec.serialize(a), session = new f.DocumentSession(initial, a, codec, initial);
  const saved = session.read(b, initial);
  assert.throws(() => session.publish(b, initial, initial, () => { throw Error('receiver failed'); }));
  const emitted = []; session.publish(b, initial, initial, value => emitted.push(value));
  assert.equal(emitted.length, 1);
  const latest = session.read(c, saved); assert.notEqual(latest, saved);
  assert.equal(session.read(b, saved), saved);
});

test('Fallback serialization rejects lost code and does not acknowledge or publish the edit', async () => {
  const f = await fixture(), before = f.doc([f.p('a')]), after = f.doc([f.p('a'), f.code('')]);
  let lossy = true;
  const codec = {parse: source => f.schema.nodeFromJSON(JSON.parse(source)),
    serialize: document => JSON.stringify((lossy ? before : document).toJSON()), spans: () => []};
  const source = JSON.stringify(before.toJSON()), session = new f.DocumentSession(source, before, codec, source), emitted = [];
  assert.throws(() => session.publish(after, source, source, value => emitted.push(value)), {name: 'MarkdownStructureError'});
  assert.equal(emitted.length, 0);
  lossy = false; session.publish(after, source, source, value => emitted.push(value));
  assert.equal(emitted.length, 1); assert.equal(codec.parse(emitted[0]).childCount, 2);
});

test('Persistent block checks retain code text, task states and custom list starts', async () => {
  const f = await fixture(), list = (order, checked) => f.doc([f.schema.nodes.ordered_list.create({order}, f.schema.nodes.list_item.create({checked}, f.p('item')))]);
  assert.throws(() => f.assertBlockRoundTrip(f.doc([f.code('1')]), f.doc([f.code('2')])), f.MarkdownStructureError);
  assert.throws(() => f.assertBlockRoundTrip(list(5, false), list(1, false)), f.MarkdownStructureError);
  assert.throws(() => f.assertBlockRoundTrip(list(1, true), list(1, false)), f.MarkdownStructureError);
  f.assertBlockRoundTrip(f.doc([f.p('a'), f.p('')]), f.doc([f.p('a')]));
});

async function delayedSurface(run) {
  const f=await fixture(),bridge=await editorModule(['codeBlockSelection.ts','codeSelection.ts']);
  const node=f.code('abc'),document=f.doc([f.p('before'),node,f.p('after')]);let position;
  document.descendants((n,pos)=>{if(n===node)position=pos;});
  const callbacks=[],previous=global.MutationObserver;
  global.MutationObserver=class {constructor(callback){callbacks.push(callback);}observe(){}disconnect(){}};
  const dataset={mobileInput:'touch',mobileKeyboard:'true'},dom={};let focused=0,destroyed=0;
  const view={editable:true,composing:false,hasFocus:()=>true,nodeDOM:()=>dom,
    dom:{closest:selector=>selector==='.mobile-app'?{}:null,ownerDocument:{documentElement:{dataset}}},
    state:f.EditorState.create({doc:document,selection:f.TextSelection.create(document,position+2,position+3)})};
  const block={view,dom,selected:{value:false},setSelection(){focused++;},selectNode(){focused++;},destroy(){destroyed++;}};
  const mount=()=>{block.cm={dom:{isConnected:true},state:{doc:{length:3},selection:{main:{anchor:0,head:0}}},dispatch(value){this.state.selection.main=value.selection;}};callbacks.forEach(callback=>callback());};
  try {bridge.codeBlockSelection(block);await run({f,bridge,block,view,dataset,mount,callbacks,position,focused:()=>focused,destroyed:()=>destroyed});}
  finally {block.destroy();global.MutationObserver=previous;}
}

test('A delayed code mount rechecks history permission and uses the latest logical range',async()=>{
  await delayedSurface(async({f,bridge,block,view,dataset,mount,position,focused})=>{
    assert.equal(bridge.focusCodeSelection(view,'history'),true);
    dataset.mobileKeyboard='false';view.state=view.state.apply(view.state.tr.setSelection(f.TextSelection.create(view.state.doc,position+3)));
    mount();assert.equal(focused(),0);assert.deepEqual(block.cm.state.selection.main,{anchor:2,head:2});
  });
});

test('A pending code mount cannot take the caret back from a paragraph or a destroyed view',async()=>{
  await delayedSurface(async({f,bridge,block,view,mount,focused})=>{
    bridge.focusCodeSelection(view,'edit');view.state=view.state.apply(view.state.tr.setSelection(f.TextSelection.create(view.state.doc,1)));
    mount();assert.equal(focused(),0);assert.deepEqual(block.cm.state.selection.main,{anchor:0,head:0});
  });
  await delayedSurface(async({bridge,block,view,mount,focused})=>{
    bridge.focusCodeSelection(view,'edit');block.destroy();mount();assert.equal(focused(),0);assert.equal(bridge.focusCodeSelection(view,'edit'),false);
  });
});

test('Unregistering an old code input surface does not remove its replacement',async()=>{
  const f=await fixture(),bridge=await editorModule('codeSelection.ts'),document=f.doc([f.code('')]),dom={},calls=[];
  const view={state:f.EditorState.create({doc:document,selection:f.TextSelection.create(document,1)}),nodeDOM:()=>dom};
  const old=bridge.registerCodeFocus(dom,()=>calls.push('old'));
  const current=bridge.registerCodeFocus(dom,(anchor,head,intent)=>calls.push([anchor,head,intent]));
  old();assert.equal(bridge.focusCodeSelection(view,'history'),true);assert.deepEqual(calls,[[0,0,'history']]);
  current();assert.equal(bridge.focusCodeSelection(view,'history'),false);
});

test('Shared document normalization is idempotent and preserves empty tasks and code',async()=>{
  const {unified}=await import('unified'),{default:parse}=await import('remark-parse'),{default:gfm}=await import('remark-gfm'),{default:structure}=await import('../shared/remark-document-structure.mjs');
  const processor=unified().use(parse).use(gfm).use(structure);
  for(const source of ['- [ ]\n- [x]','1. <br />\n   ```text {id=0003}\n   ```\n   <br />','1. a\n\n3) b']){
    const once=processor.runSync(processor.parse(source),{value:source}),snapshot=JSON.stringify(once);
    processor.runSync(once,{value:source});assert.equal(JSON.stringify(once),snapshot);
  }
});

test('Code ownership without a mounted input surface never falls back to outer-text focus',async()=>{
  const f=await fixture(),{focusEditorSelection,readNativeSelection}=await editorModule('selectionOwnership.ts');
  const headless=require('./helpers/headless-editor-view.cjs'),document=f.doc([f.code('')]);
  const view=headless(f.EditorState.create({doc:document,selection:f.TextSelection.create(document,1)}));
  view.nodeDOM=()=>({});focusEditorSelection(view,'edit');assert.equal(view.focusCount,0);
  view.composing=true;view.dom.ownerDocument.getSelection=()=>{throw Error('composition selection must not be read');};
  readNativeSelection(view);
});
