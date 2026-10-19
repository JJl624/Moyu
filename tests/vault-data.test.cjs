const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {Vault}=require('../electron/vault.cjs'),{configureVaultData}=require('../electron/vault-data.cjs'),{eligible}=require('../electron/files.cjs');
test('Visible data tree is read-only, hidden paths stay blocked, and metadata remains excluded from documents/sync',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moyu-data-'));
 try{
  const vault=await new Vault(root).init();await configureVaultData(vault);await fs.writeFile(path.join(root,'.data','test.json'),'{}');await fs.mkdir(path.join(root,'.hidden'));
  const state=await vault.list(),folder=state.tree.find(n=>n.path==='.data');assert(folder.system);assert(folder.children.every(n=>n.system));assert(!state.tree.some(n=>n.path==='.hidden'));assert.equal((await vault.read('.data/test.json')).content,'{}');
  assert(!eligible('.data/test.json'));assert(!eligible('.data'));
  await assert.rejects(vault.create('.data/a.md','file','x'));await assert.rejects(vault.rename('.data','data'));await assert.rejects(vault.create('nested/.data/a.md','file','x'));await assert.rejects(vault.resolve('.data/../a.md'));await assert.rejects(vault.resolve('.data/.secret'));
  await fs.writeFile(path.join(root,'.data','note.md'),'secret');assert.deepEqual(await vault.search('secret'),[]);await assert.rejects(vault.save('.data/note.md','changed',(await vault.read('.data/note.md')).version));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('Existing visible data directory is renamed without changing its files; two directories never silently merge',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moyu-data-rename-'));
 try{
  const vault=await new Vault(root).init();await fs.mkdir(path.join(root,'Moyu数据'));await fs.writeFile(path.join(root,'Moyu数据','attachment_map.json'),'original');await configureVaultData(vault);
  assert.equal(await fs.readFile(path.join(root,'.data','attachment_map.json'),'utf8'),'original');assert.equal(await fs.stat(path.join(root,'Moyu数据')).catch(()=>null),null);
  await fs.mkdir(path.join(root,'Moyu数据'));await assert.rejects(configureVaultData(vault),/同时存在/);assert.equal(await fs.readFile(path.join(root,'.data','attachment_map.json'),'utf8'),'original');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
