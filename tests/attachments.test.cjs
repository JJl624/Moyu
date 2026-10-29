const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {Vault}=require('../electron/vault.cjs'),{Attachments}=require('../electron/attachments.cjs'),{Drawings}=require('../electron/drawings.cjs');
const base=path.resolve(__dirname,'../../../work/attachment-tests');
async function fixture(t){await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'case-'));t.after(async()=>{assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});const vault=await new Vault(root).init();return {vault,manager:new Attachments(vault)};}
test('Companion folders are lazy, Unicode paths and duplicate names preserve existing bytes',async t=>{
  const {vault,manager}=await fixture(t);await vault.create('目录','folder');await vault.create('目录/笔记.md','file','# 笔记');
  assert.equal(await fs.stat(path.join(vault.root,'目录/笔记.assets')).catch(()=>null),null);
  const first=await manager.upload({document:'目录/笔记.md',name:'图片 空格.png',bytes:new Uint8Array([1,2])});assert.equal(first.path,'目录/笔记.assets/attachments/图片 空格.png');assert.equal(first.link,'笔记.assets/attachments/图片 空格.png');
  const again=await manager.upload({document:'目录/笔记.md',name:'图片 空格.png',bytes:new Uint8Array([3])});assert.equal(again.path,'目录/笔记.assets/attachments/图片 空格-1.png');assert.deepEqual([...await fs.readFile(path.join(vault.root,first.path))],[1,2]);
  assert.equal(await manager.target('目录/笔记.md','图.excalidraw'),'目录/笔记.assets/attachments/图.excalidraw');
  assert.equal(await fs.stat(path.join(vault.root,'.data/vault-settings.json')).catch(()=>null),null);
  await assert.rejects(manager.upload({document:'../逃逸.md',name:'图.png',bytes:new Uint8Array([1])}));
  await assert.rejects(manager.upload({document:'目录/笔记.md',name:'../外部.png',bytes:new Uint8Array([1])}));
});
test('Attachment references parse real Markdown and image associations; code samples do not count as links',async t=>{
  const {vault,manager}=await fixture(t);await vault.create('目录','folder');
  await new Drawings(vault).create({path:'attachments/图.excalidraw'});
  await vault.create('目录/笔记.md','file','');
  const image=await new Drawings(vault).image({path:'attachments/图.excalidraw',document:'目录/笔记.md',format:'svg',bytes:new TextEncoder().encode('<svg/>')});
  await fs.writeFile(path.join(vault.root,'目录/笔记.md'),'![图](../'+encodeURI(image.path)+')\n\n[图源](../attachments/图.excalidraw)\n\n```md\n![假引用](../attachments/no.png)\n```\n');
  await fs.writeFile(path.join(vault.root,'attachments/no.png'),new Uint8Array([1]));
  const files=await manager.list();assert.deepEqual(files.find(f=>f.path==='attachments/图.excalidraw').references,['目录/笔记.md']);assert.deepEqual(files.find(f=>f.path===image.path).references,['目录/笔记.md']);assert.deepEqual(files.find(f=>f.path==='attachments/no.png').references,[]);assert(!files.some(f=>f.path.startsWith('.data')));
  await vault.create('另一笔记.md','file','![另图](attachments/no.png)');
  assert.deepEqual((await manager.list({document:'目录/笔记.md'})).map(f=>f.path).sort(),['attachments/图.excalidraw',image.path].sort());
  assert.deepEqual((await manager.list({document:'目录/笔记.md',content:'![新增][image]\n\n[image]: ../attachments/no.png\n\n```md\n![假引用](../'+image.path+')\n```'})).map(f=>f.path),['attachments/no.png']);
  assert.deepEqual(await manager.list({document:'目录/笔记.md',content:'# 没有附件'}),[]);
});
test('Missing attachments survive delete and stale inventory; reference usages retain source offsets and pending draft links',async t=>{
 const {vault,manager}=await fixture(t);const source='before ![one|50%](图.svg) then [two](图.svg)\n\n![three][pic]\n\n[pic]: 图.svg\n\n[missing](不存在.excalidraw)\n\n```md\n![ignored](假的.png)\n```';await vault.create('笔记.md','file',source);await fs.writeFile(path.join(vault.root,'图.svg'),'<svg/>');manager.state=await vault.list();const found=(await manager.list({document:'笔记.md'})).find(f=>f.path==='图.svg');assert.equal(found.exists,true);assert.equal(found.occurrences.length,3);assert.equal(source.slice(found.occurrences[2].from,found.occurrences[2].to),'![three][pic]');await fs.unlink(path.join(vault.root,'图.svg'));const missing=await manager.list({document:'笔记.md'});assert.equal(missing.find(f=>f.path==='图.svg').exists,false);assert.equal(missing.find(f=>f.path==='不存在.excalidraw').exists,false);assert(!missing.some(f=>f.path==='假的.png'));assert.equal((await vault.read('笔记.md')).content,source);const draft=await manager.list({document:'笔记.md',content:'[draft](未保存.txt)'});assert.deepEqual(draft.map(f=>f.path),['未保存.txt']);assert.equal(draft[0].exists,false);
});
test('Imported companion metadata binds its own document without overwriting an unrelated same-name folder',async t=>{const {vault}=await fixture(t),{DocumentMap}=require('../electron/document-map.cjs'),map=new DocumentMap(vault);await vault.create('导入.md','file','```ruby {id=0001}\nputs 42\n```');await fs.mkdir(path.join(vault.root,'导入.assets'),{recursive:true});await fs.writeFile(path.join(vault.root,'导入.assets/document.json'),JSON.stringify({version:2,document:'导入.md',nextId:2,blocks:['0001']}));await fs.writeFile(path.join(vault.root,'导入.assets/keep.txt'),'keep');assert.equal(await vault.mutate(()=>map.ensureUnlocked('导入.md')),'导入.assets');assert.equal((await map.read()).documents['导入.md'].nextId,2);assert.equal(await fs.readFile(path.join(vault.root,'导入.assets/keep.txt'),'utf8'),'keep');await vault.create('无关.md','file','');await fs.mkdir(path.join(vault.root,'无关.assets'));await fs.writeFile(path.join(vault.root,'无关.assets/document.json'),JSON.stringify({version:2,document:'别的.md',nextId:2,blocks:[]}));await assert.rejects(vault.mutate(()=>map.ensureUnlocked('无关.md')),e=>e.code==='EEXIST');});

test('External note and companion copies adopt only their sibling; duplicate PDF drops preserve both files and original ownership',async t=>{
  const {vault,manager}=await fixture(t);
  await vault.create('笔记.md','file','```text {id=0007}\nkeep\n```');
  await manager.upload({document:'笔记.md',name:'资料.pdf',bytes:Buffer.from('original PDF')});
  await vault.create('Moyu','folder');
  await fs.copyFile(path.join(vault.root,'笔记.md'),path.join(vault.root,'Moyu/笔记.md'));
  await fs.cp(path.join(vault.root,'笔记.assets'),path.join(vault.root,'Moyu/笔记.assets'),{recursive:true});
  await manager.documents.discover();
  const originalOwner=await fs.readFile(path.join(vault.root,'笔记.assets/document.json'),'utf8');
  const first=await manager.upload({document:'Moyu/笔记.md',name:'资料.pdf',bytes:Buffer.from('new PDF')});
  const second=await manager.upload({document:'Moyu/笔记.md',name:'资料.pdf',bytes:Buffer.from('second PDF')});
  assert.equal(first.path,'Moyu/笔记.assets/attachments/资料-1.pdf');
  assert.equal(second.path,'Moyu/笔记.assets/attachments/资料-2.pdf');
  assert.equal(first.link,'笔记.assets/attachments/资料-1.pdf');
  for(const p of ['笔记.assets/attachments/资料.pdf','Moyu/笔记.assets/attachments/资料.pdf'])assert.equal(await fs.readFile(path.join(vault.root,p),'utf8'),'original PDF');
  assert.equal(await fs.readFile(path.join(vault.root,first.path),'utf8'),'new PDF');
  assert.equal(await fs.readFile(path.join(vault.root,second.path),'utf8'),'second PDF');
  assert.equal(await fs.readFile(path.join(vault.root,'笔记.assets/document.json'),'utf8'),originalOwner);
  const registry=await manager.documents.read();
  assert.equal(registry.documents['笔记.md'].directory,'笔记.assets');
  assert.equal(registry.documents['Moyu/笔记.md'].directory,'Moyu/笔记.assets');
  assert.equal(registry.documents['Moyu/笔记.md'].nextId,registry.documents['笔记.md'].nextId);
  assert.equal(JSON.parse(await fs.readFile(path.join(vault.root,'Moyu/笔记.assets/document.json'),'utf8')).document,'Moyu/笔记.md');
});

test('Copied companions never claim a different extension, malformed owner, missing owner, or directory already bound elsewhere',async t=>{
  const {vault,manager}=await fixture(t);
  const cases=[
    ['不同扩展','笔记.markdown',2],
    ['缺少记录',null,2],
    ['无效记录','笔记.md',0],
    ['无效路径','../笔记.md',2],
    ['其他归属','笔记.md',2],
  ];
  for(const [folder,owner,nextId] of cases){
    await vault.create(folder,'folder');
    await vault.create(folder+'/笔记.md','file','');
    const directory=folder+'/笔记.assets';await fs.mkdir(path.join(vault.root,directory));
    if(owner)await fs.writeFile(path.join(vault.root,directory,'document.json'),JSON.stringify({version:2,document:owner,nextId,blocks:[]}));
    if(folder==='其他归属'){
      const registry=await manager.documents.read();registry.documents['笔记.md']={nextId:2,blocks:[],directory};
      await manager.documents.write(registry,[]);
    }
    const before=await fs.readdir(path.join(vault.root,directory));
    await assert.rejects(manager.upload({document:folder+'/笔记.md',name:'资料.pdf',bytes:Buffer.from('new')}),/同名|已关联/);
    assert.deepEqual(await fs.readdir(path.join(vault.root,directory)),before);
  }
});
