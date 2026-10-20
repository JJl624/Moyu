const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {ApplicationConfig}=require('../electron/application-config.cjs');
const {DataStore}=require('../electron/data.cjs');
const {RuntimeSettings}=require('../electron/runtime-settings.cjs');
const {Connections}=require('../electron/connections.cjs');
const base=path.resolve(__dirname,'../../../work/application-config-tests');
async function fixture(t){await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'case-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from('encrypted:'+value),decryptString:bytes=>bytes.toString().slice(10)};

test('Windows lock-directory contention retries without failing a completed write or removing a new owner',{skip:process.platform!=='win32'},async t=>{
 const root=await fixture(t),file=path.join(root,'settings.json'),lock=file+'.lock';
 const {configLock}=require('../electron/config-lock.cjs'),original=fs.rmdir;
 await fs.mkdir(lock);let denied=false;
 fs.rmdir=async(directory,...args)=>{
  if(directory===lock&&!denied){denied=true;throw Object.assign(Error('directory changed'),{code:'EPERM'});}
  return original(directory,...args);
 };
 let release;
 try{release=await configLock(file);}finally{fs.rmdir=original;}
 assert(denied);
 const newOwner=path.join(lock,'owner-'+process.pid+'-new');let changed=false;
 fs.rmdir=async(directory,...args)=>{
  if(directory===lock&&!changed){changed=true;await fs.mkdir(newOwner);throw Object.assign(Error('new writer'),{code:'EPERM'});}
  return original(directory,...args);
 };
 try{await release();}finally{fs.rmdir=original;}
 assert.deepEqual(await fs.readdir(lock),[path.basename(newOwner)]);
});

test('All application owners serialize into one file without losing concurrent sections or workspace credentials',async t=>{
 const root=await fixture(t),config=new ApplicationConfig(root);
 assert.deepEqual(await config.get('workspace'),{});assert.deepEqual(await fs.readdir(root),[]);
 const jobs=[];
 for(let i=0;i<12;i++)jobs.push(new DataStore(root).set({key:'moyu-test-'+i,value:String(i)}));
 for(const kind of ['javascript','sql','lua'])jobs.push(new RuntimeSettings(root).configure(kind,{executionTimeoutSeconds:19}));
 for(const vault of ['one','two','three'])jobs.push(new Connections(root,safeStorage).save(vault,'webdav',{url:'https://example.com/dav',password:'secret-'+vault}));
 jobs.push(config.set('workspace',{root:'/notes',recent:[{root:'/notes'}]}));
 await Promise.all(jobs);
 assert.deepEqual(await fs.readdir(root),['settings.json']);
 const saved=JSON.parse(await fs.readFile(config.file,'utf8'));
 assert.equal(Object.keys(saved.values).length,12);assert.equal(saved.code.sql.executionTimeoutSeconds,19);assert.equal(saved.workspace.root,'/notes');assert.equal(Object.keys(saved.connections).length,3);
 for(const vault of ['one','two','three']){
  const connections=new Connections(root,safeStorage);
  assert.equal((await connections.get(vault,true)).webdav.password,'secret-'+vault);
  assert.equal((await connections.get(vault)).webdav.password,undefined);
 }
 assert(Object.values(saved.connections).every(item=>Object.hasOwn(item.webdav,'password')&&!Object.hasOwn(item.webdav,'secret')));
 assert.equal((await new DataStore(root).get())['moyu-test-11'],'11');
});

test('A failed write leaves every section intact, does not poison other owners and can be retried',async t=>{
 const root=await fixture(t),config=new ApplicationConfig(root),store=new DataStore(root);
 await config.set('workspace',{root:'/saved'});
 const before=await fs.readFile(config.file,'utf8'),write=fs.writeFile;
 fs.writeFile=async(file,...args)=>{if(path.dirname(String(file))===root)throw Object.assign(Error('disk full'),{code:'ENOSPC'});return write(file,...args);};
 try{await assert.rejects(store.set({key:'moyu-theme',value:'dark'}),/disk full/);}finally{fs.writeFile=write;}
 assert.equal(await fs.readFile(config.file,'utf8'),before);
 await store.set({key:'moyu-theme',value:'light'});
 assert.equal((await new ApplicationConfig(root).get('workspace')).root,'/saved');
 assert.equal((await new DataStore(root).get())['moyu-theme'],'light');
 assert.deepEqual(await fs.readdir(root),['settings.json']);
});

test('Invalid configuration is reported without being overwritten; fixing it unblocks subsequent writes',async t=>{
 const root=await fixture(t),config=new ApplicationConfig(root);
 await fs.writeFile(config.file,'broken');
 await assert.rejects(config.set('workspace',{}));assert.equal(await fs.readFile(config.file,'utf8'),'broken');
 await fs.writeFile(config.file,'{"version":1,"workspace":{"root":"/restored"}}');
 await new DataStore(root).set({key:'moyu-theme',value:'light'});
 assert.equal((await config.get('workspace')).root,'/restored');
});

test('Independent editor processes retain simultaneous edits and recover only a dead owner lock',async t=>{
 const root=await fixture(t),config=new ApplicationConfig(root);
 const lock=config.file+'.lock';await fs.mkdir(path.join(lock,'owner-2147483647-dead'),{recursive:true});
 await config.set('workspace',{root:'/notes'});assert.equal(await fs.stat(lock).catch(()=>null),null);
 await fs.mkdir(lock);await config.set('workspace',{root:'/notes-2'});assert.equal(await fs.stat(lock).catch(()=>null),null);
 const {execFile}=require('node:child_process'),{promisify}=require('node:util');
 const run=promisify(execFile),moduleFile=require.resolve('../electron/data.cjs');
 const code=`const {DataStore}=require(process.argv[1]);const store=new DataStore(process.argv[2]);(async()=>{for(let i=0;i<20;i++)await store.set({key:'moyu-'+process.argv[3]+'-'+i,value:String(i)});})().catch(e=>{console.error(e);process.exitCode=1;});`;
 await Promise.all(['first','second'].map(name=>run(process.execPath,['-e',code,moduleFile,root,name],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}})));
 assert.equal(Object.keys(await config.get('values')).length,40);
 assert.equal((await config.get('workspace')).root,'/notes-2');
 assert.deepEqual(await fs.readdir(root),['settings.json']);
});

test('Saving unchanged local credentials does not acquire a lock or write the shared file',async t=>{
 const root=await fixture(t),connections=new Connections(root,{...safeStorage,encryptString:value=>Buffer.from(value+Math.random()),decryptString:()=> 'password'});
 const input={url:'https://example.com/dav',password:'password'};
 await connections.save('notes','webdav',input);
 const before=await fs.stat(connections.file()),bytes=await fs.readFile(connections.file(),'utf8');
 await connections.save('notes','webdav',input);
 assert.equal((await fs.stat(connections.file())).mtimeMs,before.mtimeMs);
 assert.equal(await fs.readFile(connections.file(),'utf8'),bytes);
 assert.deepEqual(await fs.readdir(root),['settings.json']);
});

test('Existing encrypted credentials can be read, saved locally, replaced or cleared without a working keyring',async t=>{
 const root=await fixture(t),config=new ApplicationConfig(root),connections=new Connections(root,safeStorage),key=connections.key('vault');
 const old={url:'https://example.com/dav',directory:'/Moyu',username:'u',secret:Buffer.from('encrypted:old-password').toString('base64')};
 await config.set('connections',{[key]:{webdav:old}});
 assert.equal((await connections.get('vault',true)).webdav.password,'old-password');
 await connections.save('vault','webdav',{url:old.url});
 const saved=(await config.get('connections'))[key].webdav;
 assert.equal(saved.password,'old-password');assert.equal(saved.secret,undefined);
 assert.equal((await new Connections(root).get('vault',true)).webdav.password,'old-password');
 await config.set('connections',{[key]:{webdav:old}});
 const unavailable=new Connections(root,{decryptString(){throw Error('locked');}});
 await assert.rejects(unavailable.get('vault',true),/重新输入/);
 await unavailable.save('vault','webdav',{url:old.url,password:'replacement'});
 assert.equal((await unavailable.get('vault',true)).webdav.password,'replacement');
 await config.set('connections',{[key]:{webdav:old}});
 await unavailable.save('vault','webdav',{url:old.url,clearPassword:true});
 assert.equal((await unavailable.get('vault',true)).webdav.password,'');
 assert.equal((await config.get('connections'))[key].webdav.secret,undefined);
});
