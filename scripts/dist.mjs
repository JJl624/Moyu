if (process.platform === 'win32') await import('./dist-win.mjs');
else await (await import('electron-builder')).build({publish:'never'});
