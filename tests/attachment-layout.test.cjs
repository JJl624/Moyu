const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const output=require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../src/attachmentLayout.ts')],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const loaded=new Module(__filename,module);loaded.filename=__filename;loaded.paths=module.paths;loaded._compile(output,__filename);
const {attachmentSize,applyAttachmentSize,standardAttachment}=loaded.exports;
test('Only positive unitless widths and percent scales are interpreted; other suffixes stay literal',()=>{
 assert.deepEqual(attachmentSize('foo|160'),{label:'foo',width:160,scale:undefined});assert.deepEqual(attachmentSize('foo|50%'),{label:'foo',width:undefined,scale:0.5});assert.equal(attachmentSize('foo|12.5%').scale,0.125);
 for(const suffix of ['160px','160x80','0','-2','foo','50 %'])assert.equal(attachmentSize('foo|'+suffix).label,'foo|'+suffix);
});
test('Percentage scales use intrinsic width and both modes preserve automatic height',()=>{
 const element={style:{}};applyAttachmentSize(element,'foo|50%',640);assert.equal(element.style.width,'320px');assert.equal(element.style.height,'auto');applyAttachmentSize(element,'foo|160',640);assert.equal(element.style.width,'160px');
 const plain={style:{}};applyAttachmentSize(plain,'foo',640);assert.equal(plain.style.width,'');
 applyAttachmentSize(element,'foo',640);assert.equal(element.style.width,'');applyAttachmentSize(element,'foo|50%',640);assert.equal(element.style.width,'320px');applyAttachmentSize(element,'foo|0',640);assert.equal(element.style.width,'');
 const svg={namespaceURI:'http://www.w3.org/2000/svg',style:{}};applyAttachmentSize(svg,'foo',260);assert.equal(svg.style.width,'260px');assert.equal(svg.style.height,'auto');
});
test('Generated attachments use standard Markdown, readable destinations and the requested size',()=>{
 assert.equal(standardAttachment('笔记/文档.md','attachments/中文 (图).excalidraw','绘图','50%'),'![绘图|50%](<../attachments/中文 (图).excalidraw>)');assert.equal(standardAttachment('文档.md','数据.csv','数据','160'),'[数据|160](数据.csv)');
});
