const {test}=require('node:test'),assert=require('node:assert/strict');
test('PDF reading positions are bounded, validated and independent for each vault/file pair',async()=>{
  const {viewerPages,rememberViewerPage}=await import('../shared/attachment-view-state.mjs');
  const a=JSON.stringify(['vault-a','资料.pdf']),b=JSON.stringify(['vault-b','资料.pdf']);
  const rows=rememberViewerPage(rememberViewerPage([],a,2),b,8);assert.deepEqual(rows,[[a,2],[b,8]]);
  assert.deepEqual(rememberViewerPage(rows,a,3),[[b,8],[a,3]]);assert.deepEqual(viewerPages([[a,2],[a,7]]),[[a,7]]);
  for(const invalid of [null,{},[null,['x',0],['x',1.5],[4,2],['x',Infinity]]])assert.deepEqual(viewerPages(invalid),[]);
  let many=[];for(let i=0;i<300;i++)many=rememberViewerPage(many,String(i),i+1);assert.equal(many.length,256);assert.deepEqual(many[0],['44',45]);
  assert.deepEqual(rememberViewerPage(rows,a,-1),rows);
});

test('Synchronized view preferences validate supported fields without truncating a document’s attachment map',async()=>{
  const {attachmentView,attachmentViews}=await import('../shared/attachment-view-state.mjs');
  const valid={imageWindowWidth:640,imageWindowHeight:480,height:320,pdfPage:8,pdfZoom:'fit-width',pdfSpread:'even',pdfScroll:'horizontal',pdfRotation:3,pdfPan:false,pdfSidebar:{placement:'left',slot:'main',id:'document',open:true,tab:'outline'},scoreZoom:.7,scoreLayout:'horizontal',scoreTrack:0,scoreSpeed:1.5,scoreVolume:0,scoreLoop:true,scoreMetronome:false,scorePosition:2500,imageZoom:'fit',imageRotation:270};
  assert.deepEqual(attachmentView(valid),valid);assert.deepEqual(attachmentView({height:0,imageZoom:1.375,pdfZoom:.05}),{height:0,pdfZoom:.05,imageZoom:1.375});
  for(const value of [null,[],{height:40,pdfPage:1.5,pdfZoom:Infinity,pdfSpread:'book',pdfScroll:'diagonal',pdfRotation:4,pdfPan:'yes',pdfSidebar:{open:true},scoreZoom:0,scoreSpeed:8,scoreVolume:101,scorePosition:-1,scoreTrack:512,imageRotation:45,imageZoom:20},{futureField:'ignore'}])assert.deepEqual(attachmentView(value),{});
  const rows=Object.fromEntries(Array.from({length:1200},(_,i)=>[i+'.svg',{imageRotation:90}]));assert.equal(Object.keys(attachmentViews(rows)).length,1200);
  assert.deepEqual(attachmentViews(JSON.parse('{"__proto__":{"imageRotation":90},"constructor":{"height":300},"":{"height":300}}')),{});
});
