const fs = require('node:fs/promises');
const path = require('node:path');
const { app, dialog, shell, clipboard } = require('electron');
const { EnvironmentCleanup } = require('./environment-cleanup.cjs');
const {children, childPath} = require('./data-inventory.cjs');
function dataOperations(context) {
  const c = context;
  const cleanup = new EnvironmentCleanup({
    root: c.root, legacy: c.legacy,
    program: app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, '..'),
    vault: () => c.vault()?.root, trash: target => shell.trashItem(target),
  });
  async function entries() {
    const v = c.vault();
    const list = [
      { id: 'directory', name: '应用数据目录', path: c.root, restart: true, group: 'root' },
      { id: 'settings', name: '应用设置', path: c.configFile(), readonly: true, group: 'application' },
      { id: 'cache', name: '运行缓存', path: app.getPath('userData'), restart: true },
      { id: 'program', name: '程序环境', path: app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, '..'), readonly: true },
      ...(v ? [{ id: 'vault', name: '知识库数据', path: v.dataDirectory, readonly: true }] : []),
      ...(v ? [{id:'history-backup',name:'旧格式历史备份',path:path.join(v.dataDirectory,'history-legacy'),group:'workspace'}, { id: 'document-history', name: '文档历史', path: path.join(v.dataDirectory, 'history.sqlite'), group: 'workspace',clear:true }] : []),
      {id:'python',name:'Python',path:path.join(c.root,'Python'),managed:'python'},
      {id:'javascript',name:'JavaScript / TypeScript（V8）',path:path.dirname(process.execPath),readonly:true,group:'runtimes'},
      {id:'managed-runtimes',name:'语言运行环境',path:path.join(c.root,'runtimes'),managed:'runtime',group:'runtimes'},
      {id:'js-packages',name:'npm 依赖',path:path.join(c.root,'JavaScript'),managed:'javascript',group:'runtimes'},
    ];
    const roots = [...new Set([v?.root, ...(c.settings().recent || []).map(x=>x.root)].filter(Boolean))];
    for (const [index, root] of roots.entries()) list.push({id:'workspace-files-'+index,name:path.basename(root),path:root,group:'workspace',readonly:true});

    return Promise.all(list.map(async item => {
      const stat = await fs.lstat(item.path).catch(() => null);
      const group = item.group || (item.id === 'program' || /^(python|clang|sql|lua)/.test(item.id) ? 'runtimes'
        : ['cache','temporary','logs','crashes'].includes(item.id) ? 'cache'
        : item.id === 'vault' ? 'workspace' : 'application');
      return {...item,group,exists:!!stat,kind:stat?.isSymbolicLink()?'link':stat?.isDirectory()?'directory':'file'};
    }));
  }
  async function location(id) {
    return (await entries()).find(x=>x.id===id) || (await cleanup.entries()).map(item=>({...item,kind:'directory'})).find(x=>x.id===id);
  }
  return {
    'preferences.get': () => c.store.get(),
    'preferences.set': input => c.store.set(input),
    'preferences.set-many': input => c.store.setMany(input),
    'navigation.get': async () => ({ recent: await Promise.all((c.settings().recent || []).map(async item => ({ ...item, exists: !!(await fs.stat(item.root).catch(() => null))?.isDirectory() }))), active: c.settings().root }),
    'navigation.remove': async input => {
      if (typeof input.root !== 'string') throw new Error('知识库路径无效。');
      c.settings().recent = (c.settings().recent || []).filter(item => item.root !== input.root);
      if (c.settings().root === input.root) delete c.settings().root;
      await c.persist();
    },
    'navigation.delete': async input => {
      const item=(c.settings().recent||[]).find(item=>item.root===input.root);
      if(!item)throw Error('请选择最近使用的知识库');
      const root=path.resolve(item.root),stat=await fs.lstat(root);
      const within=(a,b)=>{const relative=path.relative(a,b);return !relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
      if(!stat.isDirectory()||stat.isSymbolicLink()||root===path.parse(root).root||[c.root,path.dirname(process.execPath),path.resolve(__dirname,'..')].some(protectedPath=>within(root,protectedPath)))throw Error('此目录不能作为知识库删除');
      const result=await dialog.showMessageBox(c.window(),{type:'warning',title:'删除知识库',message:'将“'+item.name+'”及全部文件移至回收站？',detail:root,buttons:['取消','移至回收站'],defaultId:0,cancelId:0,noLink:true});
      if(result.response!==1)return{cancelled:true};
      const closed=await c.deleteVault(root);
      c.settings().recent=(c.settings().recent||[]).filter(item=>!within(root,path.resolve(item.root)));
      if(c.settings().root&&within(root,path.resolve(c.settings().root)))delete c.settings().root;
      await c.persist();return{closed};
    },
    'navigation.open': input => {
      if (!(c.settings().recent || []).some(x => x.root === input.root)) throw new Error('请选择最近使用的知识库。');
      return c.setVault(input.root);
    },
    'navigation.create': async input => {
      const name = String(input.name || '我的知识库').trim();
      if (!name || /[<>:"\\/|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) throw new Error('知识库名称无效。');
      const selected = await dialog.showOpenDialog(c.window(), { title: '选择知识库的存放位置', properties: ['openDirectory', 'createDirectory'] });
      if (selected.canceled) return null;
      const root = path.join(selected.filePaths[0], name);
      await fs.mkdir(root);
      if (input.example !== false) await c.copySeed(path.join(__dirname, '../resources/workspace-guide'), root);
      return c.setVault(root);
    },
    'data.list': entries,
    'data.children': async input => {
      const item = await location(input.id);
      if (!item || item.kind !== 'directory') throw Error('数据目录无效。');
      return children(item.path, input.relative, input.offset);
    },
    'data.cleanup-list': () => cleanup.entries(),
    'data.cleanup': async input => {
      await c.store.queue;
      if (c.vault()) await c.vault().queue;
      return cleanup.remove(input.id);
    },
    'data.reveal': async input => {
      const item = await location(input.id);
      if (!item) throw new Error('数据位置无效。');
      const target = input.relative ? await childPath(item.path, input.relative) : item.path;
      const stat = await fs.lstat(target).catch(() => null);
      const archive = target.match(/^(.*[\\/][^\\/]+\.asar)(?:[\\/].*)?$/);
      if (archive) { shell.showItemInFolder(archive[1]); return; }
      if (stat?.isDirectory()) await shell.openPath(target); else shell.showItemInFolder(target);
    },
    'data.delete': async input => {
      const item = (await entries()).find(x => x.id === input.id);
      if (!item) throw new Error('数据位置无效。');
      if (item.readonly) throw new Error('此位置不能在这里删除。');
      if (item.managed) throw new Error('请在对应语言的设置中删除运行环境或依赖。');
      if (c.vault()) await c.vault().queue;
      await c.store.queue;
      if (item.restart) { await shell.openPath(item.path); return { message: '关闭应用后可删除此缓存目录。' }; }
      if(input.id==='document-history'){const current=c.vault();await current.mutate(()=>current.history.clear());return {message:'文档历史已清空'};}
      if (item.exists) await shell.trashItem(item.path);
      if (input.id === 'workspace') { c.settings().recent = []; delete c.settings().root; }
      return { message: '已移至回收站，重启后生效' };
    },
    'clipboard.read': () => clipboard.readText(),
    'clipboard.write': input => clipboard.writeText(String(input.text || '').slice(0, 2 * 1024 * 1024)),
    'file.open': async input => { const target = await c.vault().resolve(input.path); const failure = await shell.openPath(target); if (failure) throw new Error(failure); },
  };
}
module.exports = { dataOperations };
