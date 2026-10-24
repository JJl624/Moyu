const {test}=require('node:test');
const assert=require('node:assert/strict');
test('Empty tasks are preserved without placeholders, including nesting; escaped literals stay ordinary text',async()=>{
  const {unified}=await import('unified'),{default:parse}=await import('remark-parse'),{default:gfm}=await import('remark-gfm'),{default:empty}=await import('../shared/remark-empty-tasks.mjs');
  const processor=unified().use(parse).use(gfm).use(empty),source='- [ ]\n- [x]\n- parent\n  - [ ]\n- \\[ ]\n\n```text\n- [ ]\n```';
  const tree=processor.runSync(processor.parse(source),{value:source}),items=tree.children[0].children;
  assert.equal(items[0].checked,false);assert.deepEqual(items[0].children[0].children,[]);assert.equal(items[1].checked,true);assert.equal(items[2].children[1].children[0].checked,false);assert.equal(items[3].checked,null);assert.equal(items[3].children[0].children[0].value,'[ ]');assert.equal(tree.children[1].value,'- [ ]');
});
test('Empty task markers survive formatting and parsing without hidden text',async()=>{
  const {unified}=await import('unified'),{default:parse}=await import('remark-parse'),{default:gfm}=await import('remark-gfm'),{default:stringify}=await import('remark-stringify'),{default:empty}=await import('../shared/remark-empty-tasks.mjs');
  const processor=unified().use(parse).use(gfm).use(empty).use(stringify),result=String(processor.processSync('- [ ]\n- [x]\n'));
  assert.match(result,/\[ \]/);assert.match(result,/\[x\]/);assert.equal(/[\u200b\u00a0]/.test(result),false);const tree=processor.runSync(processor.parse(result),{value:result});assert.deepEqual(tree.children[0].children.map(item=>item.checked),[false,true]);
});
