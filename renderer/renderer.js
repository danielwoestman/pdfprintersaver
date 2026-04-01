import * as pdfjsLib from '../node_modules/pdfjs-dist/build/pdf.min.mjs';

// Point the worker at the local copy so the app works offline / when packaged
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

// ── State ─────────────────────────────────────────────────────────────────────

let pdfDoc           = null;
let currentPage      = 1;
let totalPages       = 0;
let currentPath      = null;   // absolute path of the open file
let zoom             = 1.0;
let displayRotation  = 0;      // additional rotation applied by user (0/90/180/270)
let pendingSignature = null;   // { name, date, ip, device } or null
let systemInfo       = null;   // { ip, hostname, username, platform }
let settings         = { buttons: [] };

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
  [settings, systemInfo] = await Promise.all([
    window.electronAPI.getSettings(),
    window.electronAPI.getSystemInfo(),
  ]);
  renderActionButtons();

  window.electronAPI.onMenuOpenFile(() => openFile());
  window.electronAPI.onOpenFilePath((filePath) => loadPdfFromPath(filePath));
  window.electronAPI.onSettingsUpdated(async () => {
    settings = await window.electronAPI.getSettings();
    renderActionButtons();
    syncActionButtonState();
  });

  // Rotate button
  document.getElementById('btn-rotate').addEventListener('click', () => {
    displayRotation = (displayRotation + 90) % 360;
    const label = document.getElementById('rotation-label');
    if (displayRotation === 0) {
      label.textContent = '';
      label.classList.remove('visible');
    } else {
      label.textContent = `${displayRotation}°`;
      label.classList.add('visible');
    }
    renderPage(currentPage);
  });

  // Save As button
  document.getElementById('btn-save-as').addEventListener('click', saveFileAs);

  // Sign button
  document.getElementById('btn-sign').addEventListener('click', openSignModal);
  document.getElementById('sign-cancel').addEventListener('click', closeSignModal);
  document.getElementById('sign-confirm').addEventListener('click', applySignature);
  document.getElementById('sign-clear').addEventListener('click', clearSignature);
  document.getElementById('sign-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSignModal();
  });

  // Live preview as user types
  document.getElementById('sign-name-input').addEventListener('input', (e) => {
    document.getElementById('sign-preview-name').textContent = e.target.value || 'Your Name';
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
  const hasEmailTemplate = (settings.emailTemplates || []).some(t => t.label && t.toAddress);
  document.getElementById('btn-email').disabled   = !currentPath || !hasEmailTemplate;
  document.getElementById('btn-print').disabled   = !currentPath;
  document.getElementById('btn-rotate').disabled  = !currentPath;
  document.getElementById('btn-sign').disabled    = !currentPath;
  document.getElementById('btn-save-as').disabled = !currentPath;
}

async function handleActionButton(index, buttonEl) {
  if (!currentPath) return;
  const btn = settings.buttons[index];
  if (!btn?.label || !btn?.folder) return;

  let result;
  if (displayRotation !== 0 || pendingSignature) {
    result = await window.electronAPI.processPdf(
      currentPath, btn.folder, displayRotation, pendingSignature
    );
  } else {
    result = await window.electronAPI.copyFile(currentPath, btn.folder);
  }

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
  if (filePath) await loadPdfFromPath(filePath);
}

async function loadPdfFromPath(filePath) {
  const read = await window.electronAPI.readFile(filePath);
  if (!read.success) {
    showToast(`✗ Cannot read file: ${read.error}`, 'error');
    return;
  }

  try {
    // pdfjs accepts a Uint8Array directly
    const data = read.data instanceof Uint8Array ? read.data : new Uint8Array(read.data);
    pdfDoc           = await pdfjsLib.getDocument({ data }).promise;
    totalPages       = pdfDoc.numPages;
    currentPage      = 1;
    currentPath      = filePath;
    zoom             = 1.0;
    displayRotation  = 0;
    pendingSignature = null;

    // Reset rotation label and sign button
    const rotLabel = document.getElementById('rotation-label');
    rotLabel.textContent = '';
    rotLabel.classList.remove('visible');
    document.getElementById('btn-sign').classList.remove('active');

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
  const viewport = page.getViewport({ scale: zoom * dpr, rotation: displayRotation });

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

// ── Email dropdown ────────────────────────────────────────────────────────────

const emailDropdown = document.getElementById('email-dropdown');

function renderEmailDropdown() {
  emailDropdown.innerHTML = '';
  const templates = (settings.emailTemplates || []).filter(t => t.label && t.toAddress);

  if (templates.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'email-drop-empty';
    msg.textContent = 'No templates configured';
    emailDropdown.appendChild(msg);
    return;
  }

  templates.forEach((t) => {
    const item = document.createElement('button');
    item.className = 'email-drop-item';
    item.textContent = t.label;
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      emailDropdown.classList.add('hidden');
      const result = await window.electronAPI.emailPDF(t.toAddress, currentPath, t.note || '');
      if (!result.success) {
        showToast('✗ No email client found — set a default email app in your system settings.', 'error');
      } else if (result.fallback) {
        showToast('⚠ Outlook not found — email opened without attachment', 'error');
      }
    });
    emailDropdown.appendChild(item);
  });
}

document.getElementById('btn-email').addEventListener('click', (e) => {
  if (!currentPath) return;
  e.stopPropagation();
  renderEmailDropdown();
  emailDropdown.classList.toggle('hidden');
});

// Close dropdown when clicking anywhere else
document.addEventListener('click', () => emailDropdown.classList.add('hidden'));

document.getElementById('btn-print').addEventListener('click', async () => {
  if (!currentPath) return;
  const printerName = settings.defaultPrinter || null;

  if (!printerName) {
    // No printer set — open in system default viewer
    const result = await window.electronAPI.printPDF(currentPath, null);
    if (result && !result.success) showToast(`✗ Print failed: ${result.error}`, 'error');
    return;
  }

  // Render all pages to canvases, then silently print the main window
  const printPages = document.getElementById('print-pages');
  printPages.innerHTML = '';
  for (let i = 1; i <= totalPages; i++) {
    const page     = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: 2.0, rotation: displayRotation });
    const c        = document.createElement('canvas');
    c.width  = viewport.width;
    c.height = viewport.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;
    printPages.appendChild(c);
  }

  const result = await window.electronAPI.printWindow(printerName);
  printPages.innerHTML = '';
  if (!result.success) showToast(`✗ Print failed: ${result.error}`, 'error');
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
  const rect        = buttonEl.getBoundingClientRect();
  const idealCentreX = rect.left + rect.width / 2;
  const top          = rect.bottom + 10;

  actionPopup.textContent = message;
  actionPopup.className   = 'hidden';
  void actionPopup.offsetWidth; // force reflow so transition re-fires

  actionPopup.style.left = `${idealCentreX}px`;
  actionPopup.style.top  = `${top}px`;
  actionPopup.className  = isError ? 'error' : '';

  // After the browser lays out the popup, clamp so it never overflows either edge
  requestAnimationFrame(() => {
    const pr     = actionPopup.getBoundingClientRect();
    const margin = 10;
    if (pr.left < margin) {
      actionPopup.style.left = `${idealCentreX + (margin - pr.left)}px`;
    } else if (pr.right > window.innerWidth - margin) {
      actionPopup.style.left = `${idealCentreX - (pr.right - (window.innerWidth - margin))}px`;
    }
  });

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

// ── Save As ───────────────────────────────────────────────────────────────────

async function saveFileAs() {
  if (!currentPath) return;
  const defaultName = currentPath.replace(/\\/g, '/').split('/').pop();
  const destPath = await window.electronAPI.saveFileDialog(defaultName);
  if (!destPath) return;

  const result = await window.electronAPI.saveFileAs(
    currentPath, destPath, displayRotation, pendingSignature
  );

  if (result.success) {
    showStatus(`Saved → ${result.dest}`);
  } else {
    showToast(`✗ Save failed: ${result.error}`, 'error');
  }
}

// ── Signature modal ───────────────────────────────────────────────────────────

function openSignModal() {
  const overlay  = document.getElementById('sign-overlay');
  const nameInput = document.getElementById('sign-name-input');
  const clearBtn  = document.getElementById('sign-clear');

  // Pre-fill if already signed
  nameInput.value = pendingSignature?.name || '';
  document.getElementById('sign-preview-name').textContent = pendingSignature?.name || 'Your Name';
  clearBtn.classList.toggle('hidden', !pendingSignature);

  // Fill preview details from system info
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('sign-preview-date').textContent   = `Date:    ${dateStr}`;
  document.getElementById('sign-preview-ip').textContent     = `IP:      ${systemInfo?.ip || '—'}`;
  document.getElementById('sign-preview-device').textContent =
    `Device:  ${systemInfo?.hostname || '—'} · ${systemInfo?.username || '—'} · ${systemInfo?.platform || '—'}`;

  overlay.classList.remove('hidden');
  nameInput.focus();
}

function closeSignModal() {
  document.getElementById('sign-overlay').classList.add('hidden');
}

function applySignature() {
  const name = document.getElementById('sign-name-input').value.trim();
  if (!name) {
    document.getElementById('sign-name-input').focus();
    return;
  }
  const now = new Date();
  pendingSignature = {
    name,
    date: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    ip:   systemInfo?.ip || '—',
    device: `${systemInfo?.hostname || '—'} · ${systemInfo?.username || '—'} · ${systemInfo?.platform || '—'}`,
  };
  document.getElementById('btn-sign').classList.add('active');
  document.getElementById('btn-sign').textContent = `✍ Signed`;
  closeSignModal();
  showToast('Signature ready — will be embedded in the saved copy', 'success');
}

function clearSignature() {
  pendingSignature = null;
  document.getElementById('btn-sign').classList.remove('active');
  document.getElementById('btn-sign').textContent = '✍ Sign';
  closeSignModal();
}

// ── Boot ──────────────────────────────────────────────────────────────────────

init();
