const test=require('node:test'),assert=require('node:assert/strict');
test('Conflict highlighting preserves both versions and marks only changes, including Unicode and empty documents',async()=>{
 const {compareText}=await import('../shared/content-diff.mjs');
 for(const [left,right] of [['相同\n保持\n','相同\n保持\n'],['a old z\n','a new z\n'],['第一行\n删除\n尾部','第一行\n新增\n尾部'],['','新增'],['删除',''],['😀 x','😀 y'],['a\nb\nc','a\nc'],['x\n'.repeat(3000)+'tail','y\n'.repeat(3000)+'tail']]){
  const diff=compareText(left,right);assert.equal(diff.left.map(p=>p.value).join(''),left);assert.equal(diff.right.map(p=>p.value).join(''),right);
  if(left===right)assert(!diff.left.some(p=>p.changed));else assert(diff.left.some(p=>p.changed)||diff.right.some(p=>p.changed));
 }
 const diff=compareText('保持 old 尾部','保持 new 尾部');assert.equal(diff.left.filter(p=>p.changed).map(p=>p.value).join(''),'old');assert.equal(diff.right.filter(p=>p.changed).map(p=>p.value).join(''),'new');
});
