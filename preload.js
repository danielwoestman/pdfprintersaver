const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // File dialogs
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),

  // File operations
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  copyFile: (src, destFolder) => ipcRenderer.invoke('file:copy', { src, destFolder }),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // Window / app actions
  openSettings: () => ipcRenderer.send('window:openSettings'),
  printPDF: (filePath) => ipcRenderer.invoke('print:pdf', filePath),

  // Events from main process → renderer
  onMenuOpenFile: (cb) => ipcRenderer.on('menu:openFile', cb),
  onSettingsUpdated: (cb) => ipcRenderer.on('settings:updated', cb),
});
