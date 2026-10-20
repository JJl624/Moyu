const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const source=require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../src/editor/selection.ts')],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const mod=new Module(__filename,module);mod.filename=__filename;mod.paths=module.paths;mod._compile(source,__filename);
const {toMarkdownSelection,fromMarkdownSelection}=mod.exports;
const {readableSource}=require('../shared/link-destinations.mjs');
const {Schema}=require('prosemirror-model');
const schema=new Schema({nodes:{doc:{content:'block+'},paragraph:{content:'inline*',group:'block'},heading:{content:'inline*',group:'block'},code_block:{content:'text*',group:'block',code:true},text:{group:'inline'}},marks:{strong:{}}});
test('Repeated mapping uses the current source and immutable document after edits',()=>{
 const doc=schema.node('doc',null,schema.node('paragraph',null,schema.text('alpha')));
 for(const md of ['alpha','\n\nalpha','alpha']){
   const offset=md.indexOf('alpha')+3;
   assert.equal(fromMarkdownSelection(md,doc,offset),4);
   assert.equal(toMarkdownSelection(md,doc,4),offset);
 }
 const changed=schema.node('doc',null,schema.node('paragraph',null,schema.text('beta')));
 assert.equal(toMarkdownSelection('beta',changed,4),3);
});
test('Soft line breaks and CRLF map through actual hardbreak positions rather than disappearing from textContent',()=>{
 const rich=new Schema({nodes:{doc:{content:'block+'},paragraph:{content:'inline*',group:'block'},hardbreak:{inline:true,group:'inline'},text:{group:'inline'}}});
 for(const newline of ['\n','\r\n']){const md='首行'+newline+'第二行😀'+newline+'尾行 edited',doc=rich.node('doc',null,rich.node('paragraph',null,[rich.text('首行'),rich.node('hardbreak'),rich.text('第二行😀'),rich.node('hardbreak'),rich.text('尾行 edited')]));
  for(const offset of [md.indexOf('第二'),md.indexOf('😀')+1,md.indexOf('尾'),md.length])assert.equal(toMarkdownSelection(md,doc,fromMarkdownSelection(md,doc,offset)),offset);
 }
});
test('Caret maps through headings, marked text, Unicode and code without losing the logical character',()=>{
  const md='# 标题\n\nalpha **bold** omega😀\n\n```js\nconsole.log(42)\n```\n',doc=schema.node('doc',null,[schema.node('heading',null,schema.text('标题')),schema.node('paragraph',null,[schema.text('alpha '),schema.text('bold',[schema.mark('strong')]),schema.text(' omega😀')]),schema.node('code_block',null,schema.text('console.log(42)'))]);
  for(const offset of [md.indexOf('alpha')+2,md.indexOf('bold')+2,md.indexOf('omega')+3,md.indexOf('😀')+2,md.indexOf('console')+8])assert.equal(toMarkdownSelection(md,doc,fromMarkdownSelection(md,doc,offset)),offset);
});

test('Incomplete attachment links, Unicode surrogate pairs and following text retain the source cursor offsets',()=>{
  const rich=new Schema({nodes:{doc:{content:'block+'},paragraph:{content:'inline*',group:'block'},resource_link:{inline:true,group:'inline',content:'text*'},text:{group:'inline'}}});
  for(const raw of ['[图](attachments/😀图.excalidraw)','[图](attachments/😀图.excalidraw']){
    const md='前 '+raw+' 尾',doc=rich.node('doc',null,[rich.node('paragraph',null,[rich.text('前 '),rich.node('resource_link',null,rich.text(raw)),rich.text(' 尾')])]);
    for(const offset of [md.indexOf('😀'),md.indexOf('😀')+1,md.indexOf('excalidraw')+5,md.indexOf('尾')])assert.equal(toMarkdownSelection(md,doc,fromMarkdownSelection(md,doc,offset)),offset);
  }
});
test('Mode switching maps text inside formulas and around a standard drawing link',()=>{
  const rich=new Schema({nodes:{doc:{content:'block+'},paragraph:{content:'inline*',group:'block'},math_inline:{inline:true,group:'inline',content:'text*'},resource_link:{inline:true,group:'inline',content:'text*'},text:{group:'inline'}}});
  const md='前 $x+y$ 后 [图](attachments/1.excalidraw) 尾',doc=rich.node('doc',null,[rich.node('paragraph',null,[rich.text('前 '),rich.node('math_inline',null,rich.text('x+y')),rich.text(' 后 '),rich.node('resource_link',null,rich.text('[图](attachments/1.excalidraw)')),rich.text(' 尾')])]);
  for(const offset of [md.indexOf('x')+1,md.indexOf('y'),md.indexOf('后'),md.indexOf('[图]'),md.indexOf('附件')+1,md.indexOf('excalidraw')+3,md.indexOf('尾')])assert.equal(toMarkdownSelection(md,doc,fromMarkdownSelection(md,doc,offset)),offset);
});
test('Every raw character in nested styles, formulas and standard attachments survives a mode round trip',()=>{
 const rich=new Schema({nodes:{doc:{content:'block+'},paragraph:{content:'inline*',group:'block'},resource_link:{inline:true,group:'inline',content:'text*'},text:{group:'inline'}}});
 for(const raw of ['**加粗 *斜体* 内容**','==高亮 **加粗** 😀==','$\\frac{3}{4}$','`中文代码`','![中文图|50%](<attachments/中文 图.excalidraw>)']){const md='前 '+raw+' 后',doc=rich.node('doc',null,[rich.node('paragraph',null,[rich.text('前 '),rich.node('resource_link',null,rich.text(raw)),rich.text(' 后')])]);for(let offset=0;offset<=md.length;offset++)assert.equal(toMarkdownSelection(md,doc,fromMarkdownSelection(md,doc,offset)),offset,raw+':'+offset);}
});

test('Following text retains its exact Markdown caret after a legacy encoded link becomes readable',()=>{
 const rich=new Schema({nodes:{doc:{content:'block+'},paragraph:{content:'inline*',group:'block'},resource_link:{inline:true,group:'inline',content:'text*'},text:{group:'inline'}}});
 for(const original of ['![中文](attachments/%E4%B8%AD%E6%96%87%20%281%29.svg)','**![中文](attachments/%E4%B8%AD%E6%96%87%20%281%29.svg)**']){
  const md='前 '+original+' 后续文字',node={type:'root',children:[{type:'image',position:{start:{offset:2+original.indexOf('![')},end:{offset:2+original.lastIndexOf(')')+1}}}]},display=readableSource(node.children[0],md).value,raw=original.startsWith('**')?'**'+display+'**':display;
  const doc=rich.node('doc',null,[rich.node('paragraph',null,[rich.text('前 '),rich.node('resource_link',null,rich.text(raw)),rich.text(' 后续文字')])]);for(const offset of [md.indexOf('后'),md.indexOf('续'),md.length])assert.equal(toMarkdownSelection(md,doc,fromMarkdownSelection(md,doc,offset)),offset);
 }
});
test('Heading source hashes and body retain every caret offset across modes',()=>{
 const rich=new Schema({nodes:{doc:{content:'block+'},heading:{content:'inline*',group:'block',attrs:{sourceHeading:{default:true}}},text:{group:'inline'}}}),md='### 标题',doc=rich.node('doc',null,rich.node('heading',null,rich.text(md)));
 for(let offset=0;offset<=md.length;offset++)assert.equal(toMarkdownSelection(md,doc,fromMarkdownSelection(md,doc,offset)),offset);
});

test('Folding headings, bodies and nested quotes retain caret offsets across modes',()=>{
 const rich=new Schema({nodes:{doc:{content:'block+'},blockquote:{content:'block+',group:'block'},paragraph:{content:'inline*',group:'block'},text:{group:'inline'}}});
 for(const eol of ['\n','\r\n']){
  const md=['> [-] 标题','> 一级内容','>','> > [+] 内层','> > 二级内容','>','> 继续'].join(eol);
  const p=text=>rich.node('paragraph',null,rich.text(text));
  const doc=rich.node('doc',null,rich.node('blockquote',null,[p('[-] 标题'),p('一级内容'),rich.node('blockquote',null,[p('[+] 内层'),p('二级内容')]),p('继续')]));
  for(const text of ['标题','一级内容','内层','二级内容','继续'])for(let index=0;index<text.length;index++){
   const offset=md.indexOf(text)+index;assert.equal(toMarkdownSelection(md,doc,fromMarkdownSelection(md,doc,offset)),offset,`${eol}:${text}:${index}`);
  }
 }
});
