const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {Vault}=require('../electron/vault.cjs');const {References,rewrite}=require('../electron/references.cjs');
const {Attachments}=require('../electron/attachments.cjs');const {CodeData}=require('../electron/code-data.cjs');
async function fixture(){const base=path.resolve(__dirname,'../../../work/v09-unit');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'case-'));return {root,vault:await new Vault(root).init()};}
test('Rename updates encoded Unicode, inline and reference links across notes, preserving labels and code examples and unsaved buffers',async()=>{
 const {root,vault}=await fixture();await fs.mkdir(path.join(root,'attachments'));await fs.writeFile(path.join(root,'attachments/中文 图片.png'),'image');
 const original='![说明](attachments/中文%20图片.png "标题")\n\n[图片][图]\n\n[图]: attachments/%E4%B8%AD%E6%96%87%20%E5%9B%BE%E7%89%87.png\n\n```md\n![代码示例](attachments/中文%20图片.png)\n```\n';
 const doc=await vault.create('笔记.md','file',original);await vault.create('另一篇.md','file','[附件](attachments/中文%20图片.png)');const refs=new References(vault);await refs.refresh(await vault.list());
 const result=await refs.rename({from:'attachments/中文 图片.png',to:'attachments/改名 图片.png',buffers:[{...doc,content:original+'未保存的文字'}]});
 assert.match((await vault.read('笔记.md')).content,/!\[说明\]\(<attachments\/改名 图片.png> "标题"\)/);assert.match((await vault.read('另一篇.md')).content,/改名 图片/);assert.match((await vault.read('笔记.md')).content,/```md\n!\[代码示例\]\(attachments\/中文%20图片.png\)/);assert.match(result.buffers[0].content,/未保存的文字/);
 const map=JSON.parse(await fs.readFile(path.join(root,'.data/attachment_map.json')));assert.equal(map.attachments['attachments/改名 图片.png'].length,2);assert.equal(await fs.stat(path.join(root,'.data/rename-transaction.json')).catch(()=>null),null);
});
test('Moving a document adjusts its outgoing relative URLs; link titles and balanced parentheses survive',async()=>{
 const before='[标签](attachments/a(b).png "保留")\n\n[嵌套 **标签**](attachments/中文.png)';const after=await rewrite(before,'笔记.md','笔记.md','目录/笔记.md');assert.equal(after,'[标签](<../attachments/a(b).png> "保留")\n\n[嵌套 **标签**](../attachments/中文.png)');
});
test('Code folders are lazy; file writes round trip, unchanged data is not rewritten, document folders follow notes, and external edits are protected',async()=>{
 const {root,vault}=await fixture();await vault.create('笔记.md','file','```python {id=0001}\nprint(1)\n```');const attachments=new Attachments(vault),data=new CodeData(vault,attachments),input={document:'笔记.md',language:'python',id:'0001'};
 const empty=await data.context(input);await data.persist(input,empty,[]);assert.equal(await fs.stat(path.join(root,'笔记.assets')).catch(()=>null),null);
 await data.persist(input,empty,[{name:'中文.csv',data:Buffer.from('值\n42').toString('base64')}]);const loaded=await data.context(input);assert.equal(Buffer.from(loaded.files[0].data,'base64').toString(),'值\n42');const file=path.join(root,loaded.directory,'中文.csv'),mtime=(await fs.stat(file)).mtimeMs;await data.persist(input,loaded,loaded.files);assert.equal((await fs.stat(file)).mtimeMs,mtime);
 const moved=await data.context(input);assert.equal(moved.directory,'笔记.assets/code-data/0001');assert.equal(moved.files.length,1);
 await fs.writeFile(path.join(root,moved.directory,'中文.csv'),'外部修改');await assert.rejects(data.persist(input,moved,[{name:'中文.csv',data:Buffer.from('覆盖').toString('base64')}]),e=>e.code==='CONFLICT');assert.equal(await fs.readFile(path.join(root,moved.directory,'中文.csv'),'utf8'),'外部修改');
 await assert.rejects(data.persist(input,moved,[{name:'../越界',data:''}]),/无效/);
});
test('Renaming refuses an externally changed open note without moving the attachment',async()=>{
 const {root,vault}=await fixture();await fs.writeFile(path.join(root,'附件.txt'),'data');const original=await vault.create('笔记.md','file','[数据](附件.txt)');await fs.writeFile(path.join(root,'笔记.md'),'外部修改');const refs=new References(vault);await assert.rejects(refs.rename({from:'附件.txt',to:'改名.txt',buffers:[original]}),e=>e.code==='CONFLICT');assert.equal(await fs.readFile(path.join(root,'附件.txt'),'utf8'),'data');assert.equal(await fs.stat(path.join(root,'改名.txt')).catch(()=>null),null);
});
test('Document moves carry code files and links together and preserve unsaved buffers',async()=>{
 const{root,vault}=await fixture();const refs=new References(vault),attachments=new Attachments(vault),data=new CodeData(vault,attachments,refs),input={document:'笔记.md',language:'python',id:'0001'};
 await vault.create('笔记.md','file','```python {id=0001}\n1\n```');await data.upload({...input,name:'数据.csv',bytes:Buffer.from('1')});
 const original=await vault.read('笔记.md'),withLink=original.content+'\n[数据](笔记.assets/code-data/0001/数据.csv)',saved=await vault.save('笔记.md',withLink,original.version);await vault.create('另一篇.md','file',withLink);
 const {DocumentFiles}=require('../electron/document-files.cjs'),ops=new DocumentFiles(vault,attachments,refs);
 const result=await ops.rename({from:'笔记.md',to:'目录/改名.md',buffers:[{...saved,content:withLink+'\n未保存'}]});assert.match(result.buffers[0].content,/改名\.assets/);assert.match(result.buffers[0].content,/未保存/);assert.doesNotMatch((await vault.read('目录/改名.md')).content,/未保存/);assert.match((await vault.read('另一篇.md')).content,/目录\/改名\.assets/);
 const loaded=await data.context({...input,document:'目录/改名.md'});assert.equal(loaded.directory,'目录/改名.assets/code-data/0001');assert.equal(loaded.files.length,1);
});
test('A failed multi-directory transaction restores files, links and configuration; deleting the reference index rebuilds it',async()=>{
 const{root,vault}=await fixture();await fs.mkdir(path.join(root,'旧1'));await fs.mkdir(path.join(root,'旧2'));await fs.writeFile(path.join(root,'旧1/a.txt'),'A');await fs.writeFile(path.join(root,'旧2/b.txt'),'B');const original='[A](旧1/a.txt) [B](旧2/b.txt)';await vault.create('笔记.md','file',original);const refs=new References(vault);await assert.rejects(vault.mutate(()=>refs.renameUnlocked({moves:[{from:'旧1',to:'新1'},{from:'旧2',to:'新2'}]},async()=>{throw new Error('模拟配置失败');})),/模拟配置失败/);assert.equal((await vault.read('笔记.md')).content,original);assert.equal(await fs.readFile(path.join(root,'旧2/b.txt'),'utf8'),'B');assert.equal(await fs.stat(path.join(root,'新1')).catch(()=>null),null);
 await refs.refresh(await vault.list());await fs.unlink(path.join(root,'.data/attachment_map.json'));await refs.refresh(await vault.list());assert.equal(JSON.parse(await fs.readFile(path.join(root,'.data/attachment_map.json'),'utf8')).attachments['旧1/a.txt'][0],'笔记.md');
});
test('Case-only renames update the real filename and Markdown references',async()=>{
 const{root,vault}=await fixture();await fs.writeFile(path.join(root,'Image.svg'),'svg');await vault.create('笔记.md','file','[图片](Image.svg)');const refs=new References(vault);await refs.rename({from:'Image.svg',to:'image.svg'});assert((await fs.readdir(root)).includes('image.svg'));assert(!(await fs.readdir(root)).includes('Image.svg'));assert.equal((await vault.read('笔记.md')).content,'[图片](image.svg)');
});
