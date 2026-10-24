const {test}=require('node:test');
const assert=require('node:assert/strict');
const {syncDecision}=require('../shared/sync-decision.mjs');
test('Mobile sync compares initial copies and never propagates a deletion without a choice',()=>{
  assert.equal(syncDecision('a','tag'), 'compare');
  assert.equal(syncDecision('a',null), 'upload');
  assert.equal(syncDecision(null,'tag'), 'download');
  const base={localHash:'a',remoteEtag:'tag'};
  for(const [local,remote] of [['a',null],[null,'tag']])assert.equal(syncDecision(local,remote,base),'conflict');
  assert.equal(syncDecision(null,null,base),'unchanged');
  assert.equal(syncDecision('a','tag',base),'unchanged');
  assert.equal(syncDecision('b','tag',base),'upload');
  assert.equal(syncDecision('a','newtag',base),'download');
  assert.equal(syncDecision('b','newtag',base),'compare');
});
