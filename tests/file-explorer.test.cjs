const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module'),path=require('node:path');
const source=require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../src/workspace/fileExplorer.ts')],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const mod=new Module(__filename,module);mod.filename=__filename;mod.paths=module.paths;mod._compile(source,__filename);
const {explorerTree,companionNode,normalizeOrder,toggleOrder,moveOrder}=mod.exports;
const file=(name,extra={})=>({name,path:name,kind:'file',...extra});
test('Explorer sorting mixes folders with files naturally and uses the final extension',()=>{
 const nodes=[file('笔记10.md'),file('绘图.excalidraw.png'),file('笔记2.md'),{name:'目录',path:'目录',kind:'folder',children:[]}];
 assert.deepEqual(explorerTree(nodes,[{key:'name',descending:false}],true).map(n=>n.name),['笔记2.md','笔记10.md','绘图.excalidraw.png','目录']);
 assert.equal(explorerTree(nodes,[{key:'name',descending:true}],true).at(-1).name,'笔记2.md');
 assert.equal(explorerTree(nodes,[{key:'type',descending:false}],true).at(-1).name,'绘图.excalidraw.png');
 const neighbors=[file('笔记.md'),{name:'笔记.assets',path:'笔记.assets',kind:'folder',children:[]},file('后记.md')];
 assert.deepEqual(explorerTree(neighbors,[{key:'name',descending:false}],true).map(n=>n.name),['笔记.assets','笔记.md','后记.md']);
 assert.equal(nodes[0].name,'笔记10.md');
});
test('Date sorting puts unknown dates last in both directions and sorts nested folders without mutating input',()=>{
 for(const key of ['updated','created'])for(const descending of [true,false]){
  const children=[file('无日期'),file('旧',{[key]:1}),file('新',{[key]:2})],nodes=[{name:'目录',path:'目录',kind:'folder',children}];
  assert.deepEqual(explorerTree(nodes,[{key,descending}],true)[0].children.map(n=>n.name),descending?['新','旧','无日期']:['旧','新','无日期']);assert.equal(nodes[0].children,children);assert.equal(children[0].name,'无日期');
 }
});
test('Companion visibility uses ownership, preserves ordinary assets folders and locates the current note or its attachment',()=>{
 const owned={name:'笔记.assets',path:'目录/笔记.assets',kind:'folder',companionFor:'目录/笔记.md',children:[file('图.svg',{path:'目录/笔记.assets/attachments/图.svg'})]},plain={name:'普通.assets',path:'目录/普通.assets',kind:'folder',children:[]},nodes=[{name:'目录',path:'目录',kind:'folder',children:[owned,plain]}];
 assert.deepEqual(explorerTree(nodes,[{key:'name',descending:false}],false)[0].children.map(n=>n.name),['普通.assets']);
 assert.equal(companionNode(nodes,'目录/笔记.md'),owned);assert.equal(companionNode(nodes,'目录/笔记.assets/attachments/图.svg'),owned);assert.equal(companionNode(nodes,'其他.md'),null);
 const data={name:'.data',path:'.data',kind:'folder',system:true,children:[file('map.json',{system:true,path:'.data/map.json'})]};
 assert.equal(explorerTree([data,plain],normalizeOrder(null),false).length,1);assert.equal(explorerTree([data,plain],normalizeOrder(null),true).length,2);
});

test('Multiple keys compare only ties and never insert an implicit folder or name priority',()=>{
 const nodes=[file('a2.md',{updated:2}),file('a10.md',{updated:1}),file('z.excalidraw.png',{updated:1}),file('a.png',{updated:2}),{name:'a1.md',path:'a1.md',kind:'folder',updated:1,children:[]}];
 const order=[{key:'type',descending:true},{key:'updated',descending:false},{key:'name',descending:false}];
 assert.deepEqual(explorerTree(nodes,order,true).map(n=>n.name),['z.excalidraw.png','a.png','a1.md','a10.md','a2.md']);
 assert.deepEqual(explorerTree(nodes,[{key:'type',descending:true},{key:'name',descending:false}],true).map(n=>n.name),['a.png','z.excalidraw.png','a1.md','a2.md','a10.md']);
});

test('Order normalization restores legacy preferences, deduplicates keys and rejects invalid entries',()=>{
 const old=normalizeOrder({key:'created',descending:true});assert.equal(old.length,4);assert.deepEqual(old[0],{key:'created',descending:true});
 assert.deepEqual(normalizeOrder([{key:'type',descending:true},{key:'type',descending:false},{key:'__proto__'},{key:'name',descending:'true'},null])[0],{key:'type',descending:true});
 assert.equal(normalizeOrder(null)[0].key,'name');assert.equal(normalizeOrder([]).length,4);
});

test('Toggling direction preserves priority and moving a key preserves every direction and the original input',()=>{
 const original=normalizeOrder(null), toggled=toggleOrder(original,'type'), moved=moveOrder(toggled,'type','name');
 assert.deepEqual(moved.slice(0,2),[{key:'type',descending:true},{key:'name',descending:false}]);assert.equal(original[1].descending,false);
 assert.deepEqual(toggleOrder(toggled,'type'),original);assert.deepEqual(moveOrder(moved,'type','created').map(i=>i.key),['name','updated','created','type']);
 assert.equal(moveOrder(original,'name','name'),original);
});
