const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {DataStore}=require('../electron/data.cjs');
const {Vault}=require('../electron/vault.cjs');
test('Preferences are visible JSON, atomic serialized writes survive restart and deletion resets values',async()=>{
  const base=path.resolve(__dirname,'../../../work/data-tests');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'case-'));
  const store=new DataStore(root);await Promise.all([store.set({key:'moyu-font',value:'Consolas'}),store.set({key:'moyu-session',value:'{"tabs":["笔记.md"]}'})]);
  assert.equal((await new DataStore(root).get())['moyu-font'],'Consolas');
  await store.set({key:'moyu-custom-commands',value:'[]'});await Promise.all([store.remove('moyu-custom-commands'),store.set({key:'moyu-theme',value:'light'})]);assert.equal((await store.get())['moyu-custom-commands'],undefined);assert.equal((await store.get())['moyu-theme'],'light');const before=(await fs.stat(path.join(root,'settings.json'))).mtimeMs;await store.remove('moyu-custom-commands');assert.equal((await fs.stat(path.join(root,'settings.json'))).mtimeMs,before);
  assert.deepEqual(await fs.readdir(root),['settings.json']);
  await fs.unlink(path.join(root,'settings.json'));assert.deepEqual(await store.get(),{});
});
