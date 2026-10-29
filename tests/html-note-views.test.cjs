const {test}=require('node:test'),assert=require('node:assert/strict');
const {HTMLFileViews}=require('../electron/html-file-views.cjs');
test('Inline HTML views have their own script policy, cannot read sibling files and expire on close or vault switch',async()=>{
  let resolves=0,current={resolve:async path=>{resolves++;return '/vault/'+path;}};
  const views=new HTMLFileViews(()=>current),view=await views.openInline({path:'note.md',content:'<button onclick="this.textContent=1">0</button>'});
  const response=await views.response(new Request(view.url));assert.equal(response.status,200);assert.match(response.headers.get('Content-Security-Policy'),/connect-src 'none'/);assert.match(response.headers.get('Content-Security-Policy'),/script-src 'unsafe-inline'/);
  assert.equal((await views.response(new Request(view.url.replace('index.html','other.js')))).status,404);assert.equal(resolves,1);
  current={resolve:async path=>'/other/'+path};assert.equal((await views.response(new Request(view.url))).status,404);views.close(view.token);assert.equal(views.views.size,0);
});
test('Opening ordinary HTML files cannot silently evict active inline note views',async()=>{
  const views=new HTMLFileViews(()=>vault),vault={resolve:async path=>'/vault/'+path};
  const inline=await views.openInline({path:'note.md',content:'<p>笔记</p>'});for(let index=0;index<10;index++)await views.open({path:index+'.html',content:'<p>页面</p>'});
  assert.equal((await views.response(new Request(inline.url))).status,200);assert.equal(views.views.size,9);await assert.rejects(()=>views.openInline({path:'data.json',content:'x'}));
});
