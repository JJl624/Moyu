const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const source=fs.readFileSync(path.join(__dirname,'../src/settingsStore.ts'),'utf8');
const code=require('esbuild').transformSync(source,{loader:'ts',format:'cjs'}).code;
function store(feature){const m=new Module(__filename,module);m.require=name=>name==='./bridge'?{api:{desktop:true,feature}}:module.require(name);m._compile(code,__filename);return m.exports;}
test('Failed preference writes retry on flush and unchanged successful values cause no disk write',async t=>{
 const previous=global.window;global.window=new EventTarget();t.after(()=>global.window=previous);
 let calls=0,stored={};const {settingsStore}=store(async(action,input)=>{if(++calls===1)throw Error('full disk');stored={...stored,...input.values};});
 settingsStore.setItem('key','value');await assert.rejects(settingsStore.flush(),/full disk/);assert.deepEqual(stored,{});
 await settingsStore.flush();assert.deepEqual(stored,{key:'value'});settingsStore.setItem('key','value');await settingsStore.flush();assert.equal(calls,2);
});
test('Failed older preference writes never replace a newer queued edit',async t=>{
 const previous=global.window;global.window=new EventTarget();t.after(()=>global.window=previous);
 let reject,ready,calls=0,stored={};const started=new Promise(r=>ready=r);
 const {settingsStore}=store(async(action,input)=>{if(++calls===1){ready();await new Promise((resolve,r)=>reject=r);}stored={...stored,...input.values};});
 settingsStore.setItem('key','old');const first=assert.rejects(settingsStore.flush(),/failure/);await started;
 settingsStore.setItem('key','new');const next=settingsStore.flush();reject(Error('failure'));await first;await next;await settingsStore.flush();assert.deepEqual(stored,{key:'new'});assert.equal(calls,2);
});

for (const recover of [true, false]) test('Flush waits for an in-flight failed background write and ' + (recover ? 'retries it' : 'reports continued failure'),async t=>{
 const previous=global.window;global.window=new EventTarget();t.after(()=>global.window=previous);
 let reject,ready,calls=0,stored={};const started=new Promise(r=>ready=r);
 const {settingsStore}=store(async(action,input)=>{if(++calls===1){ready();await new Promise((resolve,r)=>reject=r);}if(!recover)throw Error('disk unavailable');stored={...stored,...input.values};});
 settingsStore.setItem('key','value');await started;
 const closing=settingsStore.flush();const outcome=recover?closing:assert.rejects(closing,/disk unavailable/);
 reject(Error('disk unavailable'));await outcome;
 assert.equal(calls,2);assert.deepEqual(stored,recover?{key:'value'}:{});
 if(!recover){await assert.rejects(settingsStore.flush(),/disk unavailable/);assert.equal(calls,3);}
});
