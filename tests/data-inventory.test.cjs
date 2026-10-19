const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {children,childPath}=require('../electron/data-inventory.cjs');
const {removeExportHistory}=require('../electron/retired-data.cjs');
const base=path.resolve(__dirname,'../../../work/data-inventory-tests');
test('Inventory includes hidden/unknown files, pages directories and never follows links or escapes its root',async()=>{
 await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'case-'));
 await fs.mkdir(path.join(root,'.data'));await fs.mkdir(path.join(root,'中文.assets'));await fs.writeFile(path.join(root,'.data/未知.json'),'{}');
 for(let i=0;i<205;i++)await fs.writeFile(path.join(root,'文件'+i+'.txt'),'');
 const first=await children(root),second=await children(root,'',first.next),third=await children(root,'',second.next);
 assert.equal(first.items.length,100);assert.equal(third.next,null);assert.equal([...first.items,...second.items,...third.items].length,207);
 assert.equal((await children(root,'.data')).items[0].name,'未知.json');
 for(const invalid of ['../outside','a/../../x','C:/Windows','a\\b'])await assert.rejects(childPath(root,invalid));
 const outside=await fs.mkdtemp(path.join(base,'outside-'));await fs.symlink(outside,path.join(root,'链接'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(children(root,'链接'),/链接目录/);
 const before=(await fs.stat(path.join(root,'.data/未知.json'))).mtimeMs;await children(root,'.data');assert.equal((await fs.stat(path.join(root,'.data/未知.json'))).mtimeMs,before);
});
test('Retired export tracking removes only its index, keeps exported files, and does not create anything on reads',async()=>{await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'exports-'));await removeExportHistory(root);assert.deepEqual(await fs.readdir(root),[]);const exported=path.join(root,'导出.svg');await fs.writeFile(exported,'<svg/>');await fs.writeFile(path.join(root,'exports.json'),JSON.stringify({version:1,files:[{path:exported,time:'2026'}]}));await removeExportHistory(root);assert.equal(await fs.readFile(exported,'utf8'),'<svg/>');assert.equal(await fs.stat(path.join(root,'exports.json')).catch(()=>null),null);await fs.writeFile(path.join(root,'exports.json'),'unrelated');await removeExportHistory(root);assert.equal(await fs.readFile(path.join(root,'exports.json'),'utf8'),'unrelated');});
