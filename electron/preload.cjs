/** The desktop app's bridge between the game page and electron/main.cjs; see src/data/desktop.ts. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('arenaDesktop', {
  chooseFolder: () => ipcRenderer.invoke('arena:choose-folder'),
  reopenFolder: () => ipcRenderer.invoke('arena:reopen-folder'),
  rememberFolder: () => ipcRenderer.invoke('arena:remember-folder'),
  readFile: (path) => ipcRenderer.invoke('arena:read-file', path),
});
