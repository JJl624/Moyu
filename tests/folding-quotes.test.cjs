const {test}=require('node:test'),assert=require('node:assert/strict');
async function processor(){const [{unified},{default:parse},{default:gfm},{default:fold},{default:rehype},{default:stringify},{foldingQuoteHTML}]=await Promise.all([import('unified'),import('remark-parse'),import('remark-gfm'),import('../shared/remark-folding-quotes.mjs'),import('remark-rehype'),import('rehype-stringify'),import('../shared/remark-folding-quotes.mjs')]);return unified().use(parse).use(gfm).use(fold).use(rehype,{handlers:{blockquote:foldingQuoteHTML}}).use(stringify);}
test('Folding quote headings split at the first line and nested defaults are independent',async()=>{
 const p=await processor();const raw='> [-] 一级 **标题**\n> 一级内容\n>\n> > [+] 二级折叠\n> > 二级内容\n> >\n> > - 项目 A\n> > - 项目 B\n>\n> 一级内容继续\n';
 const html=String(await p.process(raw));
 assert.match(html,/<details class="folding-quote"><summary>一级 <strong>标题<\/strong><\/summary>/);
 assert.match(html,/<p>一级内容<\/p>/);assert.match(html,/<details class="folding-quote" open><summary>二级折叠<\/summary>/);
 for(const text of ['二级内容','项目 A','项目 B','一级内容继续'])assert(html.includes(text));
 assert(!html.includes('[-]'));assert(!html.includes('[+]'));
});
test('Ordinary, escaped, inline-code and non-leading markers remain blockquotes',async()=>{
 const p=await processor();for(const raw of ['> 普通引用','> \\[-] 普通','> `[-]` 代码','> 前 [-] 后','> [x] 复选']){
 const html=String(await p.process(raw));assert(html.includes('<blockquote>'),raw);assert(!html.includes('<details'),raw);
 }
 const empty=String(await p.process('> [-]\n>\n> 内容'));assert(empty.includes('<summary></summary>'));assert(empty.includes('<p>内容</p>'));
 assert(String(await p.process('> [-]无空格')).includes('<summary>无空格</summary>'));
});
test('Markdown serialization retains fold markers but keeps literal markers escaped',async()=>{
 const [{unified},{default:parse},{default:fold},{default:stringify}]=await Promise.all([import('unified'),import('remark-parse'),import('../shared/remark-folding-quotes.mjs'),import('remark-stringify')]);
 const p=unified().use(parse).use(fold).use(stringify);
 const saved=String(await p.process('> [-] 标题\n> 内容\n>\n> > [+] 内层\n> > 内容\n\n> \\[-] 普通文字\n'));
 assert(saved.startsWith('> [-] 标题'));assert(saved.includes('> > [+] 内层'));assert(saved.includes('> \\[-] 普通文字'));
 const again=p.runSync(p.parse(saved),{value:saved});assert.equal(again.children[0].folding,false);assert.equal(again.children[0].children[2].folding,true);assert.equal(again.children[1].folding,undefined);
});
test('Editor-generated soft breaks without source positions can split a folding heading',async()=>{
 const [{unified},{default:parse},{default:fold}]=await Promise.all([import('unified'),import('remark-parse'),import('../shared/remark-folding-quotes.mjs')]);
 const p=unified().use(parse).use(fold),raw='> [-] 标题\n> 正文';
 const tree=p.parse(raw);for(const node of tree.children[0].children[0].children)delete node.position;
 const result=p.runSync(tree,{value:raw});assert.equal(result.children[0].folding,false);assert.equal(result.children[0].children.length,2);
});
