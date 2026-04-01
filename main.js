const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Linux: chrome-sandbox SUID setup is often missing in dev environments
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');

let mainWindow = null;
let settingsWindow = null;

// ── Settings persistence ──────────────────────────────────────────────────────

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  const file = getSettingsPath();
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
      console.error('Failed to parse settings.json:', e.message);
    }
  }
  return {
    buttons: Array.from({ length: 10 }, () => ({ label: '', folder: '' })),
  };
}

function saveSettings(settings) {
  fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
}

// ── Windows ───────────────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: 'PDF Printer Saver',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // required for preload fs access
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        {
          label: 'Open PDF…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:openFile'),
        },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: openSettingsWindow,
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function openSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 720,
    height: 640,
    resizable: false,
    parent: mainWindow,
    modal: true,
    title: 'Settings — Configure Buttons',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  settingsWindow.setMenu(null);
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
    mainWindow?.webContents.send('settings:updated');
  });
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Open PDF',
    filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
    properties: ['openFile'],
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('dialog:openFolder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Select Destination Folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return canceled ? null : filePaths[0];
});

// Returns raw Buffer — Electron serialises Buffer through contextBridge correctly
ipcMain.handle('file:read', (event, filePath) => {
  try {
    return { success: true, data: fs.readFileSync(filePath) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('file:copy', (event, { src, destFolder }) => {
  try {
    if (!fs.existsSync(destFolder)) {
      fs.mkdirSync(destFolder, { recursive: true });
    }
    const dest = path.join(destFolder, path.basename(src));
    fs.copyFileSync(src, dest);
    return { success: true, dest };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('settings:get', () => loadSettings());

ipcMain.handle('settings:save', (event, settings) => {
  try {
    saveSettings(settings);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.on('window:openSettings', openSettingsWindow);

// Open PDF with the OS default app for native multi-page printing
ipcMain.handle('print:pdf', (event, filePath) => shell.openPath(filePath));

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createMainWindow();
});
