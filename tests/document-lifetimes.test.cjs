const { test } = require('node:test'), assert = require('node:assert/strict');
const { DocumentLifetimes } = require('../shared/document-lifetimes.mjs');
test('Closing and reopening an identical path invalidates its old asynchronous work', () => {
  const sessions = new DocumentLifetimes(), first = sessions.open('A.md'), other = sessions.open('B.md');
  sessions.close('A.md');
  const reopened = sessions.open('A.md');
  assert(!sessions.owns('A.md', first));
  assert(sessions.owns('A.md', reopened));
  assert(sessions.owns('B.md', other));
  assert(!sessions.owns('missing', undefined));
  sessions.clear();
  sessions.open('A.md');
  assert(!sessions.owns('A.md', reopened));
});
test('A completed move carries the document identity without allowing its previous path to own a new buffer', () => {
  const sessions = new DocumentLifetimes(), token = sessions.open('dir/A.md');
  sessions.rename(path => path.replace('dir/', 'next/'));
  assert(sessions.owns('next/A.md', token));
  assert(!sessions.owns('dir/A.md', token));
  sessions.open('dir/A.md');
  assert(!sessions.owns('dir/A.md', token));
});
