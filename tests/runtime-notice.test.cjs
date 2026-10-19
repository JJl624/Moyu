const { test } = require('node:test'), assert = require('node:assert/strict');
const { runtimeNotice } = require('../shared/runtime-notice.mjs');
test('Environment and package actions share precise feedback without labelling a query as an installation', () => {
  for (const action of ['install', 'install-runtime', 'install-package']) {
    assert.equal(runtimeNotice(action), '已安装');
  }
  for (const action of ['refresh', 'refresh-versions', 'refresh-packages']) {
    assert.equal(runtimeNotice(action), '已刷新');
  }
  for (const action of ['import', 'import-files', 'import-runtime', 'import-package']) {
    assert.equal(runtimeNotice(action), '已导入');
  }
  assert.equal(runtimeNotice('remove-package'), '已卸载');
  assert.equal(runtimeNotice('remove-runtime'), '已删除');
  assert.equal(runtimeNotice('state'), '');
  assert.equal(runtimeNotice('configure'), '');
});
