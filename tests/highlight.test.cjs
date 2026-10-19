const test=require('node:test'),assert=require('node:assert/strict');
const {buildSync}=require('esbuild'),Module=require('node:module'),path=require('node:path');
const source=buildSync({entryPoints:[path.resolve(__dirname,'../src/inlineSyntax.ts')],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const mod=new Module(__filename,module);mod.filename=__filename;mod.paths=module.paths;mod._compile(source,__filename);
const {parseInline,inlineRaw,sourceInlineTree}=mod.exports;
test('Highlight is native phrasing with exact source positions, nested styles/links, and safe escape/code boundaries',()=>{
 for(const raw of ['==高亮==','前 ==**加粗** 和 [链接](图.png)== 后','==中文 😀==','[==链接标签==](图.png)','==一\n二==']){
  const parsed=parseInline(raw);assert(parsed?.decorated,raw);const walk=n=>{if(n.type==='highlight')assert.equal(raw.slice(n.position.start.offset,n.position.end.offset),inlineRaw(n,raw));n.children?.forEach(walk);};parsed.nodes.forEach(walk);
  const tree={type:'paragraph',children:parsed.nodes};sourceInlineTree(tree,raw);assert(tree.children.some(n=>n.type==='inlineSource'),raw);
 }
 for(const raw of ['\\==普通文字==','`==代码==`','== 未闭合','===不识别===','====','a = b']){
  const parsed=parseInline(raw);const types=[];const walk=n=>{types.push(n.type);n.children?.forEach(walk);};parsed.nodes.forEach(walk);assert(!types.includes('highlight'),raw);
 }
 assert.equal(parseInline('==**bold**==').nodes[0].children[0].type,'strong');
 assert.equal(parseInline('==[图](a.png)==').nodes[0].children[0].type,'link');
 assert.equal(parseInline('==first== ==second==').nodes.filter(n=>n.type==='highlight').length,2);
});
