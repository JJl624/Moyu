const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const code=require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../src/attachmentLinks.ts')],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const mod=new Module(__filename,module);mod.filename=__filename;mod.paths=module.paths;mod._compile(code,__filename);
const {parseAttachment,attachmentAt,attachmentMarkdown,rememberAttachmentSources}=mod.exports;
test('All local file types and images share ordinary Markdown links, preserving Chinese, titles, reserved escapes and balanced destinations',()=>{
 for(const raw of ['![图片](attachments/中文%20图片.svg "说明")','[图](attachments/图.excalidraw)','[数据](attachments/输入.csv)','[文件](attachments/数据(备份).txt)','![远程](https://example.com/image.png)','[文档](<attachments/中文 文件.pdf>)'])assert.equal(parseAttachment(raw)?.raw,raw);
 for(const raw of ['[笔记](笔记.md)','[网站](https://example.com)','[目录](#标题)','[坏](attachments/图.excalidraw','前[图](attachments/图.excalidraw)后'])assert.equal(parseAttachment(raw),null);
 const normalized=attachmentMarkdown({type:'image',url:'attachments/%E4%B8%AD%E6%96%87%20图片.svg',alt:'[说明]',title:'title "here"'});
 assert(normalized.includes('(<attachments/中文 图片.svg>'));assert.equal(parseAttachment(normalized).href,'attachments/中文 图片.svg');assert.equal(parseAttachment(normalized).label,'[说明]');
});

test('Existing attachment label markup, destination escaping and optional titles are retained as editable Markdown',()=>{
 const md='[**图**](attachments/a\\(b\\).excalidraw "说明")',node={type:'link',url:'attachments/a(b).excalidraw',children:[{type:'strong',children:[{type:'text',value:'图'}]}],position:{start:{offset:0},end:{offset:md.length}}};rememberAttachmentSources({type:'root',children:[node]},md);assert.equal(attachmentMarkdown(node),md);assert.equal(parseAttachment(md).label,'图');
});
test('Source context actions only resolve real Markdown attachments, never a link example inside code',()=>{
 const md='[数据](attachments/输入.csv)\n\n```js\n"[图](attachments/图.excalidraw)"\n```\n\n![图](attachments/中文.png)';
 assert.equal(attachmentAt(md,md.indexOf('输入')).href,'attachments/输入.csv');assert.equal(attachmentAt(md,md.indexOf('excalidraw')),null);assert.equal(attachmentAt(md,md.indexOf('中文')).image,true);
});
