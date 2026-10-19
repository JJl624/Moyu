const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const source=require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../src/artifactFileName.ts')],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const mod=new Module(__filename,module);mod.paths=module.paths;mod._compile(source,__filename);
const {artifactFileName,validArtifactFileName}=mod.exports;

test('Nested output paths yield editable leaf names without changing the result path',()=>{
  for(const [source,leaf] of [['nested/total.txt','total.txt'],['a/b/中文 文件.txt','中文 文件.txt'],['nested\\total.txt','total.txt'],['simple.csv','simple.csv'],['../../outside.txt','outside.txt']]){
    assert.equal(artifactFileName(source),leaf);
    assert(validArtifactFileName(leaf));
  }
});
test('Edited export names still reject paths, traversal, device names and invalid filename characters',()=>{
  for(const name of ['nested/total.txt','nested\\total.txt','../outside.txt','','.','..','CON.txt','LPT9','a:b.txt','end.','end ','a\0b'])assert.equal(validArtifactFileName(name),false,name);
  assert.equal(artifactFileName('invalid/'),'invalid/');
});
