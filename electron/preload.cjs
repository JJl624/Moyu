const { contextBridge, ipcRenderer } = require('electron');
// Return plain envelopes across contextBridge. Throwing an Error here would
// strip custom conflict/version fields at the isolated-world boundary.
const invoke = (channel, ...args) => ipcRenderer.invoke('moyu:' + channel, ...args);
const subscribe = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on('moyu:' + channel, listener);
  return () => ipcRenderer.removeListener('moyu:' + channel, listener);
};
contextBridge.exposeInMainWorld('moyu', {
  desktop: true,
  platform: process.platform,
  load: () => invoke('load'),
  feature: (action, input) => invoke('feature', action, input),
  openVault: () => invoke('open-vault'),
  list: () => invoke('list'),
  read: (path) => invoke('read', path),
  save: (path, content, version, root) => invoke('save', path, content, version, root),
  create: (path, kind, content) => invoke('create', path, kind, content),
  rename: (from, to) => invoke('rename', from, to),
  trash: (path) => invoke('trash', path),
  search: (query) => invoke('search', query),
  importFiles: () => invoke('import'),
  exportFile: (kind, name, content) => invoke('export', kind, name, content),
  exportPDF: (name, html) => invoke('pdf', name, html),
  upload: (document, name, bytes) => invoke('upload', document, name, bytes),
  assetData: (path) => invoke('asset-data', path),
  reveal: (path) => invoke('reveal', path),
  openExternal: (url) => invoke('external', url),
  windowControl: (action) => invoke('window', action),
  updateState: () => invoke('update-state'),
  checkUpdate: manual => invoke('update-check', manual),
  configureUpdate: automatic => invoke('update-configure', automatic),
  onChange: (callback) => subscribe('changed', callback),
  onScanError: callback => subscribe('scan-error',callback),
  onSync: (callback) => subscribe('sync', callback),
  onTerminal: (callback) => subscribe('terminal',callback),
  onDownload: (callback) => subscribe('download', callback),
  onCommand: (callback) => subscribe('command', callback),
  onBeforeClose: (callback) => subscribe('before-close', callback),
  confirmClose: () => invoke('confirm-close'),
});
