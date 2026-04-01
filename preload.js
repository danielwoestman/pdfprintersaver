const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // File dialogs
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  saveFileDialog: (defaultName) => ipcRenderer.invoke('dialog:saveFile', defaultName),

  // File operations
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  copyFile: (src, destFolder) => ipcRenderer.invoke('file:copy', { src, destFolder }),
  saveFileAs: (src, destPath, rotation, signature) =>
    ipcRenderer.invoke('file:save-as', { src, destPath, rotation, signature }),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // Window / app actions
  openSettings: () => ipcRenderer.send('window:openSettings'),
  printPDF: (filePath, printerName) => ipcRenderer.invoke('print:pdf', { filePath, printerName }),
  printWindow: (printerName) => ipcRenderer.invoke('print:window', printerName),
  getPrinters: () => ipcRenderer.invoke('printers:get'),
  emailPDF: (toAddress, filePath, note) => ipcRenderer.invoke('email:open', { toAddress, filePath, note }),

  // PDF processing (rotation + signature)
  processPdf: (src, destFolder, rotation, signature) =>
    ipcRenderer.invoke('pdf:process', { src, destFolder, rotation, signature }),
  getSystemInfo: () => ipcRenderer.invoke('system:info'),

  // Events from main process → renderer
  onMenuOpenFile: (cb) => ipcRenderer.on('menu:openFile', cb),
  onSettingsUpdated: (cb) => ipcRenderer.on('settings:updated', cb),
  onOpenFilePath: (cb) => ipcRenderer.on('file:open-path', (_, filePath) => cb(filePath)),
});
