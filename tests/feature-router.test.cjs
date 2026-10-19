const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createFeatureRouter}=require('../electron/features/index.cjs');

function fixture(){
  let vault={root:'first',list:async()=>({root:'first'})};
  const calls=[],events=[];
  const services={
    get vault(){return vault;},
    window:{webContents:{send:(...args)=>events.push(args),setIgnoreMenuShortcuts:value=>calls.push(['focus',value])}},
    hostTerminal:{open:input=>{calls.push(['open',input]);return input;},list:()=>['session']},
    drawings:{create:input=>input,read:path=>path},
    codeData:{context:async()=>({files:[],directory:'/data'}),persist:async(...args)=>calls.push(['persist',...args])},
    codeRunner:{run:async input=>({output:input.code,error:'',artifacts:[],dataFiles:[]}),reset:async language=>calls.push(['reset',language])},
    resultStore:{retain:value=>value},
    managedRuntimes:{install:async input=>{calls.push(['install',input]);return input;}},
  };
  const router=createFeatureRouter(services,{'data.probe':input=>input});
  return{services,router,calls,events,switchVault:()=>{vault={root:'second',list:async()=>({root:'second'})};}};
}

test('Cached feature routes receive each request and read the current workspace',async()=>{
  const f=fixture();
  assert.deepEqual(await f.router('terminal.open',{cols:80}),{cols:80,cwd:'first'});
  f.switchVault();
  assert.deepEqual(await f.router('terminal.open',{cols:120}),{cols:120,cwd:'second'});
  assert.deepEqual(await f.router('terminal.open',{cwd:'custom'}),{cwd:'custom'});
  assert.deepEqual(await f.router('data.probe',{id:'one'}),{id:'one'});
  assert.deepEqual(await f.router('data.probe',{id:'two'}),{id:'two'});
  for(const action of ['__proto__','constructor','toString','unknown'])await assert.rejects(f.router(action),/不支持这个操作/);
});

test('Drawing updates notify once; reads and terminal queries do not trigger workspace updates',async()=>{
  const f=fixture();
  await f.router('drawing.read',{path:'drawing.excalidraw'});await f.router('terminal.list');assert.equal(f.events.length,0);
  await f.router('drawing.create',{name:'drawing'});assert.deepEqual(f.events,[['moyu:changed',{root:'first'}]]);
  f.switchVault();await f.router('drawing.create',{name:'next'});assert.deepEqual(f.events[1],['moyu:changed',{root:'second'}]);
});

test('Code runs retain their captured data owner across a workspace change and skip memory-database persistence',async()=>{
  const f=fixture(),owner=f.services.codeData;
  f.services.codeRunner.run=async input=>{f.services.codeData={persist(){throw Error('wrong owner');}};f.switchVault();return{output:input.code,error:'',artifacts:[],dataFiles:[{name:'result.txt'}]};};
  const result=await f.router('code.run',{root:'first',code:'example',id:'0001'});
  assert.equal(result.output,'example');assert.equal(result.dataFiles,undefined);assert.equal(f.calls[0][0],'persist');
  await assert.rejects(f.router('code.run',{root:'first'}),/知识库已切换/);
  owner.context=async()=>({files:[],memory:true});f.services.codeData=owner;f.calls.length=0;
  await f.router('code.run',{code:'memory'});assert.equal(f.calls.length,0);
});

test('Runtime installation resets its sandbox before changing installed versions',async()=>{
  const f=fixture(),input={language:'ruby',version:'3.4.0-2.7.2'};
  assert.deepEqual(await f.router('runtime.install',input),input);
  assert.deepEqual(f.calls,[['reset','ruby'],['install',input]]);
});

test('A data persistence error stays in the run result rather than discarding its output',async()=>{
  const f=fixture();f.services.codeData.persist=async()=>{throw Error('disk unavailable');};
  const result=await f.router('code.run',{code:'42'});
  assert.equal(result.output,'42');assert.equal(result.error,'数据文件未保存：disk unavailable');
});

test('Invalid or unsupported arguments are rejected before creating a data directory or starting a runner',async()=>{
  const f=fixture();let prepared=0,runs=0;
  f.services.codeData.context=async()=>{prepared++;return{files:[]};};
  f.services.codeRunner.run=async input=>{runs++;assert.deepEqual(input.arguments,['','a b']);return{artifacts:[]};};
  for(const input of [{language:'py',arguments:['x'.repeat(1001)]},{language:'sql',arguments:['a']},{language:'js',arguments:['a']}])await assert.rejects(f.router('code.run',input),/参数/);
  assert.equal(prepared,0);assert.equal(runs,0);
  await f.router('code.run',{language:'py',arguments:['','a b']});assert.equal(prepared,1);assert.equal(runs,1);
});

test('A queued normalization from a previous workspace cannot update the current document map', async () => {
  const f=fixture(); let calls=0;
  f.services.attachments={documents:{sync:async()=>{calls++;return true;}}};
  await f.router('code.normalize',{root:'first',document:'A.md',content:'text'});assert.equal(calls,1);
  f.switchVault();await assert.rejects(f.router('code.normalize',{root:'first',document:'A.md',content:'old'}),/知识库已切换/);
  assert.equal(calls,1);
});
