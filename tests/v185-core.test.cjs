const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {rubyVersion,rubyVersions,rubyLabel}=require('../electron/ruby-versions.cjs'),{discoverShells}=require('../electron/terminal-shells.cjs');
test('Ruby catalog distinguishes engine series from build releases and retains compatible older families',async()=>{assert.deepEqual(rubyVersion('3.4.0-2.7.2'),{series:'3.4',build:'2.7.2',package:'@ruby/3.4-wasm-wasi'});assert.equal(rubyVersion('2.10.1').series,'4.0');assert(rubyLabel('3.2.0-2.8.1').includes('3.2'));const seen=[],list=await rubyVersions({versions:async name=>(seen.push(name),['2.10.1','2.7.2','2.6.0'])},{phase(){}});assert.equal(seen.length,4);assert(list.includes('3.2.0-2.7.2'));assert(!list.some(v=>v.includes('2.6.0')));});
test('Shell discovery reads installed programs without executing unknown commands',async()=>{const root=await fs.mkdtemp(path.resolve(__dirname,'../../../work/shells-'));await fs.writeFile(path.join(root,'bash'),'fake binary');const shells=await discoverShells({PATH:root,SHELL:path.join(root,'bash')},'linux');assert(shells.some(p=>p.shell===path.join(root,'bash')));assert(!shells.some(p=>p.shell==='undefined'));});
test('Browser environments check actual upstream content without offering incompatible SDK versions',async t=>{const {checkBrowserRuntime,catalog}=require('../electron/browser-runtimes.cjs'),original=global.fetch;t.after(()=>global.fetch=original);let requested=0;global.fetch=async()=>{requested++;return new Response('new upstream content');};const job={controller:new AbortController(),check(){},file(){},advance(){}},state=await checkBrowserRuntime('csharp',job);assert.equal(requested,1);assert.equal(state.upstreamChanged,true);assert.deepEqual(state.versions,[catalog.csharp.version]);assert.equal(state.refreshMessage,undefined);});
test('Unchanged browser environment refresh reports the check without claiming the latest upstream release',async t=>{
  const {checkBrowserRuntime,catalog}=require('../electron/browser-runtimes.cjs');
  const originalFetch=global.fetch,receipt=catalog.csharp,bytes=Buffer.from('pinned runtime');
  t.after(()=>{global.fetch=originalFetch;catalog.csharp=receipt;});
  catalog.csharp={...receipt,files:[{name:'roslyn-web.js',bytes:bytes.length,sha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex')}]};
  global.fetch=async()=>new Response(bytes);
  const state=await checkBrowserRuntime('csharp',{controller:new AbortController(),check(){},file(){},advance(){}});
  assert.equal(state.upstreamChanged,false);
  assert.deepEqual(state.versions,[receipt.version]);
  assert.equal(state.refreshMessage,undefined);
});
