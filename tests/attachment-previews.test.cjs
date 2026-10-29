const {test}=require('node:test'),assert=require('node:assert/strict');
test('Every attachment uses standalone previews and inline references, on every supported platform',async()=>{
  const {attachmentPreviewKind:kind}=await import('../shared/attachment-previews.mjs');
  for(const platform of ['win32','android','linux','browser']) {
    for(const image of [true,false]){
      assert.equal(kind('图.excalidraw',{platform,image,standalone:true}),'drawing');
      assert.equal(kind('图.png',{image,platform,standalone:true}),'image');
      assert.equal(kind('图.png',{image,platform}),null);
      assert.equal(kind('图.excalidraw',{image,platform}),null);
    }
  }
});
test('New previews require a whole paragraph and Windows, including image-form references',async()=>{
  const {attachmentPreviewKind:kind}=await import('../shared/attachment-previews.mjs');
  for(const href of ['中文 文件.PDF#page=2','a.alphatex','a.atex','a.gp5','a.gpx','a.gp','a.musicxml','a.mxl']) {
    const expected=/pdf/i.test(href)?'pdf':'score';
    for(const image of [true,false]) {
      assert.equal(kind(href,{image,standalone:true,platform:'win32'}),expected);
      assert.equal(kind(href,{image,standalone:false,platform:'win32'}),null);
      assert.equal(kind(href,{image:false,standalone:true,platform:'android'}),null);
    }
  }
});
test('Paragraph, heading, mixed text and soft-break placement have explicit boundaries',async()=>{
  const {standaloneAttachment:alone}=await import('../shared/attachment-previews.mjs');
  assert.equal(alone({type:'paragraph',children:[{type:'link'}]}),true);
  assert.equal(alone({type:'paragraph',children:[{type:'imageReference'}]}),true);
  assert.equal(alone({type:'heading',children:[{type:'link'}]}),false);
  assert.equal(alone({type:'paragraph',children:[{type:'link'},{type:'text',value:'\n正文'}]}),false);
  assert.equal(alone({type:'paragraph',children:[{type:'link'},{type:'link'}]}),false);
  assert.equal(alone({type:'paragraph',children:[{type:'text',value:' '},{type:'image'},{type:'text',value:' '}]}),true);
});
test('Remote URLs, root paths and unrelated file suffixes do not become embedded documents',async()=>{
  const {attachmentPreviewKind:kind}=await import('../shared/attachment-previews.mjs');
  const options={platform:'win32',standalone:true};
  for(const href of ['https://example.com/a.pdf','https://example.com/a.png','#a.pdf','#a.svg','/a.pdf','file:///a.alphatex','a.pdf.bak','a.exe'])assert.equal(kind(href,options),null);
  assert.equal(kind('https://example.com/a.png',{...options,image:true}),'image');
});
