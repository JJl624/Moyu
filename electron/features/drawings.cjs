function createDrawingsOperations(services) {
  return {
    'fonts.list': () => services.systemFonts(false),
    'fonts.reset-drawings': (input) =>
      services.vault.mutate(async () => {
        const ids = new Set((input.ids || []).filter(id => Number.isInteger(id) && id >= 10000)), files = [];
        const walk = nodes =>
          nodes.forEach(n =>
            n.kind === 'folder'
              ? walk(n.children || [])
              : /\.excalidraw$/i.test(n.path) && files.push(n.path)
          );
        walk((await services.vault.list()).tree);
        const { snapshot, replace } = require('../files.cjs');
        const changed = [];
        for (const relative of files) {
          if (relative === input.exclude) {
            continue;
          }
          const file = await snapshot(services.vault, relative);
          const scene = JSON.parse(file.bytes.toString('utf8'));
          let update = false;
          scene.elements = scene.elements.map(e => {
            if (e.type === 'text' && ids.has(e.fontFamily)) {
              update = true;
              return { ...e, fontFamily: 5, version: (e.version || 0) + 1, updated: Date.now() };
            }
            return e;
          });
          if (ids.has(scene.appState?.currentItemFontFamily)) {
            scene.appState.currentItemFontFamily = 5;
            update = true;
          }
          if (update) {
            await replace(services.vault, relative, Buffer.from(JSON.stringify(scene, null, 2)), file.version);
            changed.push(relative);
          }
        }
        return Promise.all(changed.map(relative => services.drawings.read(relative)));
      }),
    'drawing.read': (input) => services.drawings.read(input.path),
    'drawing.library-read': () => services.vault.mutate(() => services.drawings.library.read()),
    'drawing.library-save': (input) => {
      if (input.root !== services.vault.root) {
        throw new Error('知识库已切换，素材库未保存。');
      }
      return services.drawings.library.save(input.libraryItems);
    },
    'drawing.library-open': async () => {
      const selected = await services.dialog.showOpenDialog(services.window, {
        title: '打开素材库',
        properties: ['openFile'],
        filters: [{ name: 'Excalidraw 素材库', extensions: ['excalidrawlib', 'json'] }],
      });
      if (selected.canceled || !selected.filePaths[0]) {
        return null;
      }
      return require('../drawing-library.cjs').readLibraryFile(selected.filePaths[0]);
    },
    'drawing.create': (input) => services.drawings.create(input),
    'drawing.save': (input) => services.drawings.save(input),
    'drawing.image': (input) => services.drawings.image(input),
  };
}
module.exports = { createDrawingsOperations };
