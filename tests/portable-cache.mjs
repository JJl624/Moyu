import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect } from '../node_modules/@playwright/test/index.mjs';
const project = path.resolve(import.meta.dirname, '..'),
  base = path.resolve(project, '../../work/portable-cache-tests');
await fs.mkdir(base, { recursive: true });
const data = path.join(await fs.mkdtemp(path.join(base, 'case-')), '首次启动 中文 空格', 'Moyu应用数据');
const env = {
  ...process.env,
  MOYU_USER_DATA: data,
  MOYU_TEST: '1',
  MOYU_TEST_OFFSCREEN: '1',
  MOYU_DEMO: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
const { version } = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
const exe = path.join(project, `release/v${version}/Moyu-${version}-x64.exe`);
async function launch() {
  await fs.unlink(path.join(data, 'cache/DevToolsActivePort')).catch(e => {
    if (e.code !== 'ENOENT') throw e;
  });
  const started = performance.now(),
    child = spawn(exe, ['--remote-debugging-port=0', '--disable-backgrounding-occluded-windows'], {
      env,
      windowsHide: true,
      stdio: 'ignore',
    });
  const exited = new Promise(resolve => child.once('exit', resolve));
  let port;
  for (let i = 0; i < 120; i++) {
    try {
      port =
        (await fs.readFile(path.join(data, 'cache/DevToolsActivePort'), 'utf8')).split('\n')[0];
      break;
    } catch {
      if (child.exitCode !== null) throw Error('Launcher exited ' + child.exitCode);
      await setTimeout(500);
    }
  }
  if (!port) {
    child.kill();
    throw Error('No endpoint');
  }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  await expect.poll(
    () => browser.contexts().flatMap(c => c.pages()).some(p => p.url().startsWith('moyu://app')),
    { timeout: 30000 },
  ).toBe(true);
  const page = browser.contexts().flatMap(c => c.pages()).find(p =>
    p.url().startsWith('moyu://app')
  );
  await expect(page.locator('.ProseMirror h1').first()).toBeVisible();
  const response = await page.evaluate(() => window.moyu.feature('data.list'));
  if (!response.ok) throw Error('Data list failed');
  for (const id of ['program', 'managed-runtimes', 'python', 'cache']) {
    const item = response.data.find(i => i.id === id);
    if (!item || path.relative(data, item.path).startsWith('..')) {
      throw Error('Environment outside data root: ' + JSON.stringify(item));
    }
  }
  const program = response.data.find(i => i.id === 'program').path;
  const duration = performance.now() - started;
  return {
    page,
    program,
    duration,
    close: async () => {
      await page.evaluate(() => window.moyu.confirmClose());
      await browser.close();
      const exit = await Promise.race([
        exited,
        setTimeout(15000).then(() => {
          throw Error('Launcher did not exit');
        }),
      ]);
      if (exit !== 0) throw Error('Launcher exited ' + exit);
    },
  };
}
async function inventory(dir) {
  const items = {};
  async function visit(folder) {
    for (const e of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, e.name);
      if (e.isDirectory()) await visit(file);
      else if (e.isFile()) {
        const s = await fs.stat(file);
        items[path.relative(dir, file)] = { mtime: s.mtimeMs, bytes: s.size };
      }
    }
  }
  await visit(dir);
  return items;
}
const first = await launch();
await first.page.evaluate(() => window.moyu.feature('python.state'));
const program = first.program, coldMs = first.duration;
await first.close();
const before = await inventory(program), pythonBefore = await inventory(path.join(data, 'Python'));
const second = await launch();
if (second.program !== program) throw Error('Warm launch changed program root');
await second.page.evaluate(() => window.moyu.feature('python.state'));
const warmMs = second.duration;
await second.close();
if (JSON.stringify(await inventory(program)) !== JSON.stringify(before)) {
  throw Error('Warm launch rewrote program files');
}
if (JSON.stringify(await inventory(path.join(data, 'Python'))) !== JSON.stringify(pythonBefore)) {
  throw Error('Warm launch rewrote Python installation');
}
if (!path.resolve(program).startsWith(path.resolve(data) + path.sep)) {
  throw Error('Unsafe repair fixture');
}
await fs.unlink(path.join(program, 'ready.txt'));
// Also remove a shipped file so recovery must really extract a missing file.
const missing = 'LICENSES.chromium.html';
const missingContent = await fs.readFile(path.join(program, missing));
await fs.unlink(path.join(program, missing));
const third = await launch();
if (third.program !== program) throw Error('Interrupted extraction changed root');
await third.close();
await fs.access(path.join(program, 'ready.txt'));
if (!missingContent.equals(await fs.readFile(path.join(program, missing)))) {
  throw Error('Recovery did not restore the missing shipped file');
}
const recovered = await inventory(program);
for (const [file, entry] of Object.entries(before)) {
  if (file === 'ready.txt' || file === missing) continue;
  if (JSON.stringify(recovered[file]) !== JSON.stringify(entry)) {
    throw Error('Recovery rewrote an unchanged program file: ' + file);
  }
}
console.log(JSON.stringify(
  {
    data,
    program,
    files: Object.keys(before).length,
    programBytes: Object.values(before).reduce((n, e) => n + e.bytes, 0),
    coldMs: Math.round(coldMs),
    warmMs: Math.round(warmMs),
    repeatProgramWrites: 0,
    repeatPythonWrites: 0,
    partialExtractionRecovery: 'passed',
    recoveryUnchangedProgramWrites: 0,
    allEnvironmentsInsideDataRoot: true,
  },
  null,
  2,
));
