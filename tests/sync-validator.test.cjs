const {test}=require('node:test'),assert=require('node:assert/strict');const {validator,strong,sameToken}=require('../electron/sync-validator.cjs');
test('Server tokens retain their original quoting; weak, wildcard and malformed validators never authorize writes',()=>{
 for(const value of ['"token"','token','123456789'])assert.equal(validator(value),value);
 for(const value of ['*','W/"weak"','w/weak','a,b','a\nb','"unclosed',null,123])assert.equal(validator(value),null);
 assert(strong('"a"'));assert(!strong('a'));assert(sameToken('"a"','a'));assert(!sameToken('a','b'));
});
