import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

const project = path.resolve(import.meta.dirname, '..');
const base = path.resolve(project, '../../work/portable-bootstrap-tests');
await fs.mkdir(base, { recursive: true });
const root = await fs.mkdtemp(path.join(base, 'case-'));
const { version } = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
const exe = path.join(project, `release/v${version}/Moyu-${version}-x64.exe`);

async function probe(name, data, expectedCode = 0) {
  const report = path.join(root, name + '.txt');
  const env = { ...process.env, MOYU_TEST: '1', MOYU_PORTABLE_PROBE: report };
  if (data) env.MOYU_USER_DATA = data;
  else delete env.MOYU_USER_DATA;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(exe, [], { env, cwd: root, windowsHide: true, stdio: 'ignore' });
  const code = await Promise.race([
    new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    }),
    setTimeout(90000, null, { ref: false }).then(() => {
      child.kill();
      throw Error('Portable bootstrap timed out: ' + name);
    }),
  ]);
  const text = await fs.readFile(report, 'utf16le');
  assert.equal(code, expectedCode, text);
  assert.ok(text.startsWith(expectedCode === 0 ? 'prepared\r\n' : 'failed\r\n'), text);
  if (expectedCode === 0 && data) {
    const normalized = path.resolve(root, data);
    assert.ok(text.includes('data=' + normalized + '\r\n'), text);
    const program = /^program=(.+)$/m.exec(text)?.[1].trim();
    assert.ok(program && !path.relative(normalized, program).startsWith('..'), text);
    await fs.access(path.join(program, 'Moyu.exe'));
    await fs.access(path.join(program, 'resources/app.asar'));
    await fs.access(path.join(program, 'ready.txt'));
  }
  console.log(JSON.stringify({ name, code, text }));
  return text;
}

// Default folder probe prepares the program without loading or modifying user
// preferences, workspace files or documents. All other cases use owned fixtures.
await probe('default');
const fresh = path.join(root, '新建 中文 空格', '尚不存在', 'Moyu应用数据');
await assert.rejects(fs.access(fresh), { code: 'ENOENT' });
await probe('first-launch', fresh);
await probe('warm-launch', fresh);
await probe('relative-launch', '相对路径/MoyuData');
await Promise.all([
  probe('concurrent-b', path.join(root, '并发首次')),
  probe('concurrent-c', path.join(root, '并发首次')),
]);
await probe('concurrent-a', path.join(root, '并发首次'));
const blocked = path.join(root, '占用目录的文件');
await fs.writeFile(blocked, 'fixture');
const failure = await probe('blocked-directory', path.join(blocked, 'Moyu应用数据'), 1);
assert.ok(failure.includes('stage=应用数据目录'), failure);
console.log('Portable bootstrap fresh/default/Unicode/relative/concurrent/error cases passed.');
