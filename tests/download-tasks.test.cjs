const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {DownloadTasks,readDownload}=require('../electron/download-tasks.cjs');
const {PythonManager}=require('../electron/python.cjs');
const {JavaScriptPackages}=require('../electron/javascript-packages.cjs');
const {ManagedRuntimes}=require('../electron/managed-runtimes.cjs');
test('download progress uses actual bytes, unknown/compressed lengths and bounded buffers',async()=>{
 const states=[],tasks=new DownloadTasks(s=>states.push(s));
 await tasks.run('a','test',j=>readDownload(new Response('1234',{headers:{'content-length':'4'}}),8,j,'file'));
 assert(states.some(s=>s.total===4&&s.received===4));assert.equal(tasks.state('a').status,'completed');
 await tasks.run('a','test',j=>readDownload(new Response('123456',{headers:{'content-length':'2','content-encoding':'gzip'}}),8,j,'compressed'));
 assert.equal(tasks.state('a').received,6);assert.equal(tasks.state('a').total,null);
 await assert.rejects(tasks.run('a','test',j=>readDownload(new Response('12345'),4,j,'large')),/大小限制/);
 assert.equal(tasks.state('a').status,'failed');
});
test('cancellation rejects stale IDs, waits for rollback on close and allows retry',async()=>{
 const tasks=new DownloadTasks();let cleaned=false;
 const pending=tasks.run('a','test',async j=>{try{await new Promise(resolve=>j.controller.signal.addEventListener('abort',resolve,{once:true}));j.check();}finally{await new Promise(r=>setTimeout(r,5));cleaned=true;}});
 const rejected=assert.rejects(pending,e=>e.code==='DOWNLOAD_CANCELLED');
 assert.equal(tasks.cancel('a','old'),false);tasks.cancel('a',tasks.state('a').id);await rejected;assert(cleaned);assert.equal(tasks.state('a').status,'cancelled');
 await tasks.run('a','retry',async j=>{j.commit();assert.equal(tasks.cancel('a',j.state.id),false);});assert.equal(tasks.state('a').status,'completed');
 await tasks.close();await assert.rejects(tasks.run('a','after close',()=>{}),e=>e.code==='DOWNLOAD_CANCELLED');
});
test('a stalled stream publishes its trailing byte update; shutdown awaits cleanup of active jobs',async()=>{
 const states=[],tasks=new DownloadTasks(s=>states.push(s));let cleaned=false;
 const rejected=assert.rejects(tasks.run('a','test',async job=>{
  job.file('file',100);job.advance(10);await new Promise(r=>setTimeout(r,150));assert(states.some(s=>s.received===10));
  try{await new Promise(r=>job.controller.signal.addEventListener('abort',r,{once:true}));job.check();}finally{await new Promise(r=>setTimeout(r,5));cleaned=true;}
 }),e=>e.code==='DOWNLOAD_CANCELLED');
 await new Promise(r=>setTimeout(r,180));await tasks.close();await rejected;assert(cleaned);assert.equal(tasks.state('a').status,'cancelled');
});
test('Python cancellation rolls back completed dependency files and leaves installation metadata unchanged',async()=>{
 const root=await fs.mkdtemp(path.resolve(__dirname,'../../../work/download-python-')),tasks=new DownloadTasks();
 const manager=new PythonManager(root,{downloads:tasks}),dir=manager.directory('1.0.0');await fs.mkdir(dir,{recursive:true});
 const bytes=Buffer.from('wheel'),sha=createHash('sha256').update(bytes).digest('hex');
 const catalog={info:{python:'3.14'},packages:{dependency:{file_name:'dependency.whl',depends:[],sha256:sha},example:{file_name:'example.whl',depends:['dependency'],sha256:sha}}};
 await fs.writeFile(path.join(manager.root,'settings.json'),JSON.stringify({selected:'1.0.0',installed:['1.0.0'],mirror:0,mirrors:[{name:'test',base:'https://test/',index:'https://test/',layout:'version'}]}));
 await fs.writeFile(path.join(dir,'catalog.json'),JSON.stringify(catalog));let started;const ready=new Promise(r=>started=r);
 manager.fetch=async(url,{signal})=>String(url).endsWith('dependency.whl')?new Response(bytes):new Response(new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,2));started();signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});}}));
 const pending=assert.rejects(manager.installPackage({name:'example'}),e=>e.code==='DOWNLOAD_CANCELLED');await ready;tasks.cancel('python',tasks.state('python').id);await pending;
 assert.equal(await fs.stat(path.join(dir,'dependency.whl')).catch(()=>null),null);assert.equal(await fs.stat(path.join(dir,'packages.json')).catch(()=>null),null);
 manager.fetch=async()=>new Response(bytes);await manager.installPackage({name:'example'});assert.deepEqual((await manager.state()).packages.filter(p=>p.installed).map(p=>p.name),['dependency','example']);
});
test('npm and language runtime cancellation remove staging without publishing a version',async()=>{
 for(const kind of ['npm','sql']){
  const root=await fs.mkdtemp(path.resolve(__dirname,'../../../work/download-'+kind+'-')),tasks=new DownloadTasks(),manager=kind==='npm'?new JavaScriptPackages(root,tasks):new ManagedRuntimes(root,tasks);
  let started;const ready=new Promise(r=>started=r);
  manager.npm.installTree=async(_name,_version,dir)=>{await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'partial'),'partial');started();const job=manager.npm.options.job;await new Promise(resolve=>job.controller.signal.addEventListener('abort',resolve,{once:true}));job.check();};
  const pending=assert.rejects(manager.install(kind==='npm'?{name:'example',version:'1.0.0'}:{language:'sql',version:'1.14.2'}),e=>e.code==='DOWNLOAD_CANCELLED');await ready;const scope=kind==='npm'?'javascript':'runtime:sql';tasks.cancel(scope,tasks.state(scope).id);await pending;
  assert.deepEqual(await fs.readdir(path.join(manager.root,kind==='npm'?'staging':'sql/staging')),[]);
  if(kind==='npm')assert.deepEqual((await manager.state()).packages,{});else assert.deepEqual((await manager.state('sql')).installed,[]);
 }
});
