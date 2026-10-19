const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.MOYU_USER_DATA);
app.setPath('sessionData', process.env.MOYU_USER_DATA);
app.whenReady().then(() =>
  new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  }).loadURL('about:blank')
);
