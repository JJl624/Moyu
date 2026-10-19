function createWebdavOperations(services) {
  return {
    'connections.get': () => services.connections.get(services.vault.root),
    'connections.password': async (input) => {
      if (input.root !== services.vault.root) {
        throw new Error('知识库已切换。');
      }
      return { password: (await services.connections.get(services.vault.root, true)).webdav.password || '' };
    },
    'connections.save': async (input) => {
      const vault=services.vault,scheduler=services.syncScheduler;
      scheduler?.close();
      await services.sync.cancel();
      try {
        const result = await services.connections.save(vault.root, input.kind, input);
        if(services.vault===vault&&!vault.recoveryError)scheduler.configure(result.webdav);
        return result;
      } catch (error) {
        if(services.vault===vault&&!vault.recoveryError)scheduler.configure((await services.connections.get(vault.root)).webdav);
        throw error;
      }
    },
    'webdav.test': () =>
      services.downloads.run('webdav-test', '测试连接', job => services.sync.test(job.controller.signal)),
    'webdav.status': () => services.sync.status(),
    'webdav.preview': () => services.sync.preview(),
    'webdav.refresh-tree': () => services.sync.refreshTree(),
    'webdav.cancel': () => services.sync.cancel(),
    'webdav.sync': async (input) => {
      const current = services.vault, a = services.attachments, r = services.references;
      const result = await services.sync.sync(input);
      if (!result.needsConfirmation) {
        await services.refreshAfterSync(current, a, r);
      }
      return result;
    },
    'webdav.resolve': async (input) => {
      const current = services.vault, a = services.attachments, r = services.references;
      const result = await services.sync.resolve(input);
      await services.refreshAfterSync(current, a, r);
      return result;
    },
  };
}
module.exports = { createWebdavOperations };
