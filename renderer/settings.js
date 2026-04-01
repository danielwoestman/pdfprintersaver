// Settings window — configure the 10 action buttons, default printer, and email templates

let workingButtons       = [];
let workingPrinter       = '';
let workingEmailTemplates = [];

// ── Custom confirm modal ──────────────────────────────────────────────────────

function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay  = document.getElementById('confirm-overlay');
    const msgEl    = document.getElementById('confirm-msg');
    const okBtn    = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    msgEl.textContent = message;
    overlay.classList.add('visible');

    function finish(result) {
      overlay.classList.remove('visible');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    const onOk     = () => finish(true);
    const onCancel = () => finish(false);

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);

    // Dismiss on overlay click outside the box
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    }, { once: true });
  });
}

async function init() {
  const settings = await window.electronAPI.getSettings();
  workingButtons = settings.buttons.map(b => ({ label: b.label || '', folder: b.folder || '' }));
  while (workingButtons.length < 10) workingButtons.push({ label: '', folder: '' });
  workingPrinter = settings.defaultPrinter || '';
  workingEmailTemplates = (settings.emailTemplates || []).map(t => ({
    label:     t.label     || '',
    toAddress: t.toAddress || '',
    note:      t.note      || '',
  }));
  while (workingEmailTemplates.length < 5) {
    workingEmailTemplates.push({ label: '', toAddress: '', note: '' });
  }
  renderRows();
  await populatePrinters(workingPrinter);
  renderEmailRows();
}

async function populatePrinters(selectedName) {
  const select = document.getElementById('printer-select');
  const printers = await window.electronAPI.getPrinters();

  // Remove all options except the first placeholder
  while (select.options.length > 1) select.remove(1);

  printers.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name + (p.isDefault ? ' (system default)' : '');
    if (p.name === selectedName) opt.selected = true;
    select.appendChild(opt);
  });

  // If the saved printer wasn't found in the list (e.g. disconnected), add it anyway
  if (selectedName && !printers.find(p => p.name === selectedName)) {
    const opt = document.createElement('option');
    opt.value = selectedName;
    opt.textContent = `${selectedName} (not detected)`;
    opt.selected = true;
    select.appendChild(opt);
  }

  select.addEventListener('change', () => { workingPrinter = select.value; });
}

document.getElementById('btn-detect-printers').addEventListener('click', async () => {
  const btn = document.getElementById('btn-detect-printers');
  btn.textContent = 'Detecting…';
  btn.disabled = true;
  await populatePrinters(workingPrinter);
  btn.textContent = 'Detect Printers';
  btn.disabled = false;
});

function renderRows() {
  const tbody = document.getElementById('settings-body');
  tbody.innerHTML = '';

  workingButtons.forEach((btn, i) => {
    const tr = document.createElement('tr');

    // # column
    const tdNum = document.createElement('td');
    tdNum.className = 'col-num';
    tdNum.textContent = String(i + 1);
    tr.appendChild(tdNum);

    // Label column
    const tdLabel = document.createElement('td');
    tdLabel.className = 'col-label';
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.placeholder = 'e.g. Invoice';
    labelInput.value = btn.label;
    labelInput.maxLength = 30;
    labelInput.addEventListener('input', () => {
      workingButtons[i].label = labelInput.value.trim();
    });
    tdLabel.appendChild(labelInput);
    tr.appendChild(tdLabel);

    // Folder column
    const tdFolder = document.createElement('td');
    tdFolder.className = 'col-folder';
    const folderDisplay = document.createElement('div');
    folderDisplay.className = 'folder-display' + (btn.folder ? ' set' : '');
    folderDisplay.textContent = btn.folder || 'No folder selected';
    folderDisplay.title = btn.folder || '';
    tdFolder.appendChild(folderDisplay);
    tr.appendChild(tdFolder);

    // Browse / clear column
    const tdBrowse = document.createElement('td');
    tdBrowse.className = 'col-browse';

    const btnGroup = document.createElement('div');
    btnGroup.className = 'btn-group';

    const browseBtn = document.createElement('button');
    browseBtn.className = 'btn-browse';
    browseBtn.textContent = 'Browse…';
    browseBtn.addEventListener('click', async () => {
      const folder = await window.electronAPI.openFolder();
      if (folder) {
        workingButtons[i].folder = folder;
        folderDisplay.textContent = folder;
        folderDisplay.title = folder;
        folderDisplay.classList.add('set');
        clearBtn.disabled = false;
      }
    });

    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn-clear';
    clearBtn.textContent = 'Clear';
    clearBtn.disabled = !btn.folder;
    clearBtn.addEventListener('click', async () => {
      const label = workingButtons[i].label || `Button ${i + 1}`;
      if (!await showConfirm(`Clear the folder for "${label}"?`)) return;
      workingButtons[i].folder = '';
      folderDisplay.textContent = 'No folder selected';
      folderDisplay.title = '';
      folderDisplay.classList.remove('set');
      clearBtn.disabled = true;
    });

    btnGroup.appendChild(browseBtn);
    btnGroup.appendChild(clearBtn);
    tdBrowse.appendChild(btnGroup);
    tr.appendChild(tdBrowse);
    tbody.appendChild(tr);
  });
}

// ── Email templates table ─────────────────────────────────────────────────────

function renderEmailRows() {
  const tbody = document.getElementById('email-body');
  tbody.innerHTML = '';

  workingEmailTemplates.forEach((tpl, i) => {
    const tr = document.createElement('tr');

    // # column
    const tdNum = document.createElement('td');
    tdNum.className = 'col-email-num';
    tdNum.textContent = String(i + 1);
    tr.appendChild(tdNum);

    // Label column
    const tdLabel = document.createElement('td');
    tdLabel.className = 'col-email-label';
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.placeholder = 'e.g. Invoice Approval';
    labelInput.value = tpl.label;
    labelInput.maxLength = 30;
    labelInput.addEventListener('input', () => {
      workingEmailTemplates[i].label = labelInput.value.trim();
    });
    tdLabel.appendChild(labelInput);
    tr.appendChild(tdLabel);

    // Recipient email column
    const tdTo = document.createElement('td');
    tdTo.className = 'col-email-to';
    const toInput = document.createElement('input');
    toInput.type = 'text';
    toInput.placeholder = 'approver@company.com';
    toInput.value = tpl.toAddress;
    toInput.maxLength = 100;
    toInput.setAttribute('spellcheck', 'false');
    toInput.addEventListener('input', () => {
      workingEmailTemplates[i].toAddress = toInput.value.trim();
    });
    tdTo.appendChild(toInput);
    tr.appendChild(tdTo);

    // Note button column
    const tdNote = document.createElement('td');
    tdNote.className = 'col-email-note';
    const noteBtn = document.createElement('button');
    noteBtn.className = 'btn-note' + (tpl.note ? ' has-note' : '');
    noteBtn.textContent = tpl.note ? '✎ Edit' : '+ Note';
    noteBtn.addEventListener('click', async () => {
      const saved = await showNoteModal(i, workingEmailTemplates[i].note);
      if (saved !== null) {
        workingEmailTemplates[i].note = saved;
        noteBtn.textContent = saved ? '✎ Edit' : '+ Note';
        noteBtn.className = 'btn-note' + (saved ? ' has-note' : '');
      }
    });
    tdNote.appendChild(noteBtn);
    tr.appendChild(tdNote);

    tbody.appendChild(tr);
  });
}

// ── Note modal ────────────────────────────────────────────────────────────────

function showNoteModal(index, currentNote) {
  return new Promise((resolve) => {
    const overlay   = document.getElementById('note-overlay');
    const title     = document.getElementById('note-modal-title');
    const textarea  = document.getElementById('note-textarea');
    const charCount = document.getElementById('note-char-count');
    const saveBtn   = document.getElementById('note-save');
    const cancelBtn = document.getElementById('note-cancel');

    const label = workingEmailTemplates[index].label || `Template ${index + 1}`;
    title.textContent = `Note — ${label}`;
    textarea.value = currentNote;
    charCount.textContent = `${currentNote.length} / 500`;
    overlay.classList.add('visible');
    textarea.focus();

    function updateCount() {
      charCount.textContent = `${textarea.value.length} / 500`;
    }
    textarea.addEventListener('input', updateCount);

    function finish(result) {
      overlay.classList.remove('visible');
      textarea.removeEventListener('input', updateCount);
      saveBtn.removeEventListener('click', onSave);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }

    const onSave   = () => finish(textarea.value.trim());
    const onCancel = () => finish(null);

    saveBtn.addEventListener('click', onSave);
    cancelBtn.addEventListener('click', onCancel);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null);
    }, { once: true });
  });
}

// ── Save ──────────────────────────────────────────────────────────────────────

document.getElementById('btn-save').addEventListener('click', async () => {
  const statusEl = document.getElementById('save-status');
  statusEl.textContent = 'Saving…';
  statusEl.className = '';

  const result = await window.electronAPI.saveSettings({
    buttons: workingButtons,
    defaultPrinter: workingPrinter,
    emailTemplates: workingEmailTemplates,
  });

  if (result.success) {
    statusEl.textContent = '✓ Saved';
    statusEl.className = 'ok';
    setTimeout(() => window.close(), 600);
  } else {
    statusEl.textContent = `✗ Error: ${result.error}`;
    statusEl.className = 'err';
  }
});

document.getElementById('btn-cancel').addEventListener('click', () => window.close());

// Allow Escape to close
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
});

init();
