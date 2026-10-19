const { fault } = require('./vault.cjs');
const defaults = Object.freeze({
  onOpen: false, afterSave: false, interval: 0,
  includeCodeData: true, excludes: '', deletion: 'confirm',
  timeout: 60, retries: 2, concurrency: 2, maxFileMB: 128,
});
function policy(input = {}) {
  const value = { ...defaults };
  for (const key of ['onOpen', 'afterSave', 'includeCodeData']) {
    if (typeof input[key] === 'boolean') value[key] = input[key];
  }
  for (const [key, min, max] of [
    ['interval', 0, 1440], ['timeout', 5, 600], ['retries', 0, 5],
    ['concurrency', 1, 4], ['maxFileMB', 1, 1024],
  ]) {
    if (input[key] !== undefined) {
      const n = Number(input[key]);
      if (!Number.isInteger(n) || n < min || n > max) throw fault('同步设置数值无效：' + key);
      value[key] = n;
    }
  }
  if (input.deletion !== undefined) {
    if (!['confirm', 'sync', 'keep'].includes(input.deletion)) throw fault('删除策略无效。');
    value.deletion = input.deletion;
  }
  if (input.excludes !== undefined) {
    if (typeof input.excludes !== 'string' || input.excludes.length > 8000) throw fault('排除规则过长。');
    value.excludes = input.excludes.trim();
    if (value.excludes.split('\n').some(line => line.includes('\\') || line.split('/').includes('..'))) {
      throw fault('排除规则使用 / 分隔路径，不能包含上级路径。');
    }
  }
  return value;
}
function excludedBy(settings) {
  const patterns = settings.excludes.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
    const folder = line.endsWith('/');
    line = line.replace(/^\//, '').replace(/\/$/, '');
    let expression = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '*' && line[i + 1] === '*') {
        i++;
        if (line[i + 1] === '/') { i++; expression += '(?:.*/)?'; }
        else expression += '.*';
      } else if (c === '*') expression += '[^/]*';
      else if (c === '?') expression += '[^/]';
      else expression += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp((line.includes('/') ? '^' : '(^|/)') + expression + (folder ? '(/|$)' : '$'));
  });
  return name => (!settings.includeCodeData && /(^|\/)[^/]+\.assets\/code-data(\/|$)/i.test(name))
    || patterns.some(pattern => pattern.test(name));
}
module.exports = { defaults, policy, excludedBy };
