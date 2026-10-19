const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

// The editor can run in independent windows/processes. Never remove a live
// owner's lock based on age; a suspended window may resume much later.
async function configLock(file) {
  const directory = file + '.lock', owner = 'owner-' + process.pid + '-' + randomUUID();
  const deadline = Date.now() + 10000;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const prepared = directory + '-' + process.pid + '-' + randomUUID();
  await fs.mkdir(prepared);
  try {
    await fs.mkdir(path.join(prepared, owner));
    while (true) {
      try {
        // Publish an already populated directory. Empty locks can only be left
        // after a completed write/recovery, never by a process preparing to write.
        await fs.rename(prepared, directory);
        return async () => {
          await fs.rmdir(path.join(directory, owner));
          await fs.rmdir(directory).catch(error => {
            if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
          });
        };
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
        if (Date.now() >= deadline) throw error;
      }
      const stat = await fs.lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (!stat) { await delay(25); continue; }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('配置锁目录无效：' + directory);
      const names = await fs.readdir(directory).catch(error => { if (error.code !== 'ENOENT') throw error; return []; });
      if (!names.length) {
        await fs.rmdir(directory).catch(error => {
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
        });
        continue;
      }
      if (names.length === 1 && /^owner-\d+-[a-f\d-]+$/.test(names[0])) {
        const pid = Number(names[0].split('-')[1]);
        let dead = false;
        try { process.kill(pid, 0); } catch (error) { dead = error.code === 'ESRCH'; }
        if (dead) {
          // Only the contender that removed this exact dead owner's marker may
          // remove the empty directory. A new owner's marker is never unlinked.
          const removed = await fs.rmdir(path.join(directory, names[0])).then(() => true, error => {
            if (error.code !== 'ENOENT') throw error;
            return false;
          });
          if (removed) await fs.rmdir(directory).catch(error => {
            if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
          });
          continue;
        }
      }
      if (Date.now() >= deadline) throw Error('应用配置正被占用，请关闭其他窗口后重试：' + directory);
      await delay(25 + Math.floor(Math.random() * 25));
    }
  } finally {
    // Only remove this invocation's unpublished directory, without recursion.
    await fs.rmdir(path.join(prepared, owner)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.rmdir(prepared).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
module.exports = { configLock };
