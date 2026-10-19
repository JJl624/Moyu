const { test } = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { withDependencyIds } = require('../electron/runtime-tree.cjs');
const source = require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../src/runtime-settings/runtimeTree.ts')],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const Module = require('node:module'), mod = new Module(__filename, module);
mod.paths = module.paths;
mod._compile(source, __filename);
const { runtimeFileTree, runtimePathTree } = mod.exports;

test('Dependency edges retain exact versions, survive a second serialization and exclude private selection metadata', () => {
  const files = withDependencyIds([
    { id:'main',type:'npm',name:'main.tgz',package:'main',metadata:{dependencies:{shared:'1.0.0'}} },
    { id:'one',type:'npm',name:'shared-1.tgz',package:'shared',version:'1.0.0' },
    { id:'two',type:'npm',name:'shared-2.tgz',package:'shared',version:'2.0.0' },
  ]);
  assert.deepEqual(files[0].dependencyIds,['one']);
  assert.equal(files[0].metadata,undefined);
  assert.deepEqual(withDependencyIds(files),files);
  const tree=runtimeFileTree(files);
  assert.equal(tree.length,2);
  assert.equal(tree[0].name,'main');
  assert.equal(tree[0].detail,'main.tgz');
  assert.equal(tree[0].kind,'package');
  assert.equal(tree[0].children[0].name,'依赖包');
  assert.equal(tree[0].children[0].children[0].entry,files[1]);
  assert.equal(tree[1].entry,files[2]);
});

test('Bundle inventory preserves nested folders and selection identity at the archive root', () => {
  const entry = {id:'bundle',type:'bundle',name:'bundle.zip',requiredFiles:[
    {name:'_framework/dotnet.js',bytes:12}, {name:'_framework/nested/core.wasm',bytes:15}, {name:'index.html',bytes:2},
  ]};
  const [root]=runtimeFileTree([entry]);
  assert.equal(root.name,'dist/');
  assert.equal(root.entry,entry);
  assert.equal(root.children[0].name,'_framework');
  assert.equal(root.children[0].children[1].children[0].entry,entry.requiredFiles[1]);
  assert.deepEqual(runtimePathTree([{name:'folder\\x.txt'},{name:'folder/y.txt'}])[0].children.map(node=>node.name),['x.txt','y.txt']);
});

test('Cyclic and shared dependencies stay visible without recursive explosion', () => {
  const rows=Array.from({length:30},(_,i)=>({id:String(i),name:i+'.tgz',type:'npm',dependencyIds: i<29?[String(i+1),String(i+2)].filter(n=>Number(n)<30):['0']}));
  const tree=runtimeFileTree(rows), found=new Set();let count=0;
  const visit=nodes=>{for(const node of nodes){count++;if(node.entry)found.add(node.entry.id);visit(node.children);}};
  visit(tree);
  assert.equal(found.size,30);
  assert(count<150);
});
