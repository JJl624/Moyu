import { _electron as electron } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTestArtifacts } from './test-artifacts.mjs';
const project = path.resolve(import.meta.dirname, '..'), work = path.resolve(project, '../../work');
const suites = {
  all: [],
  stability: [
    'build-runtime',
    'resource-editing',
    'inline-media',
    'context-actions',
    'close-paste-regression',
    'close-position',
    'document-files',
    'document-history',
    'history-database',
    'webdav-upgrade',
    'optimization',
    'dirty-roundtrip',
    'markdown-preservation',
    'runtime-settings-ux',
    'v1815-polish',
  ],
  performance: ['performance-baseline', 'performance-audit', 'process-resources'],
};
const suite = process.argv[2];
if (!Object.hasOwn(suites, suite)) {
  throw Error('Usage: node scripts/run-regressions.mjs all|stability|performance [Playwright options]');
}
await fs.mkdir(work, { recursive: true });
const artifacts = await createTestArtifacts(work);
const data = await fs.mkdtemp(path.join(work, 'clipboard-guard-')),
  env = { ...process.env, MOYU_USER_DATA: data };
env.MOYU_TEST_ARTIFACT_LEDGER = artifacts.ledger;
delete env.ELECTRON_RUN_AS_NODE;
if (suite === 'performance' && process.platform === 'win32' && !env.MOYU_PERF_COMPARE) {
  env.MOYU_PERF_COMPARE = path.join(project, 'tests/fixtures/performance-baseline/windows-x64');
}
const guard = await electron.launch({ args: [path.join(project, 'tests/helpers/clipboard-guard.cjs')], env });
let snapshot = false;
try {
  await guard.evaluate(async ({ app, clipboard, ClipboardItem }) => {
    await app.whenReady();
    const values = [];
    for (const item of await clipboard.read()) {
      const types = [];
      for (const type of item.types) types.push([type, await item.getType(type)]);
      if (types.length) values.push(new ClipboardItem(Object.fromEntries(types)));
    }
    globalThis.moyuClipboardSnapshot = values;
  });
  snapshot = true;
  const child = spawn(process.execPath, [
    path.join(project, 'node_modules/@playwright/test/cli.js'),
    'test',
    ...suites[suite].map(name => 'tests/' + name + '.spec.ts'),
    ...process.argv.slice(3),
  ], { cwd: project, env, stdio: 'inherit', windowsHide: true });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
} finally {
  try {
    if (snapshot) {
      await guard.evaluate(async ({ clipboard }) => {
        const values = globalThis.moyuClipboardSnapshot;
        if (values.length) await clipboard.write(values);
        else clipboard.clear();
        delete globalThis.moyuClipboardSnapshot;
      });
    }
  } finally {
    await guard.evaluate(({ app }) => app.exit(0)).catch(() => {});
    const guardProcess = guard.process();
    if (guardProcess.exitCode === null && guardProcess.signalCode === null) {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 5000);
        guardProcess.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    // This directory is created above, is never a workspace or user data root.
    if (path.dirname(data) === work) await fs.rm(data, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
    const result = await artifacts.finish(process.exitCode === 0);
    if (result.retained) console.log('Test data retained:', result.retained);
    else console.log('Removed test profiles:', result.removed);
  }
}
