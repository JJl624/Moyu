const test=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream'),{EventEmitter}=require('node:events');
const {publicAddress,destination,downloadRuntimeFile}=require('../electron/runtime-download.cjs');
test('Sandbox downloads reject host, private, link-local, mapped and rebound addresses before connecting',async()=>{
 for(const ip of ['0.0.0.0','10.0.0.1','127.0.0.1','169.254.169.254','172.16.1.1','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','fe80::1','fd00::1','2002:7f00:1::','2001::1'])assert.equal(publicAddress(ip),false,ip);
 for(const ip of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111'])assert.equal(publicAddress(ip),true,ip);
 for(const url of ['http://localhost/a','http://127.1/a','http://2130706433/a','http://[::1]/a','http://[::ffff:7f00:1]/a','file:///C:/secret'])await assert.rejects(destination(url));
 await assert.rejects(destination('https://rebound.example/a',async()=>[{address:'1.1.1.1',family:4},{address:'127.0.0.1',family:4}]));
 const abort=new AbortController(),pending=destination('https://slow.example/',()=>new Promise(()=>{}),abort.signal);abort.abort(new Error('DNS timeout'));await assert.rejects(pending,/DNS timeout/);
});
test('Public downloads pin vetted DNS addresses, revalidate redirects, and accept files above 20 MB',async()=>{
 let connections=0;
 const lookup=async()=>[{address:'1.1.1.1',family:4}];
 const request=(url,options,callback)=>{connections++;options.lookup(url.hostname,{all:true},(error,ips)=>{assert.equal(error,null);assert.equal(ips[0].address,'1.1.1.1');});const response=Readable.from([Buffer.from('ok')]);response.statusCode=200;response.headers={};queueMicrotask(()=>callback(response));return new EventEmitter();};
 assert.equal((await downloadRuntimeFile('https://public.example/data',{lookup,request})).toString(),'ok');
 await assert.rejects(downloadRuntimeFile('https://public.example/start',{lookup,request:(url,init,callback)=>{connections++;const response=Readable.from([]);response.statusCode=302;response.headers={location:'http://127.0.0.1/private'};queueMicrotask(()=>callback(response));return new EventEmitter();}}),/本机/);
 assert.equal(connections,2);
 const large=Buffer.alloc(21*1024*1024,65);
 const result=await downloadRuntimeFile('https://public.example/large',{lookup,request:(url,init,callback)=>{const response=Readable.from([large.subarray(0,20*1024*1024),large.subarray(20*1024*1024)]);response.statusCode=200;response.headers={'content-length':large.length};queueMicrotask(()=>callback(response));return new EventEmitter();}});assert.equal(result.length,large.length);assert(result.equals(large));
});
