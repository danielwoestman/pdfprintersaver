// Settings window — configure the 10 action buttons

let workingButtons = [];   // local copy being edited

async function init() {
  const settings = await window.electronAPI.getSettings();
  // Deep copy to avoid mutating until Save is clicked
  workingButtons = settings.buttons.map(b => ({ label: b.label || '', folder: b.folder || '' }));
  // Ensure exactly 10 entries
  while (workingButtons.length < 10) workingButtons.push({ label: '', folder: '' });
  renderRows();
}

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
      }
    });

    tdBrowse.appendChild(browseBtn);

    if (btn.folder) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'btn-clear';
      clearBtn.textContent = 'Clear';
      clearBtn.addEventListener('click', () => {
        workingButtons[i].folder = '';
        folderDisplay.textContent = 'No folder selected';
        folderDisplay.title = '';
        folderDisplay.classList.remove('set');
        clearBtn.remove();
      });
      tdBrowse.appendChild(clearBtn);
    }

    tr.appendChild(tdBrowse);
    tbody.appendChild(tr);
  });
}

document.getElementById('btn-save').addEventListener('click', async () => {
  const statusEl = document.getElementById('save-status');
  statusEl.textContent = 'Saving…';
  statusEl.className = '';

  const result = await window.electronAPI.saveSettings({ buttons: workingButtons });

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
