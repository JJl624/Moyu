const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {AppUpdates,releaseInfo}=require('../electron/app-updates.cjs');
const base=path.resolve(__dirname,'../../../work/update-unit');
const release=(version='1.0.1')=>({tag_name:'v'+version,draft:false,prerelease:false,assets:[{name:'Moyu-'+version+'-x64.exe',state:'uploaded',size:100,browser_download_url:'https://github.com/JJl624/Moyu/releases/download/v'+version+'/Moyu-'+version+'-x64.exe'}]});
async function fixture(t){await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'case-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('Update checks validate the stable Windows asset and reject incomplete or redirected releases',()=>{
 assert.equal(releaseInfo(release()).version,'1.0.1');
 for(const invalid of [{...release(),draft:true},{...release(),prerelease:true},{...release(),assets:[]},release('nonsense')])assert.throws(()=>releaseInfo(invalid));
 const wrong=release();wrong.assets[0].browser_download_url='https://example.com/Moyu.exe';assert.throws(()=>releaseInfo(wrong));
});
test('Update checks coalesce, cache successful results for a day, preserve settings and detect a later version',async t=>{
 const root=await fixture(t);let calls=0,clock=100000000,version='1.0.1',releaseFetch;
 const gate=new Promise(resolve=>releaseFetch=resolve);
 const updates=new AppUpdates(root,'1.0.0',{now:()=>clock,fetch:async()=>{calls++;await gate;return Response.json(release(version));}});
 const a=updates.check(true),b=updates.check(true);releaseFetch();const result=await a;await b;assert.equal(calls,1);assert.equal(result.latest.version,'1.0.1');
 const file=path.join(root,'settings.json'),stamp=(await fs.stat(file)).mtimeMs;await updates.check();assert.equal(calls,1);assert.equal((await fs.stat(file)).mtimeMs,stamp);
 await updates.configure(false);clock+=86400001;await updates.check();assert.equal(calls,1);version='1.0.2';await updates.check(true);assert.equal(calls,2);
 assert.equal((await updates.state()).automatic,false);assert.equal((await updates.state()).latest.version,'1.0.2');
 assert.equal((await new AppUpdates(root,'1.0.2').state()).latest,null);
});
test('Offline and rate-limited update checks never claim success or advance the last successful timestamp',async t=>{
 const root=await fixture(t);let fail=false;
 const updates=new AppUpdates(root,'1.0.0',{fetch:async()=>{if(fail)throw Error('offline');return Response.json(release('1.0.0'));}});
 const saved=await updates.check(true);assert.equal(saved.latest,null);fail=true;await assert.rejects(updates.check(true),/GitHub/);assert.equal((await updates.state()).checkedAt,saved.checkedAt);
 const limited=new AppUpdates(root,'1.0.0',{fetch:async()=>new Response('',{status:429})});await assert.rejects(limited.check(true),/请求受限/);
 const missing=new AppUpdates(root,'1.0.0',{fetch:async()=>new Response('',{status:404})});await assert.rejects(missing.check(true),/正式版本/);
});

test('Rate-limited public API falls back to the stable release redirect and verifies the Windows download',async t=>{
 const root=await fixture(t),calls=[];
 const updates=new AppUpdates(root,'1.0.0',{fetch:async(url,options)=>{calls.push([url,options?.method]);if(url.includes('api.github.com'))return new Response('',{status:403});if(url.endsWith('/latest'))return new Response(null,{status:302,headers:{location:'https://github.com/JJl624/Moyu/releases/tag/v1.0.1'}});return new Response(null,{status:200,headers:{'content-length':'100'}});}});
 assert.equal((await updates.check(true)).latest.version,'1.0.1');assert.equal(calls.length,3);assert.equal(calls[2][1],'HEAD');
});
test('Update fallback refuses foreign redirects and unavailable executables',async t=>{
 for(const foreign of [true,false]){const root=await fixture(t);const updates=new AppUpdates(root,'1.0.0',{fetch:async url=>url.includes('api.github.com')?new Response('',{status:429}):url.endsWith('/latest')?new Response(null,{status:302,headers:{location:foreign?'https://example.com/releases/tag/v1.0.1':'https://github.com/JJl624/Moyu/releases/tag/v1.0.1'}}):new Response('',{status:404})});await assert.rejects(updates.check(true),foreign?/版本信息/:/下载文件/);assert.equal((await updates.state()).checkedAt,0);}
});

test('Failed automatic checks wait a day before retrying; an explicit check remains available',async t=>{
 const root=await fixture(t);let calls=0;const updates=new AppUpdates(root,'1.0.0',{fetch:async()=>{calls++;throw Error('offline');}});
 await assert.rejects(updates.check(),/GitHub/);const count=calls,saved=await updates.state();assert.equal(saved.checkedAt,0);assert(saved.attemptedAt>0);
 await updates.check();assert.equal(calls,count);await assert.rejects(updates.check(true),/GitHub/);assert.equal(calls,count*2);
});
