const { createCodeOperations } = require('./code.cjs');
const { createFilesOperations } = require('./files.cjs');
const { createRuntimeOperations } = require('./runtime.cjs');
const { createDrawingsOperations } = require('./drawings.cjs');
const { createWebdavOperations } = require('./webdav.cjs');
const { createTerminalOperations } = require('./terminal.cjs');
function createFeatureRouter(services, dataActions) {
  const operations = {
    ...createCodeOperations(services),
    ...createFilesOperations(services),
    ...createRuntimeOperations(services),
    ...createDrawingsOperations(services),
    ...createWebdavOperations(services),
    ...createTerminalOperations(services),
    ...dataActions,
  };
  return async (action, input = {}) => {
    if (!Object.hasOwn(operations, action)) {
      throw new Error('不支持这个操作。');
    }
    if(services.vault?.recoveryError&&/^(code\.(run|normalize|data-(upload|delete|rebind)|html-(files|pin|resize))|file\.(rename|copy|trash|associate|history-restore)|attachment\.(delete|upload)|drawing\.(create|save|image|library-save)|webdav\.(sync|resolve|preview))/.test(action))throw new Error(services.vault.recoveryError);
    if(input?.root && /^(file\.|attachment\.|drawing\.|code\.(run|data-|normalize|counter|pinned-results))/.test(action) && input.root!==services.vault?.root) {
      throw new Error('知识库已切换。');
    }
    const result = await operations[action](input);
    if (services.vault && /^drawing\.(create|save|image)/.test(action)) {
      services.window?.webContents.send('moyu:changed', await services.vault.list());
    }
    return result;
  };
}
module.exports = { createFeatureRouter };
