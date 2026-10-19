const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  shell,
  protocol,
  net,
  session,
  safeStorage,
} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Vault } = require('./vault.cjs');
const { Connections } = require('./connections.cjs');
const { WebDAVSync } = require('./sync.cjs');
const { SyncScheduler } = require('./sync-scheduler.cjs');
let syncScheduler;
const { Drawings } = require('./drawings.cjs');
const { Attachments } = require('./attachments.cjs');
const { References } = require('./references.cjs');
const { CodeData } = require('./code-data.cjs');
const {DocumentFiles}=require('./document-files.cjs');
let documentFiles;
const resultStore=new(require('./result-store.cjs').ResultStore)();
const htmlResults=new(require('./html-results.cjs').HTMLResults)(resultStore,{current:()=>codeData,config:()=>runtimeSettings.config('javascript')});
const htmlFileViews=new(require('./html-file-views.cjs').HTMLFileViews)(()=>vault);
const pinnedHTML=new(require('./pinned-html.cjs').PinnedHTML)(htmlResults,()=>codeData);
// Cross-site sandbox frames must not share the editor's renderer event loop.
app.commandLine.appendSwitch('site-per-process');
let references, attachments, codeData, watcher, watchTimer, scanPending = false, scanAgain = false;
function watchVault() {
  watcher?.close();
  clearTimeout(watchTimer);
  try {
    watcher = require('node:fs').watch(vault.root, { recursive: true }, (_event, file) => {
      if (
        file
        && String(file).split(/[\\/]/).some(p =>
          p === '.data' || p.startsWith('.') || p === 'node_modules' || p.startsWith('moyu-tmp-')
        )
      ) return;
      const changed = file && String(file).replaceAll('\\', '/');
      if(changed){references?.cache.delete(changed);references?.unreadable.delete(changed);}
      else {references?.cache.clear();references?.unreadable.clear();}
      sync?.invalidateLocal?.(changed);
      syncScheduler?.changed();
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => void scanVault(), 300);
    });
    watcher.on('error', () => {
      watcher?.close();
      watcher = null;
    });
  } catch {
    watcher = null;
  }
}
async function scanVault() {
  if (scanPending) {
    scanAgain = true;
    return;
  }
  if (!vault) return;
  scanPending = true;
  const current = vault;
  const currentReferences = references, currentAttachments = attachments;
  try {
    const state = await current.list();
    scanError='';
    if (current !== vault) return;
    await currentReferences.refresh(state);
    if (current !== vault) return;
    currentAttachments.state = state;
    state.warnings = [...(state.warnings||[]),...[...currentReferences.unreadable].map(([name,value])=>name+'：'+value.message)];
    const serialized = JSON.stringify({tree:state.tree,warnings:state.warnings});
    if (previousTree !== serialized) {
      previousTree = serialized;
      window?.webContents.send('moyu:changed', state);
    }
  } catch (error) {
    console.error('知识库扫描失败：',error);
    if(current===vault&&scanError!==error.message){scanError=error.message;window?.webContents.send('moyu:scan-error',error.message);}
  } finally {
    scanPending = false;
    if (scanAgain) {
      scanAgain = false;
      void scanVault();
    }
  }
}
async function refreshAfterSync(current, currentAttachments, currentReferences) {
  if (current !== vault) return;
  await current.mutate(() => currentAttachments.documents.discover());
  const state = await current.list();
  await currentReferences.refresh(state);
  if (current !== vault) return;
  currentAttachments.state = state;
  state.warnings = [...references.unreadable].map(([name,value])=>name+'：'+value.message);
  previousTree = JSON.stringify({tree:state.tree,warnings:state.warnings});
  window?.webContents.send('moyu:changed', state);
}
const { DataStore } = require('./data.cjs');
const { dataOperations } = require('./data-operations.cjs');

const legacyData = process.env.MOYU_USER_DATA
  ? path.resolve(process.env.MOYU_USER_DATA)
  : path.join(app.getPath('appData'), app.getName());
const hostEnvironment={...process.env};
const dataRoot = process.env.MOYU_USER_DATA
  ? path.resolve(process.env.MOYU_USER_DATA)
  : path.join(app.getPath('documents'), 'MoyuData');
const applicationConfig = new (require('./application-config.cjs').ApplicationConfig)(dataRoot);
const appUpdates = new (require('./app-updates.cjs').AppUpdates)(dataRoot, app.getVersion(), { automatic: app.isPackaged && !process.env.MOYU_TEST });
const dataStore = new DataStore(dataRoot);
const cacheRoot = path.join(dataRoot, 'cache');
const tempRoot = path.join(cacheRoot, 'temp');
const crashRoot = path.join(cacheRoot, 'crashes');
for (const folder of [cacheRoot, tempRoot, crashRoot]) require('node:fs').mkdirSync(folder, {recursive:true});
app.setPath('temp', tempRoot);
app.setPath('crashDumps', crashRoot);
// Runtime helpers use application temp; the explicitly requested host terminal keeps the host environment.
process.env.TEMP = process.env.TMP = process.env.TMPDIR = tempRoot;
app.setPath('userData', cacheRoot);
app.setPath('sessionData', app.getPath('userData'));
app.setAppLogsPath(path.join(dataRoot, 'cache', 'logs'));
const { CodeRunner } = require('./runner.cjs');
const { systemFonts } = require('./fonts.cjs');
const { PythonManager } = require('./python.cjs');
const downloads=new(require('./download-tasks.cjs').DownloadTasks)(state=>{if(window&&!window.isDestroyed())window.webContents.send('moyu:download',state);});
const pythonManager = new PythonManager(dataRoot,{downloads});
const { RuntimeSettings, C_STANDARDS, CPP_STANDARDS } = require('./runtime-settings.cjs');
const runtimeSettings = new RuntimeSettings(dataRoot);
const managedRuntimes=new(require('./managed-runtimes.cjs').ManagedRuntimes)(dataRoot,downloads);
const javascriptPackages=new(require('./javascript-packages.cjs').JavaScriptPackages)(dataRoot,downloads);
const codeRunner = new CodeRunner(pythonManager, runtimeSettings, managedRuntimes,javascriptPackages);
async function trashWithReferences(input) {
  const impact = await documentFiles.impact(input);
  if (impact.affected.length && input.transfer === undefined) {
    const choice = await dialog.showMessageBox(window, {
      type: 'warning', title: '删除文档', message: '附属目录中的附件仍被其他文档引用。',
      detail: impact.affected.map(d => d.document).join('\n'),
      buttons: ['转移附件后删除', '直接删除', '取消'], defaultId: 0, cancelId: 2, noLink: true,
    });
    if (choice.response === 2) return {cancelled: true};
    input = {...input, transfer: choice.response === 0};
  }
  return documentFiles.remove(input);
}
async function runtimeState(language) {
  const kind = codeRunner.kind(language);
  if (kind === 'python') throw new Error('请使用 Python 设置。');
  const runtime = kind === 'javascript'
    ? { name: 'V8', version: process.versions.v8, electron: process.versions.electron }
    : await (async()=>{const state=await managedRuntimes.state(kind);return {name:state.installed.find(v=>v.version===state.selected)?.name||state.name,version:state.selected||'未安装'};})();
  return { settings: await runtimeSettings.config(kind), defaults: require('./runtime-settings.cjs').DEFAULTS[kind], runtime, file: runtimeSettings.file, cStandards: C_STANDARDS, cppStandards: CPP_STANDARDS,headers:kind==='clang'?JSON.parse(await fs.readFile(path.join(__dirname,'../resources/clang/headers.json'),'utf8')):undefined };
}
let connections, sync, drawings;

protocol.registerSchemesAsPrivileged([
  { scheme:'moyu-html',privileges:{standard:true,secure:true,supportFetchAPI:true} },
  { scheme:'moyu-preview',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true} },
  { scheme: 'moyu-run', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  {
    scheme: 'moyu',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
  {
    scheme: 'moyu-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);
let window,
  vault,
  closing = false,
  timer,
  previousTree = '',
  settings = {};
let confirmCloseTask;
const hostTerminal=new(require('./terminal.cjs').HostTerminal)({environment:hostEnvironment,publish:event=>{if(window&&!window.isDestroyed()&&!window.webContents.isDestroyed())window.webContents.send('moyu:terminal',event);}});
const wasmTerminal=new(require('./wasm-terminal.cjs').WasmTerminal)({settings:runtimeSettings,runtimes:managedRuntimes,publish:event=>{if(window&&!window.isDestroyed()&&!window.webContents.isDestroyed())window.webContents.send('moyu:terminal',event);}});
const configFile = () => applicationConfig.file;
let configQueue = Promise.resolve();
const persist = () => {
  const snapshot = structuredClone(settings);
  const task = configQueue.then(() => applicationConfig.set('workspace', snapshot));
  configQueue = task.catch(() => {});
  return task;
};
function confirmWindowClose() {
  if (confirmCloseTask) return confirmCloseTask;
  const target = window;
  const task = (async () => {
    await downloads.close();
    syncScheduler?.close(); await sync?.cancel();
    if (vault) await vault.queue;
    await dataStore.queue;
    if (target && !target.isDestroyed()) settings.bounds = target.getBounds();
    await persist();
    await applicationConfig.flush();
    closing = true;
    codeRunner.close();
    wasmTerminal.closeAll();hostTerminal.closeAll();require('./format.cjs').closeFormatter();
    if (target && !target.isDestroyed()) target.close();
  })();
  confirmCloseTask = task;
  task.then(() => { confirmCloseTask = null; }, () => { confirmCloseTask = null; });
  return task;
}
const send = (command) => window?.webContents.send('moyu:command', command);
const validSender = (event) =>
  event.sender === window?.webContents
  && event.senderFrame === window?.webContents.mainFrame;
const handle = (name, action) =>
  ipcMain.handle('moyu:' + name, async (event, ...args) => {
    try {
      if (!validSender(event)) throw new Error('请求来源无效。');
      return { ok: true, data: await action(...args) };
    } catch (error) {
      return {
        ok: false,
        error: {
          message: error.code === 'EEXIST' ? '这个名称已经存在。' : error.message,
          code: error.code,
          current: error.current,
        },
      };
    }
  });
let scanError='',vaultTransition = Promise.resolve();
function setVault(root) {
  const task = vaultTransition.then(() => setVaultUnlocked(root)).catch(async error=>{
    if(vault&&!vault.recoveryError&&syncScheduler)syncScheduler.configure((await connections.get(vault.root)).webdav);
    throw error;
  });
  vaultTransition = task.then(() => {}, () => {});
  return task;
}
async function setVaultUnlocked(root) {
  if (!(await fs.stat(root).catch(() => null))?.isDirectory()) throw new Error('知识库文件夹不存在。');
  syncScheduler?.close();
  await sync?.cancel();
  if (vault) await vault.queue;
  const next = await new Vault(root).init();
  await require('./vault-data.cjs').configureVaultData(
    next,
    dataRoot,
    target => shell.trashItem(target),
  );
  connections ||= new Connections(dataRoot, safeStorage);
  next.history = new (require('./document-history.cjs').DocumentHistory)(next, {options:require('../shared/history-options.mjs').storedHistoryOptions((await dataStore.get())['moyu-history'])});
  const nextReferences=new References(next),nextAttachments=new Attachments(next);
  const nextCodeData=new CodeData(next,nextAttachments,nextReferences);
  const nextFiles=new DocumentFiles(next,nextAttachments,nextReferences,p=>shell.trashItem(p));
  try {
    await nextReferences.recover();
    await nextFiles.recover();
    await nextCodeData.transaction.recover();
    await next.history.recover().catch(error=>console.warn("历史记录暂不可用："+error.message));
    await nextAttachments.documents.discover();await nextCodeData.migrateDirectories();
  } catch(error) {
    next.recoveryError='恢复未完成，知识库以只读方式打开：'+error.message+'。请保留备份，检查 .data 中的事务记录并处理路径冲突，再重新打开知识库。';
  }
  const state=await next.list();await nextReferences.refresh(state);nextAttachments.state=state;
  const nextSync=new WebDAVSync(next,async()=>(await connections.get(next.root,true)).webdav,
    {onProgress:value=>{if(vault===next)window?.webContents.send('moyu:sync',value);}});
  const nextScheduler=new SyncScheduler(nextSync,async()=>{if(vault===next)await refreshAfterSync(next,nextAttachments,nextReferences);});
  const config=(await connections.get(next.root)).webdav;
  // Publish complete services together; failed preparation preserves the current vault.
  codeRunner.close();codeRunner.open();resultStore.clear();
  vault=next;references=nextReferences;attachments=nextAttachments;codeData=nextCodeData;
  documentFiles=nextFiles;drawings=new Drawings(next);sync=nextSync;syncScheduler=nextScheduler;
  if(!next.recoveryError)nextScheduler.configure(config,true);
  state.warnings=[...(state.warnings||[]),...[...nextReferences.unreadable].map(([name,value])=>name+'：'+value.message)];
  watchVault();
  settings.root = vault.root;
  settings.recent = [
    { root: vault.root, name: path.basename(vault.root), opened: Date.now() },
    ...(settings.recent || []).filter(x => x.root !== vault.root),
  ].slice(0, 20);
  await persist();
  previousTree = JSON.stringify(state.tree);
  return state;
}
async function copySeed(source, target) {
  // fs.cp uses Node internals that bypass Electron's ASAR filesystem patches.
  // Read through the patched public APIs so first launch works when packaged.
  await fs.mkdir(target, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name),
      to = path.join(target, entry.name);
    if (entry.isDirectory()) await copySeed(from, to);
    else if (entry.isFile()) {
      await fs.writeFile(to, await fs.readFile(from), { flag: 'wx' });
    }
  }
}
function deleteVault(root) {
  const task=vaultTransition.then(async()=>{
    const current=vault,relative=current&&path.relative(root,current.root);
    const active=!!current&&(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)));
    if(active){
      syncScheduler?.close();await sync?.cancel();await current.queue;
      watcher?.close();watcher=null;clearTimeout(watchTimer);
      codeRunner.close();resultStore.clear();wasmTerminal.closeAll();hostTerminal.closeAll();
    }
    try{await shell.trashItem(root);}catch(error){
      if(active){codeRunner.open();watchVault();if(!current.recoveryError)syncScheduler?.configure((await connections.get(current.root)).webdav);}
      throw error;
    }
    if(active){vault=null;references=null;attachments=null;codeData=null;documentFiles=null;drawings=null;sync=null;syncScheduler=null;previousTree='';codeRunner.open();}
    return active;
  });
  vaultTransition=task.then(()=>{},()=>{});return task;
}
function registerIPC() {
  handle('update-state', () => appUpdates.state());
  handle('update-check', manual => appUpdates.check(manual === true));
  handle('update-configure', automatic => appUpdates.configure(automatic));
  const dataActions = dataOperations({
      root: dataRoot,
      legacy: legacyData,
      store: dataStore,
      settings: () => settings,
      vault: () => vault,
      window: () => window,
      configFile,
      persist,
      setVault,
      deleteVault,
      copySeed,
    });
  const feature = require('./features/index.cjs').createFeatureRouter({
    get codeData() { return codeData; },
    get dataStore() { return dataStore; },
    get vault() { return vault; },
    get codeRunner() { return codeRunner; },
    get resultStore() { return resultStore; },
    get htmlResults() { return htmlResults; },
    get pinnedHTML() { return pinnedHTML; },
    get attachments() { return attachments; },
    get dialog() { return dialog; },
    get window() { return window; },
    get documentFiles() { return documentFiles; },
    get trashWithReferences() { return trashWithReferences; },
    get htmlFileViews() { return htmlFileViews; },
    get runtimeState() { return runtimeState; },
    get runtimeSettings() { return runtimeSettings; },
    get managedRuntimes() { return managedRuntimes; },
    get downloads() { return downloads; },
    get javascriptPackages() { return javascriptPackages; },
    get pythonManager() { return pythonManager; },
    get systemFonts() { return systemFonts; },
    get drawings() { return drawings; },
    get connections() { return connections; },
    get syncScheduler() { return syncScheduler; },
    get sync() { return sync; },
    get references() { return references; },
    get refreshAfterSync() { return refreshAfterSync; },
    get hostTerminal() { return hostTerminal; },
    get wasmTerminal() { return wasmTerminal; },
  }, dataActions);
  handle('feature', feature);
  handle('load', async () => {if(!vault)return null;const state=await vault.list();return {...state,warnings:[...(state.warnings||[]),...[...references.unreadable].map(([name,value])=>name+'：'+value.message)]};});
  handle('list', () => vault.list());
  handle('open-vault', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: '打开 Markdown 工作空间',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : setVault(result.filePaths[0]);
  });
  handle('read', (relative) => vault.read(relative));
  handle('save', async (name, content, version, root) => {
    const current = vault;
    if(root && root!==current?.root)throw new Error('知识库已切换。');
    const saved = await current.save(name, content, version);
    if(current===vault && /\.(md|markdown)$/i.test(saved.path))await attachments.documents.sync(saved.path,saved.content);
    void scanVault();
    syncScheduler?.changed();
    return saved;
  });
  handle('create', async (relative,kind,content='') => {if(kind==='file'&&/\.(md|markdown)$/i.test(relative))content=(await import('../shared/code-documents.mjs')).normalizeIds(content).content;const created=await vault.create(relative,kind,content);if(kind==='file'&&/\.(md|markdown)$/i.test(relative))await attachments.documents.sync(relative,content);return created;});
  handle('rename', (from, to) => documentFiles.rename({ from, to }));
  handle('trash', relative=>trashWithReferences({path:relative}));
  handle('search', (query) => vault.search(query));
  handle('upload', (...args) => vault.attachment(...args));
  handle('asset-data', async (relative) => {
    if (
      typeof relative !== 'string'
      || require('../shared/file-kind.mjs').fileKind(relative)!=='image'
    ) {
      throw new Error('图片路径无效。');
    }
    const target = await vault.resolve(relative);
    if ((await fs.stat(target)).size > 20 * 1024 * 1024) {
      throw new Error('图片超过 20 MB。');
    }
    const extension = path
      .extname(target)
      .slice(1)
      .toLowerCase()
      .replace('jpg', 'jpeg')
      .replace('svg', 'svg+xml');
    const mime = ({jfif:'jpeg',pjpeg:'jpeg',pjp:'jpeg',ico:'x-icon',cur:'x-icon'})[extension] || extension;
    return `data:image/${mime};base64,${(await fs.readFile(target)).toString('base64')}`;
  });
  handle('reveal', async (relative) => {
    shell.showItemInFolder(await vault.resolve(relative));
    return true;
  });
  handle('external', async (url) => {
    const parsed = new URL(url);
    if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) {
      throw new Error('不支持这个链接类型。');
    }
    await shell.openExternal(parsed.href);
  });
  handle('import', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: '导入 Markdown 文档',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    const paths = [];
    for (const source of result.filePaths) {
      const content = await fs.readFile(source, 'utf8');
      let name = path.basename(source),
        suffix = 1;
      while (true) {
        try {
          await vault.create(name, 'file', content);
          paths.push(name);
          break;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          name = `${path.parse(source).name} (${suffix++}).md`;
        }
      }
    }
    return paths;
  });
  handle('export', async (kind, name, content) => {
    if (!['md', 'html'].includes(kind) || typeof content !== 'string') {
      throw new Error('导出格式无效。');
    }
    const result = await dialog.showSaveDialog(window, {
      title: '导出文档',
      defaultPath: `${path.basename(name, path.extname(name))}.${kind}`,
      filters: [
        { name: kind === 'md' ? 'Markdown' : 'HTML', extensions: [kind] },
      ],
    });
    if (result.canceled) return false;
    await fs.writeFile(result.filePath, content, 'utf8');

    return true;
  });
  handle('pdf', async (name, html) => {
    if (typeof html !== 'string' || Buffer.byteLength(html) > 64 * 1024 * 1024) {
      throw new Error('PDF 内容无效或过大。');
    }
    const result = await dialog.showSaveDialog(window, {
      title: '导出 PDF',
      defaultPath: path.basename(name, path.extname(name)) + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled) return false;
    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    try {
      await printWindow.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
      await printWindow.webContents.executeJavaScript(
        `Promise.race([Promise.all([document.fonts.ready,...Array.from(document.images,image=>image.decode().catch(()=>{}))]),new Promise(resolve=>setTimeout(resolve,8000))])`,
      );
      const pdf = await printWindow.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        pageSize: 'A4',
        margins: { top: 0.5, bottom: 0.5, left: 0.55, right: 0.55 },
      });
      await fs.writeFile(result.filePath, pdf);

      return true;
    } finally {
      printWindow.destroy();
    }
  });
  handle('window', (action) => {
    if (action === 'minimize') window.minimize();
    if (action === 'maximize') {
      window.isMaximized() ? window.unmaximize() : window.maximize();
    }
    if (action === 'close') {
      codeRunner.stop();
      window.close();
    }
  });
  handle('confirm-close', confirmWindowClose);
}
function setMenu() {
  const item = (label, accelerator, command) => ({
    label,
    accelerator,
    click: () => send(command),
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin'
        ? [
          {
            label: '墨屿',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'quit' },
            ],
          },
        ]
        : []),
      {
        label: '文件',
        submenu: [
          item('新建文档', 'CmdOrCtrl+N', 'new'),
          item('打开工作空间…', 'CmdOrCtrl+O', 'open'),
          item('导入 Markdown…', 'CmdOrCtrl+Shift+O', 'import'),
          { type: 'separator' },
          item('保存', 'CmdOrCtrl+S', 'save'),
          item('导出 Markdown…', 'CmdOrCtrl+Shift+S', 'export-md'),
          item('导出 PDF…', 'CmdOrCtrl+Alt+P', 'export-pdf'),
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
          { type: 'separator' },
          item('搜索工作空间', 'CmdOrCtrl+Shift+F', 'search'),
        ],
      },
      {
        label: '视图',
        submenu: [
          item('切换源码模式', 'CmdOrCtrl+E', 'mode'),
          item('切换侧栏', 'CmdOrCtrl+Alt+B', 'sidebar'),
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'togglefullscreen' },
          ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : []),
        ],
      },
      {
        label: '帮助',
        submenu: [
          item('使用指南', undefined, 'guide'),
          item('快捷键', undefined, 'shortcuts'),
          { type: 'separator' },
          item('检查更新…', undefined, 'updates'),
        ],
      },
    ]),
  );
}
async function createWindow() {
  codeRunner.open();
  closing = false;
  window = new BrowserWindow({
    width: settings.bounds?.width ?? 1440,
    height: settings.bounds?.height ?? 940,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#191b20',
    title: '墨屿 Moyu',
    icon: path.join(__dirname, '../resources/icon.png'),
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: !process.env.MOYU_TEST,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      offscreen: process.env.MOYU_TEST === '1' && process.env.MOYU_TEST_OFFSCREEN === '1',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      partition: 'moyu-ui',
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (['http:', 'https:', 'mailto:'].includes(new URL(url).protocol)) {
        shell.openExternal(url).catch(() => {});
      }
    } catch {}
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('close', (event) => {
    settings.bounds = window.getBounds();
    if (!closing) persist().catch(() => {});
    if (!closing) {
      event.preventDefault();
      window.webContents.send('moyu:before-close');
    }
  });
  if (!app.isPackaged && process.env.MOYU_DEV_URL) {
    const url = new URL(process.env.MOYU_DEV_URL);
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      throw new Error('开发服务必须运行在本机。');
    }
    await window.loadURL(url.href);
  } else await window.loadURL('moyu://app/index.html');
}
app
  .whenReady()
  .then(async () => {
    await fs.mkdir(dataRoot, { recursive: true });
    if (!(process.env.MOYU_TEST === '1' && process.env.MOYU_TEST_SKIP_BUNDLED === '1')) await require('./bundled-runtimes.cjs').initializeBundledRuntimes(managedRuntimes);
    await require('./retired-data.cjs').removeExportHistory(dataRoot);
    settings = await applicationConfig.get('workspace');
    const defaultRoot = path.join(dataRoot, '示例知识库');
    const defaultWorkspace = async () => {
      await fs.mkdir(defaultRoot, { recursive: true });
      // Seed only an empty first-launch workspace, never overwrite user documents.
      if (!(await fs.readdir(defaultRoot)).length) {
        await copySeed(
          path.join(__dirname, '../resources/demo-vault'),
          defaultRoot,
        );
      }
      return defaultRoot;
    };
    try {
      if (settings.root) await setVault(settings.root);
      else if (process.env.MOYU_DEMO === '1') await setVault(await defaultWorkspace());
    } catch {
      settings.root = null;
    }
    session.fromPartition('moyu-ui').protocol.handle('moyu', async (request) => {
      const url = new URL(request.url);
      const root = path.resolve(__dirname, '../dist');
      const target = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (url.host !== 'app' || path.relative(root, target).startsWith('..')) {
        return new Response('Forbidden', { status: 403 });
      }
      return net.fetch(pathToFileURL(target).href);
    });
    session.fromPartition('moyu-ui').protocol.handle('moyu-asset', async (request) => {
      try {
        const url = new URL(request.url);
        if (url.host !== 'vault') throw new Error('Invalid asset');
        const relative = decodeURIComponent(url.pathname.slice(1));
        if (!/\.(png|apng|jpe?g|jfif|pjpeg|pjp|gif|webp|avif|svg|bmp|ico|cur|pdf|ttf|otf|woff2?)$/i.test(relative)) {
          throw new Error('Invalid asset');
        }
        const response = await net.fetch(pathToFileURL(await vault.resolve(relative)).href);
        const headers = new Headers(response.headers);
        headers.set(
          'Access-Control-Allow-Origin',
          !app.isPackaged && process.env.MOYU_DEV_URL
            ? new URL(process.env.MOYU_DEV_URL).origin
            : 'moyu://app',
        );
        return new Response(response.body, { status: response.status, headers });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });
    const uiSession = session.fromPartition('moyu-ui');
    uiSession.protocol.handle('moyu-html',request=>htmlResults.response(request));
    uiSession.protocol.handle('moyu-preview',request=>htmlFileViews.response(request));
    uiSession.webRequest.onBeforeRequest((details,callback)=>{
      const frame=details.frame;
      const scheme=frame?.url?.startsWith('moyu-html:')?'moyu-html:':frame?.url?.startsWith('moyu-preview:')?'moyu-preview:':null;
      if(scheme&&!details.url.startsWith(scheme)&&!details.url.startsWith('data:')&&!details.url.startsWith('blob:'))return callback({cancel:true});
      callback({cancel:false});
    });
    uiSession.setPermissionRequestHandler((contents, permission, callback) =>
      callback(contents === window?.webContents && permission === 'local-fonts')
    );
    uiSession.setPermissionCheckHandler((contents, permission) =>
      contents === window?.webContents && permission === 'local-fonts'
    );
    registerIPC();
    setMenu();
    await createWindow();
    timer = setInterval(() => {
      if (!watcher) void scanVault();
    }, 30000);
    window.on('focus', () => void scanVault());
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  })
  .catch((error) => {
    console.error(error);
    if (!process.env.MOYU_TEST) {
      dialog.showErrorBox('无法启动墨屿', error.message);
    }
    app.exit(1);
  });
app.on('before-quit', event => {
  if (closing) return;
  event.preventDefault();
  if (window && !window.isDestroyed()) window.close();
  else void confirmWindowClose().then(() => app.quit()).catch(error => console.error(error));
});
app.on('window-all-closed', () => {
  hostTerminal.closeAll();wasmTerminal.closeAll();
  if (process.platform !== 'darwin' && window) app.quit();
});
app.on('will-quit', () => {
  syncScheduler?.close(); void sync?.cancel();
  clearInterval(timer);
  clearTimeout(watchTimer);
  watcher?.close();
  codeRunner.close();
  require('./format.cjs').closeFormatter();
});
