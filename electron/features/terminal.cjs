function createTerminalOperations(services) {
  const owner=input=>input?.id?.startsWith('wasm-')?services.wasmTerminal:services.hostTerminal;
  return {
    'terminal.open': (input) => {
      if(services.hostTerminal.list().length+(services.wasmTerminal?.sessions.size||0)+(services.wasmTerminal?.pending||0)>=6)throw Error('最多同时打开 6 个终端。');
      return input.shell==='moyu:bash-wasm'?services.wasmTerminal.open():services.hostTerminal.open({ ...input, cwd: input.cwd || services.vault?.root });
    },
    'terminal.list': () => [...services.hostTerminal.list(),...(services.wasmTerminal?.list()||[])],
    'terminal.shells': async () => [...await services.hostTerminal.shells(),...(services.wasmTerminal?.shells()||[])],
    'terminal.pick-program': async () => {
      const result = await services.dialog.showOpenDialog(services.window, {
        title: '选择终端程序',
        properties: ['openFile'],
        ...(process.platform === 'win32' ? { filters: [{ name: '程序', extensions: ['exe'] }] } : {}),
      });
      return result.canceled ? '' : result.filePaths[0];
    },
    'terminal.snapshot': (input) => owner(input).snapshot(input.id),
    'terminal.write': (input) => owner(input).write(input),
    'terminal.resize': (input) => owner(input).resize(input),
    'terminal.ack': (input) => owner(input).acknowledge(input),
    'terminal.close': (input) => owner(input).close(input.id),
    'terminal.close-all': () => {services.hostTerminal.closeAll();services.wasmTerminal?.closeAll();},
    'terminal.focus': (input) => services.window?.webContents.setIgnoreMenuShortcuts(!!input.focused),
  };
}
module.exports = { createTerminalOperations };
