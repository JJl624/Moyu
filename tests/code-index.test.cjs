const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), Module = require('node:module');
const source = require('esbuild').buildSync({entryPoints:[path.resolve(__dirname,'../src/editor/codeIndex.ts')],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const mod = new Module(__filename,module); mod.filename=__filename;mod.paths=module.paths;mod._compile(source,__filename);
const {codeContextAt} = mod.exports, {Schema} = require('prosemirror-model');
const schema = new Schema({nodes:{doc:{content:'block+'},code_block:{group:'block',content:'text*',attrs:{language:{default:''},meta:{default:''}}},text:{}}});
function fixture(blocks){
  const doms=blocks.map(()=>({closest(){return this;}})),doc=schema.node('doc',null,blocks.map(b=>schema.node('code_block',{language:b.language,meta:b.meta||''},b.code?schema.text(b.code):null)));
  let walks=0;const descendants=doc.descendants.bind(doc);doc.descendants=(fn)=>{walks++;return descendants(fn);};
  const positions=[];doc.forEach((node,pos)=>positions.push(pos));
  return {view:{state:{doc},nodeDOM:pos=>doms[positions.indexOf(pos)]},doms,walks:()=>walks};
}
test('Code context indexes a document once across repeated selection reads and maps math separately from real fences',()=>{
  const f=fixture([{language:'latex',code:'x^2'},{language:'js',code:'console.log(1)'},{language:'python',code:'print(2)',meta:'{id=0002 height=100}'}]);
  const markdown='$$\nx^2\n$$\n\n```js\nconsole.log(1)\n```\n\n```python {id=0002 height=100}\nprint(2)\n```';
  for(let i=0;i<100;i++){
    assert.equal(codeContextAt(f.view,markdown,f.doms[0]).start,undefined);
    assert.equal(codeContextAt(f.view,markdown,f.doms[1]).start,markdown.indexOf('```js'));
    assert.equal(codeContextAt(f.view,markdown,f.doms[2]).id,'0002');
  }
  assert.equal(f.walks(),1);
  const result=codeContextAt(f.view,markdown,f.doms[1]);result.code='changed by caller';
  assert.equal(codeContextAt(f.view,markdown,f.doms[1]).code,'console.log(1)');
});
test('Duplicate and aliased fences without IDs map once each and source offsets refresh after preceding text edits',()=>{
  const f=fixture([{language:'python',code:'print(1)'},{language:'py',code:'print(1)'}]);
  const markdown='```py\nprint(1)\n```\n\n```python\nprint(1)\n```';
  assert.equal(codeContextAt(f.view,markdown,f.doms[0]).start,0);
  assert.equal(codeContextAt(f.view,markdown,f.doms[1]).start,markdown.indexOf('```python'));
  assert.equal(codeContextAt(f.view,'前文\n\n'+markdown,f.doms[0]).start,4);
  assert.equal(f.walks(),2);
});
test('Code edits retain their source identity by ID before asynchronous Markdown callbacks catch up',()=>{
  const markdown='```js {id=0001}\nold\n```',f=fixture([{language:'js',code:'new',meta:'{id=0001}'}]);
  assert.deepEqual(codeContextAt(f.view,markdown,f.doms[0]),{language:'js',code:'new',meta:'{id=0001}',id:'0001',start:0});
  const changed=fixture([{language:'python',code:'updated',meta:'{id=0001}'}]);
  f.view.state=changed.view.state;f.view.nodeDOM=changed.view.nodeDOM;
  assert.equal(codeContextAt(f.view,markdown,changed.doms[0]).language,'python');
  assert.equal(changed.walks(),1);
});
test('Imported duplicate IDs use content identity until the editor repairs IDs; ordinary text does not build a code index',()=>{
  const markdown='```js {id=0001}\nfirst\n```\n\n```js {id=0001}\nsecond\n```',f=fixture([{language:'js',code:'first',meta:'{id=0001}'},{language:'js',code:'second',meta:'{id=0001}'}]);
  assert.equal(codeContextAt(f.view,markdown,{closest:()=>null}),null);assert.equal(f.walks(),0);
  assert.equal(codeContextAt(f.view,markdown,f.doms[0]).start,0);
  assert.equal(codeContextAt(f.view,markdown,f.doms[1]).start,markdown.lastIndexOf('```js'));
  assert.equal(f.walks(),1);
});
