const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const output=require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../src/markdownLinks.ts')],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const loaded=new Module(__filename,module);loaded.filename=__filename;loaded.paths=module.paths;loaded._compile(output,__filename);
const {readableHref,relativeHref,containsDrawingLink}=loaded.exports;
test('Local destinations restore Unicode, spaces and punctuation without changing URL separators or remote queries',()=>{
 assert.equal(readableHref('%E4%B8%AD%E6%96%87%20%23%25.png'),'中文 %23%25.png');assert.equal(readableHref('%E4%B8%AD%E3%80%80%E6%96%87.png'),'中　文.png');assert.equal(readableHref('%FF%25E4%B8%AD'),'%FF%25E4%B8%AD');assert.equal(readableHref('中文😀.png'),'中文😀.png');
 assert.equal(readableHref('attachments/%E4%B8%AD%E6%96%87%20%281%29.svg'),'attachments/中文 (1).svg');assert.equal(readableHref('https://example.com/a%20b%28c%29?q=x%26y'),'https://example.com/a%20b%28c%29?q=x%26y');
});
test('Generated relative destinations preserve readable filenames and encode only meaningful URL separators exactly once',()=>{
 const link=relativeHref('笔记/子目录/文档.md','attachments/中文 (图)%#😀.excalidraw');assert.equal(link,'../../attachments/中文 (图)%25%23😀.excalidraw');assert.equal(decodeURIComponent(link),'../../attachments/中文 (图)%#😀.excalidraw');assert.equal(relativeHref('笔记/文档.md','笔记/图.excalidraw'),'图.excalidraw');
});
test('Drawing insertion checks real links rather than code samples or exported PNG names',()=>{
 assert.equal(containsDrawingLink('![图|320](attachments/图.excalidraw)'),true);assert.equal(containsDrawingLink('[图](attachments/图.excalidraw)'),true);assert.equal(containsDrawingLink('![图](attachments/图.excalidraw.png)'),false);assert.equal(containsDrawingLink('`![图](attachments/图.excalidraw)`'),false);assert.equal(containsDrawingLink('```js\n![图](attachments/图.excalidraw)\n```'),false);assert.equal(containsDrawingLink('![[attachments/图.excalidraw]]'),false);
});
