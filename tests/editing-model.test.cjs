const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
function load(name){const source=require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../src/editor/'+name+'.ts')],bundle:true,write:false,platform:'node',format:'cjs',external:['prosemirror-*']}).outputFiles[0].text;const m=new Module(__filename,module);m.filename=__filename;m.paths=module.paths;m._compile(source,__filename);return m.exports;}
const {indentText}=load('textIndentation'),{normalizeInlinePaste}=load('inlinePaste'),{removeQuoteLayer}=load('quoteEditing');
const {Schema,Slice,Fragment}=require('prosemirror-model'),{EditorState,TextSelection}=require('prosemirror-state'),{history,undo}=require('prosemirror-history');
const schema=new Schema({nodes:{doc:{content:'block+'},paragraph:{content:'inline*',group:'block'},heading:{content:'inline*',group:'block'},blockquote:{content:'block+',group:'block'},bullet_list:{content:'list_item+',group:'block'},ordered_list:{content:'list_item+',group:'block',attrs:{order:{default:1}}},list_item:{content:'paragraph block*'},code_block:{content:'text*',group:'block',code:true,attrs:{meta:{default:''}}},resource_link:{inline:true,group:'inline',content:'text*',marks:'',code:true},text:{group:'inline'}},marks:{strong:{},emphasis:{},inlineCode:{code:true},strike_through:{},link:{attrs:{href:{},title:{default:null}}}}});
const text=value=>schema.text(value),p=(...content)=>schema.node('paragraph',null,content),source=value=>schema.node('resource_link',null,text(value)),quote=(...content)=>schema.node('blockquote',null,content);
const doc=(...content)=>schema.node('doc',null,content);

test('Pasted inline source wrappers stay closed even when DOMParser opens through their text content',()=>{
 for(const raw of ['__下划线 **加粗**__','**加粗**','`代码`','[链接](a.md)']){
  const result=normalizeInlinePaste(new Slice(Fragment.from(p(source(raw))),2,2),schema);
  assert.equal(result.openStart,1);assert.equal(result.openEnd,1);assert.equal(result.content.firstChild.firstChild.type.name,'resource_link');
  const s=state(doc(p(text('before'))),7),next=s.apply(s.tr.replaceSelection(result));assert.equal(next.doc.firstChild.lastChild.type.name,'resource_link');assert.equal(next.doc.textContent,'before'+raw);
  const inline=normalizeInlinePaste(new Slice(Fragment.from(source(raw)),1,1),schema);assert.equal(inline.openStart,0);assert.equal(inline.openEnd,0);
 }
});
function state(document,from,to=from){return EditorState.create({doc:document,selection:TextSelection.create(document,from,to),plugins:[history()]});}
function indent(s,back=false){let next=s;assert.equal(indentText(s,tr=>{next=next.apply(tr)},back,4),true);next.doc.check();return next;}

test('Tab keeps the caret at inline sources and a first list item consumes it without leaving the editor',()=>{
 const image='![图片](中文.png)',d=doc(p(source(image)),p(text('next')));
 let s=indent(state(d,2));assert.equal(s.doc.firstChild.textContent,'    '+image);assert.equal(s.selection.$head.parent.type.name,'resource_link');assert.equal(s.selection.$head.parentOffset,0);
 s=indent(state(d,1));assert.equal(s.doc.firstChild.textContent,'    '+image);assert.equal(s.selection.head,5);
 const list=doc(schema.node('bullet_list',null,schema.node('list_item',null,p(source(image)))));s=state(list,4);assert.deepEqual(indent(s).doc.toJSON(),s.doc.toJSON());assert(indent(s).selection.eq(s.selection));
 const lifted=indent(s,true);assert.equal(lifted.doc.firstChild.type.name,'paragraph');assert.equal(lifted.doc.textContent,image);assert.equal(lifted.selection.$head.parent.type.name,'resource_link');
});
test('List indentation retains an inline source offset; selected paragraph indentation and undo retain text',()=>{
 const d=doc(schema.node('bullet_list',null,[schema.node('list_item',null,p(text('first'))),schema.node('list_item',null,p(source('`code`')))]));let pos;d.descendants((n,p)=>{if(n.type.name==='resource_link')pos=p+3});
 let s=indent(state(d,pos));assert.equal(s.selection.$head.parent.type.name,'resource_link');assert.equal(s.selection.$head.parentOffset,2);assert.equal(s.doc.firstChild.firstChild.lastChild.type.name,'bullet_list');s=indent(s,true);assert.deepEqual(s.doc.toJSON(),d.toJSON());
 const plain=doc(p(text('one')),p(source('**two**'))),selected=state(plain,2,plain.content.size-2),indented=indent(selected);assert.equal(indented.doc.child(0).textContent,'    one');assert.equal(indented.doc.child(1).textContent,'    **two**');const out=indent(indented,true);assert.deepEqual(out.doc.toJSON(),plain.toJSON());
 let undone=indented;assert(undo(undone,tr=>{undone=undone.apply(tr)}));assert.deepEqual(undone.doc.toJSON(),plain.toJSON());
});
test('Pasted plain Markdown and native rich-text marks share editable inline source, including replacement characters and backticks',()=>{
 const inline=normalizeInlinePaste(new Slice(Fragment.from(text('`�`')),0,0),schema);assert.equal(inline.content.firstChild.type.name,'resource_link');assert.equal(inline.content.textBetween(0,inline.content.size),'`�`');
 for(const raw of ['`�`','前 **粗体** 后','`未闭合','`` 内含`号 ``','==高亮==','*斜体*']){
  const slice=normalizeInlinePaste(new Slice(Fragment.from(p(text(raw))),1,1),schema);slice.content.firstChild.check();
  assert.equal(slice.content.firstChild.textContent,raw);if(raw!=='`未闭合')assert(slice.content.firstChild.content.content.some(n=>n.type.name==='resource_link'),raw);
 }
 for(const [value,mark] of [['�','inlineCode'],['`','inlineCode'],['  text  ','inlineCode'],['粗体','strong']]){
  const slice=normalizeInlinePaste(new Slice(Fragment.from(p(schema.text(value,[schema.marks[mark].create()]))),1,1),schema);const n=slice.content.firstChild.firstChild;assert.equal(n.type.name,'resource_link');assert.equal(n.firstChild.marks.length,0);assert(n.textContent.includes(value));n.check();
 }
 const code=schema.node('code_block',null,text('`�`'));const slice=normalizeInlinePaste(new Slice(Fragment.from(code),0,0),schema);assert.deepEqual(slice.content.firstChild.toJSON(),code.toJSON());
});
test('Remove quote only lifts selected paragraphs by one level and supports soft-line selections and undo',()=>{
 let d=doc(quote(p(text('before')),p(text('middle')),p(text('after'))));let from;d.descendants((n,p)=>{if(n.isText&&n.text==='middle')from=p});let s=state(d,from,from+6),next=s;assert(removeQuoteLayer(s,tr=>{next=next.apply(tr)}));next.doc.check();assert.equal(next.doc.childCount,3);assert.equal(next.doc.child(0).type.name,'blockquote');assert.equal(next.doc.child(1).textContent,'middle');assert.equal(next.doc.child(2).type.name,'blockquote');assert(undo(next,tr=>{next=next.apply(tr)}));assert.deepEqual(next.doc.toJSON(),d.toJSON());
 d=doc(quote(p(text('a\nb\nc'))));s=state(d,4,5);assert(removeQuoteLayer(s,tr=>{next=s.apply(tr)}));next.doc.check();assert.equal(next.doc.child(0).textContent,'a');assert.equal(next.doc.child(1).textContent,'b');assert.equal(next.doc.child(1).type.name,'paragraph');assert.equal(next.doc.child(2).textContent,'c');
 d=doc(quote(quote(p(text('nested')))));s=state(d,3,8);assert(removeQuoteLayer(s,tr=>{next=s.apply(tr)}));assert.equal(next.doc.firstChild.type.name,'blockquote');assert.equal(next.doc.firstChild.firstChild.type.name,'paragraph');assert.equal(next.doc.textContent,'nested');
 d=doc(quote(p(text('before')),p(text('middle')),p(text('after'))));let end;d.descendants((n,p)=>{if(n.isText&&n.text==='middle')from=p;if(n.isText&&n.text==='after')end=p+5;});s=state(d,from,end);assert(removeQuoteLayer(s,tr=>{next=s.apply(tr)}));next.doc.check();assert.equal(next.doc.child(0).type.name,'blockquote');assert.equal(next.doc.child(1).textContent,'middle');assert.equal(next.doc.child(1).type.name,'paragraph');assert.equal(next.doc.child(2).textContent,'after');assert.equal(next.doc.child(2).type.name,'paragraph');
 assert.equal(removeQuoteLayer(state(doc(p(text('ordinary'))),2,4)),false);
});

test('Quote actions accept a collapsed caret and apply only its soft line; selected lines can gain a quote',()=>{
 const {addQuoteLayer}=load('quoteEditing');let d=doc(quote(p(text('a\nb\nc')))),s=state(d,4),next;
 assert(removeQuoteLayer(s,tr=>next=s.apply(tr)));next.doc.check();assert.equal(next.doc.child(1).type.name,'paragraph');assert.equal(next.doc.child(1).textContent,'b');assert.equal(next.doc.child(0).textContent,'a');assert.equal(next.doc.child(2).textContent,'c');
 d=doc(p(text('a\nb\nc')));s=state(d,3);assert(addQuoteLayer(s,tr=>next=s.apply(tr)));next.doc.check();assert.equal(next.doc.child(0).textContent,'a');assert.equal(next.doc.child(1).type.name,'blockquote');assert.equal(next.doc.child(1).textContent,'b');assert.equal(next.doc.child(2).textContent,'c');
 d=doc(p(text('one')),p(text('two')),p(text('three')));s=state(d,2,8);assert(addQuoteLayer(s,tr=>next=s.apply(tr)));next.doc.check();assert.equal(next.doc.firstChild.type.name,'blockquote');assert.equal(next.doc.firstChild.childCount,2);assert.equal(next.doc.child(1).textContent,'three');
});

test('Quote from inside editable inline syntax wraps the enclosing paragraph and leaves adjacent paragraphs intact',()=>{
 const {addQuoteLayer}=load('quoteEditing');
 for(const raw of ['**加粗**','*斜体*','`code`','$x^2$','==高亮==','[链接](目标.md)','![图片](中文.svg)']){
  const d=doc(p(text('前 '),source(raw),text(' 后')),p(text('另一段')));
  for(const [from,to] of [[4,4],[4,6]]){
   const s=state(d,from,to);let next;
   assert(addQuoteLayer(s,tr=>next=s.apply(tr)),raw);next.doc.check();
   assert.equal(next.doc.firstChild.type.name,'blockquote');assert.equal(next.doc.firstChild.textContent,'前 '+raw+' 后');
   assert.equal(next.doc.child(1).textContent,'另一段');assert(undo(next,tr=>next=next.apply(tr)));assert.deepEqual(next.doc.toJSON(),d.toJSON());
  }
 }
});

test('Quote inside inline syntax operates on its soft line and unquote removes one enclosing level',()=>{
 const {addQuoteLayer}=load('quoteEditing');const raw='`code`';
 const d=doc(p(text('前行\n'),source(raw),text('\n后行')));let pos;d.descendants((n,p)=>{if(n.type.name==='resource_link')pos=p+2});let s=state(d,pos),next;
 assert(addQuoteLayer(s,tr=>next=s.apply(tr)));next.doc.check();assert.equal(next.doc.childCount,3);
 assert.equal(next.doc.child(0).textContent,'前行');assert.equal(next.doc.child(1).type.name,'blockquote');assert.equal(next.doc.child(1).textContent,raw);assert.equal(next.doc.child(2).textContent,'后行');
 const nested=doc(quote(quote(p(text('前 '),source(raw),text(' 后')))));nested.descendants((n,p)=>{if(n.type.name==='resource_link')pos=p+2});s=state(nested,pos);
 assert(removeQuoteLayer(s,tr=>next=s.apply(tr)));next.doc.check();assert.equal(next.doc.firstChild.type.name,'blockquote');assert.equal(next.doc.firstChild.firstChild.type.name,'paragraph');assert.equal(next.doc.textContent,nested.textContent);
});

test('A complete block becomes continuation content of the preceding list item, preserving blanks and undo',()=>{
 const {indentBlockIntoList}=load('listContinuation');
 for(const block of [p(source('![image](a.png)')),schema.node('code_block',null,text('print(1)'))]){
  const list=schema.node('bullet_list',null,[schema.node('list_item',null,p(text('first'))),schema.node('list_item',null,p(text('last')))]),blank=p();
  const d=doc(list,blank,block,p(text('tail'))),pos=list.nodeSize+blank.nodeSize,s=state(d,pos+1);let next;
  assert(indentBlockIntoList(s,pos,tr=>next=s.apply(tr)));next.doc.check();assert.equal(next.doc.childCount,2);assert.equal(next.doc.firstChild.childCount,2);assert.equal(next.doc.firstChild.lastChild.childCount,3);assert.deepEqual(next.doc.firstChild.lastChild.lastChild.toJSON(),block.toJSON());assert.equal(next.doc.child(1).textContent,'tail');assert(undo(next,tr=>next=next.apply(tr)));assert.deepEqual(next.doc.toJSON(),d.toJSON());
 }
 const d=doc(p(text('ordinary')),p(source('![image](a.png)')));assert.equal(indentBlockIntoList(state(d,12),d.firstChild.nodeSize),false);
});


test('Resource outdent removes exactly one list level, retains code ID and supports undo',()=>{
 const {outdentBlockFromList}=load('listContinuation');
 const code=schema.node('code_block',{meta:'id=00ab'},text('print(1)'));
 const inner=schema.node('bullet_list',null,schema.node('list_item',null,[p(text('inner')),code,p(text('after'))]));
 const d=doc(schema.node('bullet_list',null,schema.node('list_item',null,[p(text('outer')),inner])));
 let pos;d.descendants((n,p)=>{if(n===code)pos=p});let s=state(d,pos+1),next;
 assert(outdentBlockFromList(s,pos,tr=>next=s.apply(tr)));next.doc.check();assert.equal(next.doc.firstChild.type.name,'bullet_list');
 let moved;next.doc.descendants((n,p)=>{if(n.type.name==='code_block'){moved=p;assert.equal(n.attrs.meta,'id=00ab')}});
 assert.equal(next.doc.resolve(moved).depth,2);s=next;assert(outdentBlockFromList(s,moved,tr=>next=s.apply(tr)));next.doc.check();
 next.doc.descendants((n,p)=>{if(n.type.name==='code_block')moved=p});assert.equal(next.doc.resolve(moved).depth,0);assert.equal(outdentBlockFromList(next,moved),false);
 assert(undo(next,tr=>next=next.apply(tr)));assert.deepEqual(next.doc.toJSON(),d.toJSON());
});

test('Outdent keeps subsequent non-paragraph resources in a valid remaining list and preserves order',()=>{
 const {outdentBlockFromList}=load('listContinuation');
 const a=schema.node('code_block',null,text('a')),b=schema.node('code_block',null,text('b'));
 for(const order of [0,1,5]){
 const list=schema.node('ordered_list',{order},[schema.node('list_item',null,[p(text('first')),a,b]),schema.node('list_item',null,p(text('last')))]);
 const d=doc(list),pos=2+list.firstChild.firstChild.nodeSize,s=state(d,pos+1);let next;
 assert(outdentBlockFromList(s,pos,tr=>next=s.apply(tr)));next.doc.check();assert.equal(next.doc.childCount,3);
 assert.equal(next.doc.child(1).textContent,'a');assert.equal(next.doc.child(2).firstChild.firstChild.type.name,'paragraph');
 assert.equal(next.doc.child(2).attrs.order,order);assert.equal(next.doc.child(2).firstChild.lastChild.textContent,'b');
 assert.equal(next.doc.child(2).lastChild.textContent,'last');
 }
});

test('An image-only list item outdents without leaving an empty item; surrounding items remain',()=>{
 const {outdentBlockFromList}=load('listContinuation');const image=p(source('![image](a.png)'));
 const list=schema.node('bullet_list',null,[schema.node('list_item',null,p(text('before'))),schema.node('list_item',null,image),schema.node('list_item',null,p(text('after')))]);
 const d=doc(list),pos=1+list.firstChild.nodeSize+1,s=state(d,pos+1);let next;
 assert(outdentBlockFromList(s,pos,tr=>next=s.apply(tr)));next.doc.check();assert.equal(next.doc.childCount,3);
 assert.equal(next.doc.child(0).textContent,'before');assert.equal(next.doc.child(1).textContent,image.textContent);assert.equal(next.doc.child(2).textContent,'after');
});
