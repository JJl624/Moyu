const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {Vault}=require('../electron/vault.cjs'),{HTMLFileViews}=require('../electron/html-file-views.cjs');
test('HTML file previews preserve full documents and read only safe vault resources; closing and vault switching revoke access',async()=>{
 const root=await fs.mkdtemp(path.resolve(__dirname,'../../../work/html-files-'));await fs.mkdir(path.join(root,'网页'));await fs.mkdir(path.join(root,'.data'));
 await fs.writeFile(path.join(root,'网页','页面.html'),'disk');await fs.writeFile(path.join(root,'网页','style.css'),'body{margin:0}');await fs.writeFile(path.join(root,'.data','private.json'),'secret');
 let vault=new Vault(root);const views=new HTMLFileViews(()=>vault),content='<!doctype html><html lang="zh"><head><style>body{margin:0}</style></head><body>未保存</body></html>',view=await views.open({path:'网页/页面.html',content});
 let response=await views.response(new Request(view.url));assert.equal(await response.text(),content);assert(response.headers.get('Content-Security-Policy').includes('sandbox allow-scripts'));
 response=await views.response(new Request(new URL('style.css',view.url)));assert.equal(await response.text(),'body{margin:0}');assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');
 for(const relative of ['../.data/private.json','../secret.exe','%2e%2e%2f%2e%2e%2foutside.js'])assert.equal((await views.response(new Request(new URL(relative,view.url)))).status,404);
 views.close(view.token);assert.equal((await views.response(new Request(view.url))).status,404);
 const next=await views.open({path:'网页/页面.html',content});vault=new Vault(root);assert.equal((await views.response(new Request(next.url))).status,404);
 assert.equal(require('../shared/file-kind.mjs').fileKind('PAGE.HTML'),'html');
 const disk=await vault.read('网页/页面.html');await vault.save('网页/页面.html',content,disk.version);assert.equal((await vault.read('网页/页面.html')).content,content);
});
