const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { PDFDocument, degrees, rgb, StandardFonts } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');          // SUID sandbox not set up in dev
  app.commandLine.appendSwitch('disable-gpu-vsync');   // suppresses GetVSyncParametersIfAvailable spam
  app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
}

let mainWindow = null;
let settingsWindow = null;

// ── Settings persistence ──────────────────────────────────────────────────────

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  const defaults = {
    buttons: Array.from({ length: 10 }, () => ({ label: '', folder: '' })),
    defaultPrinter: '',
    emailTemplates: Array.from({ length: 5 }, () => ({ label: '', toAddress: '', note: '' })),
  };
  const file = getSettingsPath();
  if (fs.existsSync(file)) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return { ...defaults, ...saved };
    } catch (e) {
      console.error('Failed to parse settings.json:', e.message);
    }
  }
  return defaults;
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
    width: 780,
    height: 760,
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

function findAvailablePath(destFolder, filename) {
  const ext      = path.extname(filename);
  const base     = path.basename(filename, ext);
  const today    = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dateName = `${base} ${today}`;
  let candidate  = path.join(destFolder, `${dateName}${ext}`);
  for (let i = 1; fs.existsSync(candidate); i++) {
    candidate = path.join(destFolder, `${dateName} (${i})${ext}`);
  }
  return candidate;
}

ipcMain.handle('file:copy', (event, { src, destFolder }) => {
  try {
    if (!fs.existsSync(destFolder)) {
      fs.mkdirSync(destFolder, { recursive: true });
    }
    const dest = findAvailablePath(destFolder, path.basename(src));
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

// List available printers via the main window's webContents
ipcMain.handle('printers:get', async () => {
  try {
    const list = await mainWindow.webContents.getPrintersAsync();
    return list.map(p => ({ name: p.name, isDefault: p.isDefault }));
  } catch (e) {
    return [];
  }
});

// Print PDF — direct to printer if one is configured, else open in OS viewer
ipcMain.handle('print:pdf', async (event, { filePath, printerName }) => {
  if (!printerName) {
    await shell.openPath(filePath);
    return { success: true };
  }
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // PrintTo verb routes to the registered PDF handler's print target
      execFile('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Start-Process -FilePath "${filePath.replace(/"/g, '\\"')}" -Verb PrintTo -ArgumentList "${printerName.replace(/"/g, '\\"')}"`,
      ], (err) => resolve(err ? { success: false, error: err.message } : { success: true }));
    } else {
      // macOS / Linux: lp command
      execFile('lp', ['-d', printerName, filePath],
        (err) => resolve(err ? { success: false, error: err.message } : { success: true }));
    }
  });
});

// Escape a string for use inside a PowerShell double-quoted string literal
function escapePsStr(str) {
  return (str || '')
    .replace(/`/g,    '``')   // backtick → ``
    .replace(/"/g,    '`"')   // " → `"
    .replace(/\$/g,   '`$')   // $ → `$ (prevent variable expansion)
    .replace(/\r?\n/g, '`n'); // newlines → `n
}

// Open email with attachment via Outlook COM (Windows); falls back to mailto: if Outlook absent
ipcMain.handle('email:open', async (event, { toAddress, filePath, note }) => {
  const subject = `PDF: ${path.basename(filePath)}`;
  const safePath    = escapePsStr(filePath.replace(/\\/g, '\\\\'));
  const safeSubject = escapePsStr(subject);
  const safeTo      = escapePsStr(toAddress);
  const safeNote    = escapePsStr(note);

  const ps = `
try {
  $ol   = New-Object -ComObject Outlook.Application
  $mail = $ol.CreateItem(0)
  $mail.Subject = "${safeSubject}"
  ${safeTo      ? `$mail.To   = "${safeTo}"` : ''}
  ${safeNote    ? `$mail.Body = "${safeNote}"` : ''}
  $mail.Attachments.Add("${safePath}")
  $mail.Display($false)
} catch { exit 1 }
`.trim();

  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      (err) => {
        if (!err) return resolve({ success: true });
        // Outlook not available — open mailto: without attachment
        const mailtoUrl = (toAddress ? `mailto:${toAddress}` : 'mailto:')
          + `?subject=${encodeURIComponent(subject)}`
          + (note ? `&body=${encodeURIComponent(note)}` : '');
        shell.openExternal(mailtoUrl)
          .then(() => resolve({ success: true, fallback: true }))
          .catch((e) => resolve({ success: false, error: e.message }));
      });
  });
});

ipcMain.handle('system:info', () => {
  const interfaces = os.networkInterfaces();
  let ip = '—';
  outer: for (const iface of Object.values(interfaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) { ip = addr.address; break outer; }
    }
  }
  return {
    ip,
    hostname: os.hostname(),
    username: os.userInfo().username,
    platform: `${os.platform()} ${os.release()}`,
  };
});

ipcMain.handle('pdf:process', async (event, { src, destFolder, rotation, signature }) => {
  try {
    const bytes = fs.readFileSync(src);
    const doc = await PDFDocument.load(bytes);
    doc.registerFontkit(fontkit);
    const pages = doc.getPages();

    if (rotation) {
      for (const page of pages) {
        const cur = page.getRotation().angle;
        page.setRotation(degrees((cur + rotation) % 360));
      }
    }

    if (signature) {
      const fontBytes = fs.readFileSync(path.join(__dirname, 'assets', 'Caveat-Regular.ttf'));
      const caveat = await doc.embedFont(fontBytes);
      const helv = await doc.embedFont(StandardFonts.Helvetica);

      const lastPage = pages[pages.length - 1];
      const { width, height } = lastPage.getSize();

      const bW = 240, bH = 88, margin = 20;
      const bX = width - bW - margin;
      const bY = margin;

      lastPage.drawRectangle({
        x: bX, y: bY, width: bW, height: bH,
        color: rgb(0.97, 0.97, 1),
        borderColor: rgb(0.55, 0.55, 0.7),
        borderWidth: 0.6,
        opacity: 0.95,
      });

      lastPage.drawText(signature.name, {
        x: bX + 10, y: bY + bH - 32,
        font: caveat, size: 22,
        color: rgb(0.08, 0.1, 0.45),
      });

      lastPage.drawLine({
        start: { x: bX + 10, y: bY + bH - 38 },
        end:   { x: bX + bW - 10, y: bY + bH - 38 },
        thickness: 0.4, color: rgb(0.7, 0.7, 0.8),
      });

      [
        `Date:    ${signature.date}`,
        `IP:      ${signature.ip}`,
        `Device:  ${signature.device}`,
      ].forEach((line, i) => {
        lastPage.drawText(line, {
          x: bX + 10, y: bY + bH - 52 - i * 13,
          font: helv, size: 8,
          color: rgb(0.35, 0.35, 0.45),
        });
      });
    }

    const modified = await doc.save();
    if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });
    const dest = findAvailablePath(destFolder, path.basename(src));
    fs.writeFileSync(dest, modified);
    return { success: true, dest };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

function getPdfArgPath(argv) {
  // Skip electron/node runtime flags and the app entry point
  return argv.slice(1).find(a => !a.startsWith('-') && a.toLowerCase().endsWith('.pdf')) || null;
}

// Single-instance lock — when the user double-clicks a second PDF while the
// app is already open, forward the path to the existing window instead of
// opening a second instance.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    const filePath = getPdfArgPath(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (filePath) mainWindow.webContents.send('file:open-path', filePath);
    }
  });

  app.whenReady().then(() => {
    createMainWindow();

    const filePath = getPdfArgPath(process.argv);
    if (filePath) {
      mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('file:open-path', filePath);
      });
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (!mainWindow) createMainWindow();
  });
}
