const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const source=require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../src/editor/codeMetadata.ts')],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const mod=new Module(__filename,module);mod.filename=__filename;mod.paths=module.paths;mod._compile(source,__filename);
const {heightFromMeta,withHeight,attributeFromMeta,attributeGroups,withAttributeGroups}=mod.exports;
test('Height attributes preserve unrelated attributes, quoted values and metadata outside braces',()=>{
  const meta='example {#code .wide data-height=90 title="height=120 {sample}" height="160px"}';
  assert.equal(heightFromMeta(meta),160);
  assert.equal(withHeight(meta,220),'example {#code .wide data-height=90 title="height=120 {sample}" height=220}');
  assert.equal(withHeight(meta,null),'example {#code .wide data-height=90 title="height=120 {sample}"}');
  assert.equal(heightFromMeta('height=160'),null);
  assert.equal(heightFromMeta('{title="height=160" data-height=100}'),null);
  assert.equal(heightFromMeta('{height = 200}'),200);
  assert.equal(withHeight('language-option',160),'language-option {height=160}');
  assert.equal(withHeight('{height=160}',null),'');
  assert.equal(heightFromMeta('{height=10000}'),4000);
});
test('Editable attribute groups preserve non-attribute metadata and reject incomplete drafts',()=>{
 const meta='example title="{literal}" {height=160 .wide title="{quoted}"} extra {size=50%}';
 assert.equal(attributeGroups(meta),'{height=160 .wide title="{quoted}"} {size=50%}');
 assert.equal(attributeGroups('{ } {}'),'');
 assert.equal(attributeGroups('{} before {height=160} after'),'{} {height=160}');
 assert.equal(withAttributeGroups('{} before {height=160} after','{} {height=240}'),'{} before {height=240} after');
 assert.equal(withAttributeGroups(meta,'{height=240 size=80%}'),'example title="{literal}" {height=240 size=80%} extra');
 assert.equal(withAttributeGroups(meta,''),'example title="{literal}" extra');
 assert.equal(withAttributeGroups('example','{}'),'example {}');
 assert.equal(withAttributeGroups('example',''),'example');
 assert.equal(heightFromMeta('title="{height=200}" {height=160}'),160);
 assert.equal(withHeight('title="{height=200}" {size=50%}',220),'title="{height=200}" {size=50% height=220}');
 assert.equal(attributeFromMeta('title="{size=240}" {size=50%}','size'),'50%');
 for(const draft of ['{height=','{title="unfinished}','height=160','{height=160} outside'])assert.equal(withAttributeGroups(meta,draft),null);
 assert.equal(withAttributeGroups('{id=0001 height=160}','{height=200 id=00ff}'),'{height=200 id=0001}');
 assert.equal(withAttributeGroups('{id=0001 height=160}',''),'{id=0001}');
});
test('Sizing reads exact attributes inside braces and never consumes quoted captions or other keys',()=>{
  assert.equal(attributeFromMeta('example {#diagram size=160 height=120}','size'),'160');
  assert.equal(attributeFromMeta('{size = 12.5%}','size'),'12.5%');
  assert.equal(attributeFromMeta('{size="50%"}','size'),'50%');
  for(const meta of ['size=160','{data-size=160}','{title="size=160 {size=200}"}','{title="size=160"}'])assert.equal(attributeFromMeta(meta,'size'),null);
  assert.equal(attributeFromMeta('{title="size=160 {sample}" size=240}','size'),'240');
  assert.equal(withHeight('{size=50% height=160}',220),'{size=50% height=220}');
});
test('Resize preserves attribute order and other groups, repairs duplicate legacy heights and rejects non-finite input',()=>{
 const meta='example {height=160 .wide title="a  b" size=50%} between {#last}';
 assert.equal(withHeight(meta,220),'example {height=220 .wide title="a  b" size=50%} between {#last}');
 assert.equal(withHeight(meta,NaN),meta);assert.equal(withHeight(meta,Infinity),meta);
 const broken='{height=NaN height=NaN .wide height=103 size=50%}';
 assert.equal(withHeight(broken,200),'{height=200 .wide size=50%}');assert.equal(withHeight(broken,null),'{.wide size=50%}');
 assert.equal(withHeight('{height=NaN height=NaN}',null),'');
 assert.equal(withHeight('{height= size=50% .wide}',200),'{height=200 size=50% .wide}');
 assert.equal(withHeight('{height = .wide size=50%}',null),'{.wide size=50%}');
 assert.equal(withHeight('{size=50%} {height=160 #last}',220),'{size=50%} {height=220 #last}');
 assert.equal(withAttributeGroups(meta,'{height=240 .wide} {#second}'),'example {height=240 .wide} between {#second}');
 for(let i=0,value=broken;i<20;i++){value=withHeight(value,103);assert.equal((value.match(/height=/g)||[]).length,1);value=withHeight(value,null);assert.equal(value,'{.wide size=50%}');}
});
