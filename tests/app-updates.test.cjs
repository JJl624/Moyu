const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {AppUpdates,releaseInfo,releaseAssets}=require('../electron/app-updates.cjs');
const windowsInfo=value=>releaseInfo(value,'win32','x64');
const base=path.resolve(__dirname,'../../../work/update-unit');
const release=(version='1.0.1')=>({tag_name:'v'+version,draft:false,prerelease:false,assets:[{name:'Moyu-'+version+'-x64.exe',state:'uploaded',size:100,browser_download_url:'https://github.com/JJl624/Moyu/releases/download/v'+version+'/Moyu-'+version+'-x64.exe'}]});
async function fixture(t){await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'case-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('Update checks validate the stable Windows asset and reject incomplete or redirected releases',()=>{
 assert.equal(windowsInfo(release()).version,'1.0.1');
 for(const invalid of [{...release(),draft:true},{...release(),prerelease:true},{...release(),assets:[]},release('nonsense')])assert.throws(()=>windowsInfo(invalid));
 const wrong=release();wrong.assets[0].browser_download_url='https://example.com/Moyu.exe';assert.throws(()=>windowsInfo(wrong));
});
test('Update checks coalesce, cache successful results for a day, preserve settings and detect a later version',async t=>{
 const root=await fixture(t);let calls=0,clock=100000000,version='1.0.1',releaseFetch;
 const gate=new Promise(resolve=>releaseFetch=resolve);
 const updates=new AppUpdates(root,'1.0.0',{platform:'win32',arch:'x64',now:()=>clock,fetch:async()=>{calls++;await gate;return Response.json(release(version));}});
 const a=updates.check(true),b=updates.check(true);releaseFetch();const result=await a;await b;assert.equal(calls,1);assert.equal(result.latest.version,'1.0.1');
 const file=path.join(root,'settings.json'),stamp=(await fs.stat(file)).mtimeMs;await updates.check();assert.equal(calls,1);assert.equal((await fs.stat(file)).mtimeMs,stamp);
 await updates.configure(false);clock+=86400001;await updates.check();assert.equal(calls,1);version='1.0.2';await updates.check(true);assert.equal(calls,2);
 assert.equal((await updates.state()).automatic,false);assert.equal((await updates.state()).latest.version,'1.0.2');
 assert.equal((await new AppUpdates(root,'1.0.2').state()).latest,null);
});
test('Offline and rate-limited update checks never claim success or advance the last successful timestamp',async t=>{
 const root=await fixture(t);let fail=false;
 const updates=new AppUpdates(root,'1.0.0',{platform:'win32',arch:'x64',fetch:async()=>{if(fail)throw Error('offline');return Response.json(release('1.0.0'));}});
 const saved=await updates.check(true);assert.equal(saved.latest,null);fail=true;await assert.rejects(updates.check(true),/GitHub/);assert.equal((await updates.state()).checkedAt,saved.checkedAt);
 const limited=new AppUpdates(root,'1.0.0',{platform:'win32',arch:'x64',fetch:async()=>new Response('',{status:429})});await assert.rejects(limited.check(true),/请求受限/);
 const missing=new AppUpdates(root,'1.0.0',{platform:'win32',arch:'x64',fetch:async()=>new Response('',{status:404})});await assert.rejects(missing.check(true),/正式版本/);
});

test('Rate-limited public API falls back to the stable release redirect and verifies the Windows download',async t=>{
 const root=await fixture(t),calls=[];
 const updates=new AppUpdates(root,'1.0.0',{platform:'win32',arch:'x64',fetch:async(url,options)=>{calls.push([url,options?.method]);if(url.includes('api.github.com'))return new Response('',{status:403});if(url.endsWith('/latest'))return new Response(null,{status:302,headers:{location:'https://github.com/JJl624/Moyu/releases/tag/v1.0.1'}});return new Response(null,{status:200,headers:{'content-length':'100'}});}});
 assert.equal((await updates.check(true)).latest.version,'1.0.1');assert.equal(calls.length,3);assert.equal(calls[2][1],'HEAD');
});
test('Update fallback refuses foreign redirects and unavailable executables',async t=>{
 for(const foreign of [true,false]){const root=await fixture(t);const updates=new AppUpdates(root,'1.0.0',{platform:'win32',arch:'x64',fetch:async url=>url.includes('api.github.com')?new Response('',{status:429}):url.endsWith('/latest')?new Response(null,{status:302,headers:{location:foreign?'https://example.com/releases/tag/v1.0.1':'https://github.com/JJl624/Moyu/releases/tag/v1.0.1'}}):new Response('',{status:404})});await assert.rejects(updates.check(true),foreign?/版本信息/:/下载文件/);assert.equal((await updates.state()).checkedAt,0);}
});

test('Failed automatic checks wait a day before retrying; an explicit check remains available',async t=>{
 const root=await fixture(t);let calls=0;const updates=new AppUpdates(root,'1.0.0',{platform:'win32',arch:'x64',fetch:async()=>{calls++;throw Error('offline');}});
 await assert.rejects(updates.check(),/GitHub/);const count=calls,saved=await updates.state();assert.equal(saved.checkedAt,0);assert(saved.attemptedAt>0);
 await updates.check();assert.equal(calls,count);await assert.rejects(updates.check(true),/GitHub/);assert.equal(calls,count*2);
});

test('Linux release checks require an asset for the current architecture and accept AppImage or DEB',()=>{
 const make=(name)=>({tag_name:'v1.0.1',assets:[{name,state:'uploaded',size:100,browser_download_url:'https://github.com/JJl624/Moyu/releases/download/v1.0.1/'+name}]});
 for(const name of ['Moyu-1.0.1-x86_64.AppImage','Moyu-1.0.1-amd64.deb'])assert.equal(releaseInfo(make(name),'linux','x64').version,'1.0.1');
 assert.equal(releaseInfo(make('Moyu-1.0.1-arm64.AppImage'),'linux','arm64').version,'1.0.1');
 for(const name of ['Moyu-1.0.1-x64.exe','Moyu-1.0.1-arm64.AppImage'])assert.throws(()=>releaseInfo(make(name),'linux','x64'),/Linux/);
});

test('Linux update filenames agree with the pinned builder for every supported target architecture',()=>{
 const {Arch,getArtifactArchName}=require('builder-util');
 for(const arch of ['x64','ia32','arm64','armv7l']){
  const built=['AppImage','deb'].map(ext=>`Moyu-1.0.1-${getArtifactArchName(Arch[arch],ext)}.${ext}`);
  assert.deepEqual(releaseAssets('1.0.1','linux',arch),built);
 }
});

test('Linux update fallback validates the DEB when the AppImage is not published',async t=>{
 const root=await fixture(t),downloads=[];
 const updates=new AppUpdates(root,'1.0.0',{platform:'linux',arch:'x64',fetch:async url=>{
  if(url.includes('api.github.com'))return new Response('',{status:429});
  if(url.endsWith('/latest'))return new Response(null,{status:302,headers:{location:'https://github.com/JJl624/Moyu/releases/tag/v1.0.1'}});
  downloads.push(url);return url.endsWith('.deb')?new Response(null,{headers:{'content-length':'100'}}):new Response(null,{status:404});
 }});
 assert.equal((await updates.check(true)).latest.version,'1.0.1');assert.deepEqual(downloads.map(url=>url.split('/').pop()),['Moyu-1.0.1-x86_64.AppImage','Moyu-1.0.1-amd64.deb']);
});

test('A Linux development build remains up to date when the older stable release only has Windows assets',async t=>{
 const root=await fixture(t),updates=new AppUpdates(root,'1.0.6',{platform:'linux',arch:'x64',fetch:async()=>Response.json(release('1.0.0'))});
 const saved=await updates.check(true);assert.equal(saved.latest,null);assert(saved.checkedAt>0);
});
