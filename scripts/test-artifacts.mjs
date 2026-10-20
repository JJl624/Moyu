import fs from 'node:fs/promises';
import path from 'node:path';

const within = (root, file) => {
  const relative = path.relative(root, file);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};
const alive = pid => {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
};

// Called by the test-side Electron launcher, never by the application.
export async function recordTestProfile(env, ledger = process.env.MOYU_TEST_ARTIFACT_LEDGER) {
  if (!ledger || env?.MOYU_TEST !== '1' || !env.MOYU_USER_DATA) return;
  const directory = path.resolve(env.MOYU_USER_DATA);
  await fs.appendFile(ledger, JSON.stringify({ directory }) + '\n');
}
export async function recordTestProcess(pid, ledger = process.env.MOYU_TEST_ARTIFACT_LEDGER) {
  if (ledger) await fs.appendFile(ledger, JSON.stringify({ pid }) + '\n');
}

export async function createTestArtifacts(work) {
  const root = await fs.realpath(work), parent = path.join(root, 'test-runs');
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, 'run-')), ledger = path.join(directory, 'profiles.jsonl');
  await fs.writeFile(ledger, '', { flag: 'wx' });
  // Compare timestamps from the same filesystem clock. Linux directory birth
  // times can lag Date.now() by a clock tick even for a newly created profile.
  const started = (await fs.stat(ledger)).birthtimeMs;
  return {
    ledger,
    async finish(success) {
      if (!success || process.env.MOYU_KEEP_TEST_DATA === '1') return { removed: 0, retained: directory };
      const rows = (await fs.readFile(ledger, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
      if (rows.some(row => Number.isSafeInteger(row.pid) && alive(row.pid))) return { removed: 0, retained: directory };
      let removed = 0;
      for (const file of new Set(rows.flatMap(row => typeof row.directory === 'string' ? [row.directory] : []))) {
        const absolute = path.resolve(file), real = await fs.realpath(absolute).catch(() => null);
        if (!real || !within(root, real) || !within(root, absolute) || real !== absolute || absolute === parent || absolute === directory) continue;
        const info = await fs.lstat(absolute);
        if (!info.isDirectory() || info.isSymbolicLink() || info.birthtimeMs < started) continue;
        await fs.rm(absolute, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        removed++;
      }
      if (!within(parent, directory)) throw Error('Invalid test artifact directory');
      await fs.rm(directory, { recursive: true, force: true });
      return { removed };
    },
  };
}
