const {test}=require('node:test'),assert=require('node:assert/strict');
test('Only explicit HTML file blocks join reference tracking and follow moves without Markdown escaping',async()=>{
  const {links,rewrite}=await import('../shared/reference-links.mjs');
  const source='```html {preview=pin previewHeight=238}\nsrc="./assets/demo (1).html"\n```\n\n```js\nsrc="./assets/demo (1).html"\n```';
  const references=await links(source);assert.equal(references.length,1);assert.equal(references[0].url,'./assets/demo (1).html');
  const rewritten=await rewrite(source,'note.md','assets/demo (1).html','assets/renamed (2).html');assert.match(rewritten,/src="assets\/renamed \(2\)\.html"/);assert.match(rewritten,/```js\nsrc="\.\/assets\/demo \(1\)\.html"/);assert.ok(!rewritten.includes('\\('));
});
test('Nested quotes, note moves, encoded spaces and quoted short paths keep their file meaning',async()=>{
  const {rewrite,links}=await import('../shared/reference-links.mjs');
  const source='> ```html\n> src="assets/my%20page.html"\n> ```';
  assert.equal((await links(source)).length,1);const moved=await rewrite(source,'note.md','note.md','folder/note.md');assert.match(moved,/src="\.\.\/assets\/my page.html"/);
  const short='```html\n"assets/page.html"\n```';assert.equal((await links(short))[0].url,'assets/page.html');assert.match(await rewrite(short,'note.md','assets/page.html','assets/new.html'),/"assets\/new.html"/);
});
