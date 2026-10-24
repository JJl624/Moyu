import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import {davServer} from './helpers/dav-server.cjs';
const dav=await davServer();dav.files.set('/original.md',Buffer.from('原文\n第二行'));dav.delay({method:'GET',path:'/slow',ms:10000});
dav.fail({method:'PROPFIND',path:'/limited',status:503,headers:{'Retry-After':'120'},times:100});
const server=https.createServer({pfx:fs.readFileSync(process.env.MOYU_TEST_PFX),passphrase:'test-only'},(request,response)=>{
  if(request.url.startsWith('/__test/')){
    if(request.headers.authorization!=='Basic '+Buffer.from('user:secret').toString('base64')){response.writeHead(401);response.end();return;}
    if(request.method==='GET'&&request.url==='/__test/state'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({files:Object.fromEntries([...dav.files].map(([name,bytes])=>[name,bytes.toString('utf8')])),requests:dav.requests}));return;}
    if(request.method==='POST'){
      const chunks=[];request.on('data',chunk=>chunks.push(chunk));request.on('end',()=>{
        try{const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if(request.url==='/__test/file')dav.files.set(input.path,Buffer.from(input.content));
          else if(request.url==='/__test/fail')dav.fail(input);
          else if(request.url==='/__test/delay')dav.delay(input.method?input:{method:'GET',path:'/slow',ms:10000});
          else{response.writeHead(404);response.end();return;}
          response.writeHead(200);response.end('{}');
        }catch{response.writeHead(400);response.end();}
      });return;
    }
    response.writeHead(404);response.end();return;
  }
  const upstream=http.request(dav.url+request.url,{method:request.method,headers:request.headers},incoming=>{response.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(response);});
  upstream.on('error',()=>{response.writeHead(502);response.end();});response.on('close',()=>upstream.destroy());request.pipe(upstream);
});
server.listen(18443,'127.0.0.1',()=>console.log('HTTPS WebDAV fixture ready'));
const close=()=>{server.close();server.closeAllConnections();void dav.close();};process.on('SIGINT',close);process.on('SIGTERM',close);
