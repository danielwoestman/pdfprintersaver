import * as pdfjsLib from '../node_modules/pdfjs-dist/build/pdf.min.mjs';

// Point the worker at the local copy so the app works offline / when packaged
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

// ── State ─────────────────────────────────────────────────────────────────────

let pdfDoc       = null;
let currentPage  = 1;
let totalPages   = 0;
let currentPath  = null;   // absolute path of the open file
let zoom         = 1.0;
let settings     = { buttons: [] };

// ── DOM refs ──────────────────────────────────────────────────────────────────

const canvas       = document.getElementById('pdf-canvas');
const ctx          = canvas.getContext('2d');
const emptyState   = document.getElementById('pdf-empty-state');
const pageInfo     = document.getElementById('page-info');
const zoomLabel    = document.getElementById('zoom-level');
const statusFile   = document.getElementById('status-file');
const statusMsg    = document.getElementById('status-msg');
const toast        = document.getElementById('toast');
const actionBtns   = document.getElementById('action-buttons');
const actionPopup  = document.getElementById('action-popup');

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  settings = await window.electronAPI.getSettings();
  renderActionButtons();

  window.electronAPI.onMenuOpenFile(() => openFile());
  window.electronAPI.onSettingsUpdated(async () => {
    settings = await window.electronAPI.getSettings();
    renderActionButtons();
    syncActionButtonState();
  });
}

// ── Action buttons ────────────────────────────────────────────────────────────

function renderActionButtons() {
  actionBtns.innerHTML = '';

  settings.buttons.forEach((btn, i) => {
    const configured = !!(btn.label && btn.folder);
    const el = document.createElement('button');
    el.className = 'action-btn' + (configured ? '' : ' unconfigured');
    el.dataset.index = String(i);
    el.textContent = configured ? btn.label : `Button ${i + 1}`;
    el.disabled = !configured || !currentPath;
    el.title = configured
      ? `Copy PDF to: ${btn.folder}`
      : 'Not configured — open Settings to set a label and folder';
    el.addEventListener('click', (e) => handleActionButton(i, e.currentTarget));
    actionBtns.appendChild(el);
  });
}

function syncActionButtonState() {
  actionBtns.querySelectorAll('.action-btn').forEach((el, i) => {
    const btn = settings.buttons[i];
    const configured = !!(btn?.label && btn?.folder);
    el.disabled = !configured || !currentPath;
  });
  document.getElementById('btn-print').disabled = !currentPath;
}

async function handleActionButton(index, buttonEl) {
  if (!currentPath) return;
  const btn = settings.buttons[index];
  if (!btn?.label || !btn?.folder) return;

  const result = await window.electronAPI.copyFile(currentPath, btn.folder);
  if (result.success) {
    showButtonPopup(buttonEl, `✓ Saved to "${btn.label}"`);
    showStatus(`Copied → ${result.dest}`);
  } else {
    showButtonPopup(buttonEl, `✗ ${result.error}`, true);
  }
}

// ── Open / render PDF ─────────────────────────────────────────────────────────

async function openFile() {
  const filePath = await window.electronAPI.openFile();
  if (!filePath) return;

  const read = await window.electronAPI.readFile(filePath);
  if (!read.success) {
    showToast(`✗ Cannot read file: ${read.error}`, 'error');
    return;
  }

  try {
    // pdfjs accepts a Uint8Array directly
    const data = read.data instanceof Uint8Array ? read.data : new Uint8Array(read.data);
    pdfDoc      = await pdfjsLib.getDocument({ data }).promise;
    totalPages  = pdfDoc.numPages;
    currentPage = 1;
    currentPath = filePath;
    zoom        = 1.0;

    emptyState.style.display = 'none';
    canvas.style.display = 'block';

    await renderPage(currentPage);
    updateNavState();
    syncActionButtonState();

    const name = filePath.replace(/\\/g, '/').split('/').pop();
    statusFile.textContent = `${name}  (${totalPages} page${totalPages !== 1 ? 's' : ''})`;
  } catch (e) {
    showToast(`✗ Failed to open PDF: ${e.message}`, 'error');
    console.error(e);
  }
}

async function renderPage(pageNum) {
  const page     = await pdfDoc.getPage(pageNum);
  const dpr      = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: zoom * dpr });

  canvas.width  = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width  = `${viewport.width  / dpr}px`;
  canvas.style.height = `${viewport.height / dpr}px`;

  await page.render({ canvasContext: ctx, viewport }).promise;

  pageInfo.textContent = `${pageNum} / ${totalPages}`;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

// ── Navigation ────────────────────────────────────────────────────────────────

function updateNavState() {
  document.getElementById('btn-prev').disabled     = !pdfDoc || currentPage <= 1;
  document.getElementById('btn-next').disabled     = !pdfDoc || currentPage >= totalPages;
  document.getElementById('btn-zoom-out').disabled = !pdfDoc;
  document.getElementById('btn-zoom-in').disabled  = !pdfDoc;
  document.getElementById('btn-zoom-fit').disabled = !pdfDoc;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

async function goToPage(n) {
  currentPage = Math.max(1, Math.min(n, totalPages));
  await renderPage(currentPage);
  updateNavState();
}

async function changeZoom(newZoom) {
  zoom = Math.max(0.25, Math.min(4.0, newZoom));
  await renderPage(currentPage);
  updateNavState();
}

// ── Event listeners ───────────────────────────────────────────────────────────

document.getElementById('btn-open').addEventListener('click', openFile);

document.getElementById('btn-prev').addEventListener('click', () => {
  if (pdfDoc && currentPage > 1) goToPage(currentPage - 1);
});

document.getElementById('btn-next').addEventListener('click', () => {
  if (pdfDoc && currentPage < totalPages) goToPage(currentPage + 1);
});

document.getElementById('btn-zoom-out').addEventListener('click', () => {
  if (pdfDoc) changeZoom(Math.round((zoom - 0.25) * 4) / 4);
});

document.getElementById('btn-zoom-in').addEventListener('click', () => {
  if (pdfDoc) changeZoom(Math.round((zoom + 0.25) * 4) / 4);
});

document.getElementById('btn-zoom-fit').addEventListener('click', async () => {
  if (!pdfDoc) return;
  const page       = await pdfDoc.getPage(currentPage);
  const container  = document.getElementById('pdf-container');
  const natural    = page.getViewport({ scale: 1 });
  const fit        = (container.clientWidth - 48) / natural.width;
  changeZoom(fit);
});

document.getElementById('btn-print').addEventListener('click', async () => {
  if (!currentPath) return;
  const result = await window.electronAPI.printPDF(currentPath, settings.defaultPrinter || null);
  if (result && !result.success) showToast(`✗ Print failed: ${result.error}`, 'error');
});

document.getElementById('btn-settings').addEventListener('click', () => {
  window.electronAPI.openSettings();
});

// Keyboard page navigation
document.addEventListener('keydown', (e) => {
  if (!pdfDoc) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown'  || e.key === 'PageDown') {
    if (currentPage < totalPages) goToPage(currentPage + 1);
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
    if (currentPage > 1) goToPage(currentPage - 1);
  } else if (e.key === 'Home') {
    goToPage(1);
  } else if (e.key === 'End') {
    goToPage(totalPages);
  }
});

// ── Notifications ─────────────────────────────────────────────────────────────

let toastTimer = null;

function showToast(message, type = 'success') {
  toast.textContent = message;
  toast.className = type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'hidden'; }, 3200);
}

let popupTimer = null;

function showButtonPopup(buttonEl, message, isError = false) {
  const rect = buttonEl.getBoundingClientRect();
  // Centre the popup on the button horizontally, 10px below its bottom edge
  const centreX = rect.left + rect.width / 2;
  const top     = rect.bottom + 10;

  actionPopup.textContent = message;
  // Reset class first so the transition re-fires on repeated clicks
  actionPopup.className = 'hidden';
  // Force a reflow so the browser registers the class change before we remove hidden
  void actionPopup.offsetWidth;

  actionPopup.style.left = `${centreX}px`;
  actionPopup.style.top  = `${top}px`;
  actionPopup.className  = isError ? 'error' : '';

  clearTimeout(popupTimer);
  popupTimer = setTimeout(() => { actionPopup.className = 'hidden'; }, 2500);
}

let statusTimer = null;

function showStatus(message) {
  statusMsg.textContent = message;
  statusMsg.classList.remove('hidden');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusMsg.classList.add('hidden');
  }, 4000);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

init();
