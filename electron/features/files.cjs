const fs = require('node:fs/promises');
const path = require('node:path');
function createFilesOperations(services) {
  return {
    'attachment.views-read': input => require('../attachment-views.cjs').readAttachmentViews(services,input),
    'attachment.views-update': input => require('../attachment-views.cjs').updateAttachmentViews(services,input),
    'history.configure': async input => {
      const options = require('../../shared/history-options.mjs').historyOptions(input.settings);
      await services.dataStore.set({key:'moyu-history', value:JSON.stringify(options)});
      services.vault?.history?.configure(options);
      return options;
    },
    'file.history-list': input => services.vault.history.list(input.document),
    'file.history-read': input => services.vault.history.read(input.document, input.id),
    'file.history-restore': input => services.vault.history.prepareRestore(input),
    'file.copy': (input) => services.documentFiles.copy(input),
    'file.trash-impact': (input) => services.documentFiles.impact(input),
    'file.trash': (input) => services.trashWithReferences(input),
    'file.orphans': () => services.documentFiles.orphans(),
    'file.orphan-delete': (input) =>
      services.trashWithReferences({ ...input, path: input.directory, orphan: input.document }),
    'file.associate': (input) => services.documentFiles.associate(input),
    'attachment.rename': (input) => services.documentFiles.rename(input),
    'document.confirm-close': async (input) => {
      const names = (input.paths || []).map(p => path.basename(p)).slice(0, 8);
      const result = await services.dialog.showMessageBox(services.window, {
        type: 'question',
        title: '文档未保存',
        message: names.length === 1 ? '保存 ' + names[0] + ' 的修改？' : '保存未保存的文档？',
        detail: names.join('\n'),
        buttons: ['保存', '放弃修改', '取消'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      return ['save', 'discard', 'cancel'][result.response];
    },
    'file.binary-read': (input) => require('../file-viewers.cjs').binaryRead(services.vault, input.path),
    'file.html-open': (input) => services.htmlFileViews.open(input),
    'file.html-inline-open': (input) => services.htmlFileViews.openInline(input),
    'file.html-close': (input) => services.htmlFileViews.close(input.token),
    'file.sqlite-bytes': (input) => require('../file-viewers.cjs').binaryRead(services.vault, input.path, true),
    'image.read': (input) => {
      if (require('../../shared/file-kind.mjs').fileKind(input.path) !== 'image') {
        throw Error('图片格式无效。');
      }
      return require('../file-viewers.cjs').binaryRead(services.vault, input.path);
    },
    'file.exists': async (input) => {
      try {
        return (await fs.stat(await services.vault.resolve(input.path, true))).isFile();
      } catch (error) {
        if (error.code === 'ENOENT') {
          return false;
        }
        throw error;
      }
    },
    'editing.command': (input) => {
      if (!['paste', 'cut', 'selectAll'].includes(input.command)) {
        throw new Error('编辑操作无效');
      }
      return services.window.webContents[input.command]();
    },
    'attachment.target': (input) => services.attachments.target(input.document, input.name),
    'attachment.upload': async (input) => {
      if (input.root && input.root !== services.vault.root) {
        throw new Error('知识库已切换，请重新添加附件。');
      }
      return services.attachments.upload({
        ...input,
        bytes: input.token ? await services.resultStore.read(input.token) : input.bytes,
      });
    },
    'attachment.list': (input) => services.attachments.list(input),
    'file.resolve-wiki': async (input) => {
      const { wikiPath } = await import('../../shared/wiki-links.mjs'), files = [];
      const walk = nodes => nodes.forEach(n => n.kind === 'folder' ? walk(n.children || []) : files.push(n.path));
      walk((services.attachments.state || await services.vault.list()).tree);
      return wikiPath(String(input.document || ''), String(input.target || ''), files);
    },
  };
}
module.exports = { createFilesOperations };
