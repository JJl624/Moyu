const {test}=require('node:test'),assert=require('node:assert/strict'),load=require('./helpers/editor-module.cjs');
const policy=load('../attachments/pdfReaderPolicy.ts');
test('PDF reader menus remove unavailable commands and collapse empty separator groups without mutating upstream schema',async()=>{
  const {pdfReaderMenus,pdfDisabledCategories}=await policy;
  const item=(id,category)=>({id,type:'command',commandId:id,categories:[category]}),divider=id=>({id,type:'divider'});
  const schema={menus:{document:{id:'document',items:[divider('first'),item('open','document-open'),divider('after-open'),item('print','document-print'),divider('a'),divider('b'),item('fit','zoom'),divider('last')]},nested:{id:'nested',items:[{id:'edit',type:'section',items:[item('note','annotation-comment')]},divider('empty'),{id:'read',type:'section',items:[item('find','panel-search'),divider('tail')]}]}}};
  const before=JSON.stringify(schema),menus=pdfReaderMenus(schema,pdfDisabledCategories(true));
  assert.deepEqual(menus.document.items.map(x=>x.id),['fit']);assert.deepEqual(menus.nested.items.map(x=>x.id),['read']);assert.deepEqual(menus.nested.items[0].items.map(x=>x.id),['find']);assert.equal(JSON.stringify(schema),before);
});
test('Standalone PDF reading retains print/export while blocking document editing and native viewer lifetime actions',async()=>{
  const {pdfReaderMenus,pdfDisabledCategories}=await policy;
  const ids=['document-print','document-export','document-protect','document-close','document-fullscreen'];const schema={menus:{file:{id:'file',items:ids.map(id=>({type:'command',id,commandId:id,categories:[id]}))}}};
  assert.deepEqual(pdfReaderMenus(schema,pdfDisabledCategories()).file.items.map(x=>x.id),['document-print','document-export']);
});
test('PDF toolbar removes mode overflow as well as hidden modes, and embedded document-menu remnants',async()=>{
  const {pdfReaderToolbar}=await policy;
  const item=id=>({type:'command-button',id,commandId:id});const items=[{id:'left-group',type:'group',items:[item('document-menu-button'),{id:'divider-1',type:'divider'},item('sidebar-button')]},item('mode-select-button'),item('mode-tabs'),item('overflow-tabs-button'),item('search-button')];
  const embedded=pdfReaderToolbar(items,true);assert.deepEqual(embedded.map(x=>x.id),['left-group','search-button']);assert.deepEqual(embedded[0].items.map(x=>x.id),['sidebar-button']);assert.equal(pdfReaderToolbar(items)[0].items.length,3);assert.equal(items.length,5);
});
