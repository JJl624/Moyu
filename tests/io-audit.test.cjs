const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {Vault}=require('../electron/vault.cjs'),{References}=require('../electron/references.cjs'),{DocumentHistory}=require('../electron/document-history.cjs');
async function fixture(t){const base=path.resolve(__dirname,'../../../work/io-audit-tests');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'case-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return{root,vault:await new Vault(root).init()};}
test('Adding attachments does not reread unrelated notes; Wiki targets still update when the inventory changes',async t=>{
  const {root,vault}=await fixture(t);await vault.create('links.md','file','[photo](photo.svg)\n\n[[chapter]]');await vault.create('plain.md','file','unchanged');
  const refs=new References(vault);await refs.refresh(await vault.list());const original=vault.read.bind(vault),reads=[];vault.read=async name=>{reads.push(name);return original(name);};
  const mapFile=path.join(root,'.data/attachment_map.json'),before=(await fs.stat(mapFile)).mtimeMs;
  await vault.create('photo.svg','file','<svg/>');await refs.refresh(await vault.list());assert.deepEqual(reads,[]);assert.equal((await fs.stat(mapFile)).mtimeMs,before);
  await vault.create('nested','folder');await vault.create('nested/chapter.md','file','new chapter');reads.length=0;
  let result=await refs.refresh(await vault.list());assert.deepEqual(reads,['nested/chapter.md']);assert(result.documents['links.md'].includes('nested/chapter.md'));
  await vault.create('other','folder');await vault.create('other/chapter.md','file','ambiguous chapter');reads.length=0;
  result=await refs.refresh(await vault.list());assert.deepEqual(reads,['other/chapter.md']);assert(!result.documents['links.md'].includes('nested/chapter.md'));
  const doc=await original('plain.md');await vault.save(doc.path,'changed',doc.version);reads.length=0;await refs.refresh(await vault.list());assert.deepEqual(reads,['plain.md']);
});
test('History does not access SQLite or compress text for identical and interval-covered snapshots',async t=>{
  const {vault}=await fixture(t);let now=1700000000000;const history=new DocumentHistory(vault,{clock:()=>now});
  const before={path:'note.md',content:'original'},saved={path:'note.md',content:'saved'};await history.capture(before,saved);
  let queries=0,compressions=0;history.database.request=async()=>{queries++;throw Error('unexpected database I/O');};history.entry=async()=>{compressions++;throw Error('unexpected compression');};
  await history.capture(saved,saved);for(let i=0;i<100;i++){now+=50;await history.capture(saved,{...saved,content:'edit '+i});}
  assert.equal(queries,0);assert.equal(compressions,0);
});
test('Save verification still detects an external replacement after an atomic write',async t=>{
  const {root,vault}=await fixture(t),doc=await vault.create('note.md','file','original'),read=vault.read.bind(vault);let calls=0;
  vault.read=async name=>{if(++calls===2)await fs.writeFile(path.join(root,name),'external replacement');return read(name);};
  await assert.rejects(vault.save(doc.path,'my edit',doc.version),error=>error.code==='CONFLICT'&&error.current.content==='external replacement');
  assert.equal(await fs.readFile(path.join(root,'note.md'),'utf8'),'external replacement');
});
