const {test}=require('node:test'),assert=require('node:assert/strict'),{canWriteUiClipboard}=require('../electron/ui-permissions.cjs');
test('Browser clipboard writing is limited to the trusted main UI and exact configured development origin',()=>{
  const owner={},details={isMainFrame:true,requestingUrl:'moyu://app/index.html'};
  assert.equal(canWriteUiClipboard(owner,owner,'clipboard-sanitized-write',details),true);
  assert.equal(canWriteUiClipboard(owner,owner,'clipboard-sanitized-write',{...details,requestingUrl:'http://localhost:5173/index.html'},'http://localhost:5173'),true);
  assert.equal(canWriteUiClipboard(owner,owner,'clipboard-sanitized-write',{...details,requestingUrl:'http://localhost:5174/index.html'},'http://localhost:5173'),false);
});
test('PDF/HTML content frames, other windows, clipboard reading and unknown requests do not receive write permission',()=>{
  const owner={},details={isMainFrame:true,requestingUrl:'moyu://app/index.html'};
  for(const url of ['moyu-html://app/1','moyu-preview://app/1','https://example.com','moyu://app.evil/index.html','data:text/html,test','file:///index.html','moyu://user@app/index.html'])assert.equal(canWriteUiClipboard(owner,owner,'clipboard-sanitized-write',{...details,requestingUrl:url}),false,url);
  for(const permission of ['clipboard-read','deprecated-sync-clipboard-read','media','unknown'])assert.equal(canWriteUiClipboard(owner,owner,permission,details),false);
  assert.equal(canWriteUiClipboard(owner,owner,'clipboard-sanitized-write',{...details,isMainFrame:false}),false);
  assert.equal(canWriteUiClipboard({},owner,'clipboard-sanitized-write',details),false);
  assert.equal(canWriteUiClipboard(null,null,'clipboard-sanitized-write',details),false);
  assert.equal(canWriteUiClipboard(owner,owner,'clipboard-sanitized-write',undefined),false);
});
