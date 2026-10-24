const {test}=require('node:test');
const assert=require('node:assert/strict');
const {RequestBudget,retryAfterTime,requestBudget}=require('../shared/sync-requests.mjs');

test('Retry-After supports seconds and HTTP dates; invalid values never disable the default cooldown',()=>{
  const now=Date.parse('2026-10-24T00:00:00Z');assert.equal(retryAfterTime('120',now),now+120000);assert.equal(retryAfterTime('Sat, 24 Oct 2026 00:03:00 GMT',now),now+180000);assert.equal(retryAfterTime('bad',now),0);assert.equal(retryAfterTime(null,now),0);
});
test('A request budget paces parallel requests and shares cooldown across vaults using the same server account',()=>{
  const budget=new RequestBudget(100);assert.equal(budget.reserve(1000),0);assert.equal(budget.reserve(1000),100);assert.equal(budget.reserve(1000),200);
  const error=budget.limited(503,'120',1000);assert.equal(error.code,'RATE_LIMITED');assert.equal(error.retryAt,121000);assert.throws(()=>budget.reserve(2000),e=>e.code==='RATE_LIMITED');assert.equal(budget.reserve(121001),0);
  assert.equal(requestBudget('https://dav.example/one','user'),requestBudget('https://dav.example/two','user'));assert.notEqual(requestBudget('https://dav.example/','other'),requestBudget('https://dav.example/','user'));
});
test('Repeated unlabelled service failures increase cooldown rather than loop immediately',()=>{
  const budget=new RequestBudget();assert.equal(budget.limited(503,'',1000).retryAt,61000);assert.equal(budget.limited(503,'',62000).retryAt,182000);budget.success();assert.equal(budget.limited(503,'',200000).retryAt,440000);for(let i=0;i<20;i++)budget.success();assert.equal(budget.limited(429,'',500000).retryAt,560000);
});
