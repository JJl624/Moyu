const {test}=require('node:test'),assert=require('node:assert/strict');
const editorModule=require('./helpers/editor-module.cjs');

test('Caption entry targets the Markdown name for image and ordinary links',async()=>{
  const {inlineLinkLabelOffset:offset}=await editorModule('../inlineSyntax.ts');
  for(const [raw,want]of [['![图片](a.png)',2],['[乐谱](a.alphatex)',1],['![](a.png)',2],['[](a.pdf)',1],['![中\\]文|90](a.png)',2],['[**名称**](a.pdf)',1],['文字',0]])assert.equal(offset(raw),want,raw);
});
