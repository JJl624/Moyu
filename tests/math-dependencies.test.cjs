const {test}=require('node:test'),assert=require('node:assert/strict'),{createRequire}=require('node:module'),path=require('node:path');
test('All formula renderers use patched KaTeX and ignore inherited trust',()=>{
 for(const name of ['rehype-katex','micromark-extension-math','mermaid','@mermaid-js/layout-elk','@excalidraw/mermaid-to-excalidraw']){
  const requireFor=createRequire(path.resolve(__dirname,'../node_modules',name,'package.json')),katex=requireFor('katex');assert.equal(requireFor('katex/package.json').version,'0.18.10',name);
  const before=Object.getOwnPropertyDescriptor(Object.prototype,'trust');
  try{Object.defineProperty(Object.prototype,'trust',{value:true,configurable:true,writable:true});const html=katex.renderToString(String.raw`\href{javascript:alert(1)}{x}`,{throwOnError:false});assert.doesNotMatch(html,/<a[^>]+href=["']javascript:/i,name);}finally{if(before)Object.defineProperty(Object.prototype,'trust',before);else delete Object.prototype.trust;}
 }
});
